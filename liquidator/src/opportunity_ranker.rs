/// OpportunityRanker — for a liquidatable position, finds the best opportunity.
///
/// Strategy (ported from TypeScript):
///   1. Load all Aave reserves
///   2. For each reserve, get the user's position (collateral + debt)
///   3. Pick: debt = largest debt in USD; collateral = highest liquidation bonus
///   4. Estimate profit: liquidation_bonus - gas_cost - flash_loan_fee (0.09%)
///   5. Return the opportunity if profit > min_profit_eth threshold

use crate::config::HeuristicParams;
use crate::types::{AccountData, BatchLiquidationOpportunity, LiquidationOpportunity, RankResult, UserReserveData};
use alloy::{
    primitives::{Address, U256},
    providers::Provider,
    sol,
};
use anyhow::Result;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tracing::debug;

sol! {
    #[sol(rpc)]
    interface IAavePool {
        function getReservesList() external view returns (address[] memory);
    }

    #[sol(rpc)]
    interface IDataProvider {
        function getUserReserveData(address asset, address user) external view returns (
            uint256 currentATokenBalance,
            uint256 currentStableDebt,
            uint256 currentVariableDebt,
            uint256 principalStableDebt,
            uint256 scaledVariableDebt,
            uint256 stableBorrowRate,
            uint256 liquidityRate,
            uint40 stableRateLastUpdated,
            bool usageAsCollateralEnabled
        );

        function getReserveConfigurationData(address asset) external view returns (
            uint256 decimals,
            uint256 ltv,
            uint256 liquidationThreshold,
            uint256 liquidationBonus,
            uint256 reserveFactor,
            bool usageAsCollateralEnabled,
            bool borrowingEnabled,
            bool stableBorrowRateEnabled,
            bool isActive,
            bool isFrozen
        );
    }

    #[sol(rpc)]
    interface IAaveOracle {
        function getAssetsPrices(address[] calldata assets) external view returns (uint256[] memory);
    }
}

const FLASH_LOAN_FEE_BPS: u128 = 9; // 0.09%

pub struct OpportunityRanker<P: Provider> {
    provider: Arc<P>,
    pool: Address,
    data_provider: Address,
    oracle: Address,
    /// Per-chain stablecoin addresses (use 0.01% Uniswap fee tier).
    stable_tokens: Vec<String>,
    /// Per-chain major token addresses: WETH, WBTC (use 0.05% fee tier).
    major_tokens: Vec<String>,
    /// Cached reserves list + fetch timestamp for TTL-based refresh.
    reserves_cache: tokio::sync::RwLock<Option<(Vec<Address>, Instant)>>,
    /// WETH address on this chain (used to look up live ETH price from oracle).
    weth_address: Address,
    /// Per-chain token symbol map (lowercase address -> ticker).
    symbols: HashMap<String, &'static str>,
}

impl<P: Provider> OpportunityRanker<P> {
    pub fn new(
        provider: Arc<P>,
        pool: &str,
        data_provider: &str,
        oracle: &str,
        stable_tokens: &[&str],
        major_tokens: &[&str],
        weth_address: &str,
        symbols: HashMap<String, &'static str>,
    ) -> Result<Self> {
        Ok(Self {
            provider,
            pool: pool.parse()?,
            data_provider: data_provider.parse()?,
            oracle: oracle.parse()?,
            stable_tokens: stable_tokens.iter().map(|s| s.to_string()).collect(),
            major_tokens: major_tokens.iter().map(|s| s.to_string()).collect(),
            reserves_cache: tokio::sync::RwLock::new(None),
            weth_address: weth_address.parse()?,
            symbols,
        })
    }

    pub async fn find_best(
        &self,
        account: &AccountData,
        params: &HeuristicParams,
    ) -> Result<RankResult> {
        let reserves = self.get_reserves().await?;
        let (user_data, prices) = tokio::try_join!(
            self.get_user_reserves(account.address, &reserves),
            self.get_prices(&reserves),
        )?;

        let collaterals: Vec<_> = user_data
            .iter()
            .filter(|r| r.a_token_balance > 0 && r.usage_as_collateral)
            .collect();
        let debts: Vec<_> = user_data
            .iter()
            .filter(|r| r.total_debt > 0)
            .collect();

        if collaterals.is_empty() || debts.is_empty() {
            return Ok(RankResult::Ineligible);
        }

        // Best debt: largest value in USD
        let best_debt = debts
            .iter()
            .max_by_key(|r| {
                let price = prices.get(&r.asset).copied().unwrap_or(0);
                r.total_debt.saturating_mul(price) / 10u128.pow(r.decimals as u32)
            })
            .unwrap();

        // Best collateral: highest liquidation bonus
        let best_collateral = collaterals
            .iter()
            .max_by_key(|r| r.liquidation_bonus)
            .unwrap();

        let debt_price       = prices.get(&best_debt.asset).copied().unwrap_or(0);
        let collateral_price = prices.get(&best_collateral.asset).copied().unwrap_or(0);
        if debt_price == 0 || collateral_price == 0 {
            return Ok(RankResult::Ineligible);
        }

        // Aave v3 close factor: 50% of debt, or 100% if HF < 0.95
        let hf_95pct = 950_000_000_000_000_000u128;
        let close_factor = if account.health_factor < hf_95pct { 100u128 } else { 50u128 };
        let debt_to_cover = best_debt.total_debt.saturating_mul(close_factor) / 100;

        // Flash loan fee (0.09%)
        let flash_loan_fee = debt_to_cover.saturating_mul(FLASH_LOAN_FEE_BPS) / 10_000;

        // Collateral value expressed in debt-token units.
        // Math: collateral_received_raw = debt_to_cover * debt_price * liq_bonus
        //         * 10^coll_dec / (collateral_price * 10_000 * 10^debt_dec)
        //       collateral_value_in_debt = collateral_received_raw * collateral_price / debt_price
        //         * 10^debt_dec / 10^coll_dec
        //       → all price and decimal factors cancel → debt_to_cover * liq_bonus / 10_000
        let collateral_value_in_debt = debt_to_cover
            .saturating_mul(best_collateral.liquidation_bonus)
            / 10_000;

        // Uniswap swap fee on the collateral→debt swap; pool_fee is in 1/1_000_000 units.
        let pool_fee = self.preferred_fee(&best_collateral.asset, &best_debt.asset);
        let uniswap_fee = collateral_value_in_debt
            .saturating_mul(pool_fee as u128)
            / 1_000_000;

        // Gross profit in debt token units (after all fees)
        let gross_profit_debt_units = collateral_value_in_debt
            .saturating_sub(debt_to_cover)
            .saturating_sub(flash_loan_fee)
            .saturating_sub(uniswap_fee);

        // Convert profit to USD (8-decimal oracle prices), then to ETH via live WETH oracle price.
        // Fallback to $2,000 (conservative) if WETH is somehow missing from oracle.
        let profit_usd = gross_profit_debt_units
            .saturating_mul(debt_price)
            / 10u128.pow(best_debt.decimals as u32);

        let eth_price_usd_8dec = prices.get(&self.weth_address)
            .copied()
            .filter(|&p| p > 0)
            .unwrap_or(2_000_00000000u128); // $2,000 fallback with 8 decimals
        let profit_wei = profit_usd
            .saturating_mul(1_000_000_000_000_000_000) // 1e18
            / eth_price_usd_8dec;

        // Gas cost
        let gas_price = self.provider.get_gas_price().await?;
        let gas_cost_wei = params.gas_estimate_liquidation as u128 * gas_price;

        // Below gas cost — candidate for batching
        if profit_wei <= gas_cost_wei {
            let shortfall_wei = gas_cost_wei - profit_wei;
            debug!(
                borrower = ?account.address,
                profit_eth = profit_wei as f64 / 1e18,
                gas_eth = gas_cost_wei as f64 / 1e18,
                "Skipping: profit < gas cost (batch candidate)"
            );
            return Ok(RankResult::Skipped {
                opportunity: LiquidationOpportunity {
                    borrower: account.address,
                    collateral_asset: best_collateral.asset,
                    collateral_symbol: best_collateral.symbol.clone(),
                    debt_asset: best_debt.asset,
                    debt_symbol: best_debt.symbol.clone(),
                    debt_to_cover,
                    gross_profit_wei: profit_wei,
                    estimated_profit_wei: 0,
                    estimated_gas_wei: gas_cost_wei,
                    uniswap_pool_fee: pool_fee,
                    min_profit_wei: 0,
                    health_factor: account.health_factor,
                },
                shortfall_wei,
            });
        }

        let net_profit_wei = profit_wei - gas_cost_wei;

        // Above gas cost but below min_profit threshold — also batch candidate
        if net_profit_wei < params.min_profit_wei() {
            debug!(
                borrower = ?account.address,
                net_profit_eth = net_profit_wei as f64 / 1e18,
                min_profit_eth = params.min_profit_eth,
                "Skipping: below min_profit threshold (batch candidate)"
            );
            return Ok(RankResult::Skipped {
                opportunity: LiquidationOpportunity {
                    borrower: account.address,
                    collateral_asset: best_collateral.asset,
                    collateral_symbol: best_collateral.symbol.clone(),
                    debt_asset: best_debt.asset,
                    debt_symbol: best_debt.symbol.clone(),
                    debt_to_cover,
                    gross_profit_wei: profit_wei,
                    estimated_profit_wei: net_profit_wei,
                    estimated_gas_wei: gas_cost_wei,
                    uniswap_pool_fee: pool_fee,
                    min_profit_wei: 0,
                    health_factor: account.health_factor,
                },
                shortfall_wei: params.min_profit_wei() - net_profit_wei,
            });
        }

        let min_profit_wei = (net_profit_wei * 80) / 100; // 20% slippage buffer

        Ok(RankResult::Profitable(LiquidationOpportunity {
            borrower: account.address,
            collateral_asset: best_collateral.asset,
            collateral_symbol: best_collateral.symbol.clone(),
            debt_asset: best_debt.asset,
            debt_symbol: best_debt.symbol.clone(),
            debt_to_cover,
            gross_profit_wei: profit_wei,
            estimated_profit_wei: net_profit_wei,
            estimated_gas_wei: gas_cost_wei,
            uniswap_pool_fee: pool_fee,
            min_profit_wei,
            health_factor: account.health_factor,
        }))
    }

    /// Group individually-unprofitable positions by debt asset and find batches
    /// where the collective gross profit exceeds the batch gas cost.
    ///
    /// Batch gas model: 300_000 base + 600_000 per position.
    /// Returns groups of 2+ positions that collectively meet profitability.
    pub async fn find_batch_candidates(
        &self,
        candidates: &[LiquidationOpportunity],
        params: &HeuristicParams,
    ) -> Vec<BatchLiquidationOpportunity> {
        let gas_price = match self.provider.get_gas_price().await {
            Ok(p) => p,
            Err(_) => return vec![],
        };

        const BATCH_BASE_GAS: u128   = 300_000;
        const PER_POSITION_GAS: u128 = 600_000;

        // Group by debt_asset
        let mut groups: HashMap<Address, Vec<&LiquidationOpportunity>> = HashMap::new();
        for opp in candidates {
            groups.entry(opp.debt_asset).or_default().push(opp);
        }

        let mut batches = Vec::new();
        for (debt_asset, group) in groups {
            if group.len() < 2 {
                continue;
            }

            let n = group.len() as u128;
            let batch_gas_wei = (BATCH_BASE_GAS + PER_POSITION_GAS * n) * gas_price;
            let total_gross_profit_wei: u128 = group.iter().map(|o| o.gross_profit_wei).sum();

            if total_gross_profit_wei <= batch_gas_wei + params.min_profit_wei() {
                debug!(
                    debt_asset = ?debt_asset,
                    positions = group.len(),
                    gross_profit_eth = total_gross_profit_wei as f64 / 1e18,
                    gas_eth = batch_gas_wei as f64 / 1e18,
                    "Batch not profitable enough"
                );
                continue;
            }

            let net_batch_profit = total_gross_profit_wei - batch_gas_wei;
            let min_total_profit_wei = (net_batch_profit * 80) / 100;

            batches.push(BatchLiquidationOpportunity {
                debt_asset,
                debt_asset_symbol: group[0].debt_symbol.clone(),
                positions: group.into_iter().cloned().collect(),
                total_gross_profit_wei,
                total_estimated_gas_wei: batch_gas_wei,
                min_total_profit_wei,
            });
        }

        batches
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /// Preferred Uniswap v3 fee tier for a token pair (lower = cheaper swap).
    /// Uses per-chain stable_tokens / major_tokens lists from ChainConfig.
    fn preferred_fee(&self, token_in: &Address, token_out: &Address) -> u32 {
        let a = token_in.to_string().to_lowercase();
        let b = token_out.to_string().to_lowercase();

        let is_a_stable = self.stable_tokens.iter().any(|t| t == &a);
        let is_b_stable = self.stable_tokens.iter().any(|t| t == &b);

        if is_a_stable && is_b_stable {
            100 // 0.01% for stablecoin pairs
        } else if self.major_tokens.iter().any(|t| t == &a || t == &b) {
            500 // 0.05% for major pairs (WETH, WBTC/cbBTC)
        } else {
            3000 // 0.30% default
        }
    }

    async fn get_reserves(&self) -> Result<Vec<Address>> {
        const CACHE_TTL_SECS: u64 = 6 * 3600; // refresh every 6 hours
        {
            let cache = self.reserves_cache.read().await;
            if let Some((ref list, fetched_at)) = *cache {
                if fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                    return Ok(list.clone());
                }
            }
        }
        let pool = IAavePool::new(self.pool, self.provider.clone());
        let list = pool.getReservesList().call().await?;
        let mut cache = self.reserves_cache.write().await;
        *cache = Some((list.clone(), Instant::now()));
        Ok(list)
    }

    async fn get_user_reserves(
        &self,
        user: Address,
        reserves: &[Address],
    ) -> Result<Vec<UserReserveData>> {
        let user_calls: Vec<_> = reserves
            .iter()
            .copied()
            .map(|a| {
                let provider = self.provider.clone();
                let dp_addr = self.data_provider;
                async move {
                    IDataProvider::new(dp_addr, provider)
                        .getUserReserveData(a, user)
                        .call()
                        .await
                }
            })
            .collect();

        let cfg_calls: Vec<_> = reserves
            .iter()
            .copied()
            .map(|a| {
                let provider = self.provider.clone();
                let dp_addr = self.data_provider;
                async move {
                    IDataProvider::new(dp_addr, provider)
                        .getReserveConfigurationData(a)
                        .call()
                        .await
                }
            })
            .collect();

        let (user_results, cfg_results) = tokio::join!(
            futures::future::join_all(user_calls),
            futures::future::join_all(cfg_calls),
        );

        let mut out = Vec::new();
        for i in 0..reserves.len() {
            let ur = match &user_results[i] { Ok(v) => v, Err(_) => continue };
            let cr = match &cfg_results[i]  { Ok(v) => v, Err(_) => continue };

            if !cr.isActive || cr.isFrozen { continue; }

            let a_token = ur.currentATokenBalance.to::<u128>();
            let stable  = ur.currentStableDebt.to::<u128>();
            let variable= ur.currentVariableDebt.to::<u128>();

            if a_token == 0 && stable == 0 && variable == 0 { continue; }

            out.push(UserReserveData {
                asset:              reserves[i],
                symbol:             self.symbols
                    .get(&reserves[i].to_string().to_lowercase())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("…{}", &reserves[i].to_string()[36..])),
                decimals:           cr.decimals.to::<u8>(),
                a_token_balance:    a_token,
                stable_debt:        stable,
                variable_debt:      variable,
                total_debt:         stable + variable,
                usage_as_collateral: ur.usageAsCollateralEnabled,
                liquidation_bonus:  cr.liquidationBonus.to::<u128>(),
                price_usd:          0, // filled by get_prices
            });
        }
        Ok(out)
    }

    async fn get_prices(&self, reserves: &[Address]) -> Result<HashMap<Address, u128>> {
        let oracle = IAaveOracle::new(self.oracle, self.provider.clone());
        let prices = oracle.getAssetsPrices(reserves.to_vec()).call().await?;
        Ok(reserves.iter().copied().zip(prices.iter().map(|p: &U256| p.to::<u128>())).collect())
    }
}
