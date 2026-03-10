/// TxSubmitter — pre-flight eth_call + transaction signing + submission.
///
/// Safety layers (in order):
///   1. Re-confirm health factor still < 1 (position may have been rescued)
///   2. Gas price still within heuristic limit
///   3. eth_call simulation: if it would revert, skip silently
///   4. Submit tx, wait for receipt
///   5. Circuit breaker: N consecutive failures → pause

use crate::config::HeuristicParams;
use crate::db::Db;
use crate::types::{LiquidationOpportunity, LiquidationResult};
use alloy::{
    network::{AnyNetwork, TransactionBuilder},
    primitives::{Address, Bytes, U256},
    providers::{Provider, WalletProvider},
    rpc::types::TransactionRequest,
    sol,
};
use anyhow::{anyhow, Result};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{error, info, warn};

sol! {
    #[sol(rpc)]
    interface ILiquidationBot {
        function liquidate(
            address collateralAsset,
            address debtAsset,
            address userToLiquidate,
            uint256 debtToCover,
            uint24 uniswapPoolFee,
            uint256 minProfitWei
        ) external;
    }
}

pub struct CircuitBreaker {
    consecutive_fails: u32,
    paused_until: Option<Instant>,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        Self { consecutive_fails: 0, paused_until: None }
    }

    pub fn is_paused(&self) -> bool {
        self.paused_until.map(|t| Instant::now() < t).unwrap_or(false)
    }

    pub fn record_success(&mut self) {
        self.consecutive_fails = 0;
        self.paused_until = None;
    }

    pub fn record_failure(&mut self, threshold: u32, pause_secs: u64) {
        self.consecutive_fails += 1;
        if self.consecutive_fails >= threshold {
            let resume = Instant::now() + Duration::from_secs(pause_secs);
            self.paused_until = Some(resume);
            warn!(
                consecutive_fails = self.consecutive_fails,
                pause_secs,
                "Circuit breaker triggered"
            );
        }
    }
}

pub struct TxSubmitter<P: Provider<AnyNetwork> + WalletProvider<AnyNetwork>> {
    provider: Arc<P>,
    bot_address: Address,
    pool_address: Address,
    shadow_mode: bool,
    circuit_breaker: std::sync::Mutex<CircuitBreaker>,
}

impl<P: Provider<AnyNetwork> + WalletProvider<AnyNetwork>> TxSubmitter<P> {
    pub fn new(provider: Arc<P>, bot_address: Address, pool_address: Address, shadow_mode: bool) -> Self {
        Self {
            provider,
            bot_address,
            pool_address,
            shadow_mode,
            circuit_breaker: std::sync::Mutex::new(CircuitBreaker::new()),
        }
    }

    pub async fn execute(
        &self,
        opp: &LiquidationOpportunity,
        db: &Db,
        params: &HeuristicParams,
    ) -> LiquidationResult {
        // ── Circuit breaker ────────────────────────────────────────────────────
        if self.circuit_breaker.lock().unwrap().is_paused() {
            return LiquidationResult {
                success: false,
                tx_hash: None,
                profit_eth: None,
                error: Some("Circuit breaker active".to_string()),
                borrower: opp.borrower,
                collateral_symbol: opp.collateral_symbol.clone(),
                debt_symbol: opp.debt_symbol.clone(),
                was_shadow: self.shadow_mode,
            };
        }

        // ── Pre-flight: confirm health factor still < 1 ────────────────────────
        match self.refresh_health_factor(opp.borrower).await {
            Ok(hf) if hf >= 1_000_000_000_000_000_000u128 => {
                info!(borrower = ?opp.borrower, "Position recovered, skipping");
                return LiquidationResult {
                    success: false,
                    tx_hash: None,
                    profit_eth: None,
                    error: Some("Position recovered".to_string()),
                    borrower: opp.borrower,
                    collateral_symbol: opp.collateral_symbol.clone(),
                    debt_symbol: opp.debt_symbol.clone(),
                    was_shadow: self.shadow_mode,
                };
            }
            Err(e) => warn!("HF re-check failed: {e}, proceeding"),
            _ => {}
        }

        // ── Pre-flight: gas price check ────────────────────────────────────────
        let gas_price = match self.provider.get_gas_price().await {
            Ok(p) => p.to::<u128>(),
            Err(e) => {
                error!("Failed to get gas price: {e}");
                return self.fail_result(opp, "gas price fetch failed");
            }
        };

        if gas_price as f64 > params.max_gas_gwei * 1e9 {
            let gwei = gas_price as f64 / 1e9;
            warn!(gwei, max_gwei = params.max_gas_gwei, "Gas too high, skipping");
            return self.fail_result(opp, &format!("gas {gwei:.3} gwei exceeds limit"));
        }

        // Build calldata
        let bot = ILiquidationBot::new(self.bot_address, self.provider.clone());
        let call = bot.liquidate(
            opp.collateral_asset,
            opp.debt_asset,
            opp.borrower,
            U256::from(opp.debt_to_cover),
            opp.uniswap_pool_fee as u32,
            U256::from(opp.min_profit_wei),
        );

        // ── Pre-flight: eth_call simulation ────────────────────────────────────
        if let Err(e) = call.call().await {
            info!(borrower = ?opp.borrower, "eth_call simulation failed: {e}");
            return self.fail_result(opp, &format!("simulation failed: {e}"));
        }

        // ── Shadow mode: log and return without submitting ─────────────────────
        if self.shadow_mode {
            let profit_eth = opp.estimated_profit_wei as f64 / 1e18;
            info!(
                borrower = ?opp.borrower,
                profit_eth,
                "[SHADOW] Would have submitted liquidation"
            );
            db.log("info", &format!("[SHADOW] liquidation opportunity: borrower={:?} profit_eth={:.6}", opp.borrower, profit_eth), None);
            return LiquidationResult {
                success: true,
                tx_hash: None,
                profit_eth: Some(profit_eth),
                error: None,
                borrower: opp.borrower,
                collateral_symbol: opp.collateral_symbol.clone(),
                debt_symbol: opp.debt_symbol.clone(),
                was_shadow: true,
            };
        }

        // ── Live: submit the transaction ───────────────────────────────────────
        let row_id = db
            .insert_trade_pending(
                &opp.borrower.to_string(),
                &opp.collateral_symbol,
                &opp.debt_symbol,
                opp.estimated_profit_wei as f64 / 1e18,
                false,
            )
            .unwrap_or(0);

        let tx = call
            .with_gas_limit(params.gas_estimate_liquidation + 100_000)
            .with_gas_price(gas_price);

        match tx.send().await {
            Ok(pending) => {
                let tx_hash = format!("{:?}", pending.tx_hash());
                info!(tx_hash, borrower = ?opp.borrower, "Tx submitted, waiting for receipt");

                match pending.get_receipt().await {
                    Ok(receipt) if receipt.status() => {
                        let profit_eth = opp.estimated_profit_wei as f64 / 1e18;
                        let gas_used = receipt.gas_used;
                        let _ = db.confirm_trade(row_id, &tx_hash, "confirmed", Some(profit_eth), Some(gas_used), Some(gas_price));
                        self.circuit_breaker.lock().unwrap().record_success();
                        info!(tx_hash, profit_eth, "Liquidation confirmed!");
                        LiquidationResult {
                            success: true,
                            tx_hash: Some(tx_hash),
                            profit_eth: Some(profit_eth),
                            error: None,
                            borrower: opp.borrower,
                            collateral_symbol: opp.collateral_symbol.clone(),
                            debt_symbol: opp.debt_symbol.clone(),
                            was_shadow: false,
                        }
                    }
                    Ok(receipt) => {
                        let gas_used = receipt.gas_used;
                        let _ = db.confirm_trade(row_id, &tx_hash, "failed", None, Some(gas_used), Some(gas_price));
                        self.circuit_breaker.lock().unwrap().record_failure(
                            params.circuit_breaker_failures,
                            params.circuit_breaker_pause_secs,
                        );
                        warn!(tx_hash, "Tx reverted");
                        self.fail_result(opp, "tx reverted")
                    }
                    Err(e) => {
                        let _ = db.confirm_trade(row_id, &tx_hash, "failed", None, None, None);
                        self.circuit_breaker.lock().unwrap().record_failure(
                            params.circuit_breaker_failures,
                            params.circuit_breaker_pause_secs,
                        );
                        self.fail_result(opp, &format!("receipt error: {e}"))
                    }
                }
            }
            Err(e) => {
                let _ = db.confirm_trade(row_id, "", "failed", None, None, None);
                self.circuit_breaker.lock().unwrap().record_failure(
                    params.circuit_breaker_failures,
                    params.circuit_breaker_pause_secs,
                );
                error!(borrower = ?opp.borrower, "Tx submission failed: {e}");
                self.fail_result(opp, &format!("submission error: {e}"))
            }
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    fn fail_result(&self, opp: &LiquidationOpportunity, msg: &str) -> LiquidationResult {
        LiquidationResult {
            success: false,
            tx_hash: None,
            profit_eth: None,
            error: Some(msg.to_string()),
            borrower: opp.borrower,
            collateral_symbol: opp.collateral_symbol.clone(),
            debt_symbol: opp.debt_symbol.clone(),
            was_shadow: self.shadow_mode,
        }
    }

    async fn refresh_health_factor(&self, address: Address) -> Result<u128> {
        sol! {
            function getUserAccountData(address user) view returns (
                uint256, uint256, uint256, uint256, uint256, uint256 healthFactor
            );
        }
        // Raw eth_call for the health factor slot
        let calldata = getUserAccountDataCall { user: address }.abi_encode();
        let req = TransactionRequest::default().to(self.pool_address).input(Bytes::from(calldata));
        let result = self.provider.call(&req).await?;

        // Health factor is the 6th return value (offset 5 * 32 = 160 bytes)
        if result.len() < 192 {
            return Err(anyhow!("Unexpected response length"));
        }
        let hf_bytes = &result[160..192];
        let hf = u128::from_be_bytes(hf_bytes[16..32].try_into()?);
        Ok(hf)
    }
}
