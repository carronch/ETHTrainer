/// OpportunityRanker — for a liquidatable position, finds the best opportunity.
///
/// Strategy (ported from TypeScript):
///   1. Load all Aave reserves
///   2. For each reserve, get the user's position (collateral + debt)
///   3. Pick: debt = largest debt in USD; collateral = highest liquidation bonus
///   4. Estimate profit: liquidation_bonus - gas_cost - flash_loan_fee (0.09%)
///   5. Return the opportunity if profit > min_profit_eth threshold

use crate::config::HeuristicParams;
use crate::types::{AccountData, LiquidationOpportunity, UserReserveData};
use alloy::{
    network::AnyNetwork,
    primitives::{Address, U256},
    providers::Provider,
    sol,
};
use anyhow::Result;
use std::{collections::HashMap, sync::Arc};
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

pub struct OpportunityRanker<P: Provider<AnyNetwork>> {
    provider: Arc<P>,
    pool: Address,
    data_provider: Address,
    oracle: Address,
    /// Per-chain stablecoin addresses (use 0.01% Uniswap fee tier).
    stable_tokens: Vec<String>,
    /// Per-chain major token addresses: WETH, WBTC (use 0.05% fee tier).
    major_tokens: Vec<String>,
    /// Cached reserves list (refreshed on start and periodically)
    reserves_cache: tokio::sync::RwLock<Option<Vec<Address>>>,
}

impl<P: Provider<AnyNetwork>> OpportunityRanker<P> {
    pub fn new(
        provider: Arc<P>,
        pool: &str,
        data_provider: &str,
        oracle: &str,
        stable_tokens: &[&str],
        major_tokens: &[&str],
    ) -> Result<Self> {
        Ok(Self {
            provider,
            pool: pool.parse()?,
            data_provider: data_provider.parse()?,
            oracle: oracle.parse()?,
            stable_tokens: stable_tokens.iter().map(|s| s.to_string()).collect(),
            major_tokens: major_tokens.iter().map(|s| s.to_string()).collect(),
            reserves_cache: tokio::sync::RwLock::new(None),
        })
    }

    pub async fn find_best(
        &self,
        account: &AccountData,
        params: &HeuristicParams,
    ) -> Result<Option<LiquidationOpportunity>> {
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
            return Ok(None);
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
            return Ok(None);
        }

        // Aave v3 close factor: 50% of debt, or 100% if HF < 0.95
        let hf_95pct = 950_000_000_000_000_000u128;
        let close_factor = if account.health_factor < hf_95pct { 100u128 } else { 50u128 };
        let debt_to_cover = best_debt.total_debt.saturating_mul(close_factor) / 100;

        // Collateral received (in collateral token units)
        let collateral_received = debt_to_cover
            .saturating_mul(debt_price)
            .saturating_mul(best_collateral.liquidation_bonus)
            / collateral_price
            / 10_000;

        // Flash loan fee (0.09%)
        let flash_loan_fee = debt_to_cover.saturating_mul(FLASH_LOAN_FEE_BPS) / 10_000;

        // Gross profit in debt token units
        let collateral_value_in_debt = collateral_received
            .saturating_mul(collateral_price)
            / debt_price;
        let gross_profit_debt_units = collateral_value_in_debt
            .saturating_sub(debt_to_cover)
            .saturating_sub(flash_loan_fee);

        // Convert profit to ETH equivalent
        // profit_usd (8 dec) → profit_eth via approx ETH = $3000
        let profit_usd = gross_profit_debt_units
            .saturating_mul(debt_price)
            / 10u128.pow(best_debt.decimals as u32);

        // ETH price approximation: $3000 with 8 decimal oracle
        let eth_price_usd_8dec = 3_000_00000000u128;
        let profit_wei = profit_usd
            .saturating_mul(1_000_000_000_000_000_000) // 1e18
            / eth_price_usd_8dec;

        // Gas cost
        let gas_price = self.provider.get_gas_price().await?;
        let gas_cost_wei = params.gas_estimate_liquidation as u128 * gas_price.to::<u128>();

        if profit_wei <= gas_cost_wei {
            debug!(borrower = ?account.address, "Skipping: profit < gas cost");
            return Ok(None);
        }

        let net_profit_wei = profit_wei - gas_cost_wei;

        if net_profit_wei < params.min_profit_wei() {
            debug!(
                borrower = ?account.address,
                net_profit_eth = net_profit_wei as f64 / 1e18,
                min_profit_eth = params.min_profit_eth,
                "Skipping: below min_profit threshold"
            );
            return Ok(None);
        }

        let pool_fee = self.preferred_fee(&best_collateral.asset, &best_debt.asset);
        let min_profit_wei = (net_profit_wei * 80) / 100; // 20% slippage buffer

        Ok(Some(LiquidationOpportunity {
            borrower: account.address,
            collateral_asset: best_collateral.asset,
            collateral_symbol: best_collateral.symbol.clone(),
            debt_asset: best_debt.asset,
            debt_symbol: best_debt.symbol.clone(),
            debt_to_cover,
            estimated_profit_wei: net_profit_wei,
            estimated_gas_wei: gas_cost_wei,
            uniswap_pool_fee: pool_fee,
            min_profit_wei,
            health_factor: account.health_factor,
        }))
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
        {
            let cache = self.reserves_cache.read().await;
            if let Some(ref list) = *cache {
                return Ok(list.clone());
            }
        }
        let pool = IAavePool::new(self.pool, self.provider.clone());
        let list = pool.getReservesList().call().await?._0;
        let mut cache = self.reserves_cache.write().await;
        *cache = Some(list.clone());
        Ok(list)
    }

    async fn get_user_reserves(
        &self,
        user: Address,
        reserves: &[Address],
    ) -> Result<Vec<UserReserveData>> {
        let dp = IDataProvider::new(self.data_provider, self.provider.clone());

        let user_calls: Vec<_> = reserves.iter().map(|&a| dp.getUserReserveData(a, user).call()).collect();
        let cfg_calls: Vec<_>  = reserves.iter().map(|&a| dp.getReserveConfigurationData(a).call()).collect();

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
                symbol:             reserves[i].to_string()[..8].to_string(), // short placeholder
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
        let prices = oracle.getAssetsPrices(reserves.to_vec()).call().await?._0;
        Ok(reserves.iter().copied().zip(prices.iter().map(|p| p.to::<u128>())).collect())
    }
}
