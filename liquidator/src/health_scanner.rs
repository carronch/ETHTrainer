/// HealthScanner — batch multicall to AavePool.getUserAccountData.
/// Reads the watchlist from SQLite, checks all addresses in batches,
/// returns those with health factor < 1e18 (liquidatable).

use crate::config::HeuristicParams;
use crate::db::Db;
use crate::types::AccountData;
use alloy::{
    primitives::{Address, U256},
    providers::Provider,
    sol,
};
use anyhow::Result;
use std::sync::Arc;
use tracing::{info, warn};

// Inline Solidity interface — alloy generates type-safe bindings at compile time.
sol! {
    #[sol(rpc)]
    interface IAavePool {
        function getUserAccountData(address user) external view returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
    }
}

pub struct HealthScanner<P: Provider> {
    provider: Arc<P>,
    pool: Address,
}

impl<P: Provider> HealthScanner<P> {
    pub fn new(provider: Arc<P>, pool_address: &str) -> Result<Self> {
        let pool: Address = pool_address.parse()?;
        Ok(Self { provider, pool })
    }

    /// Scan all active watchlist addresses in batches.
    /// Returns liquidatable positions (health factor < 1e18).
    pub async fn scan_watchlist(
        &self,
        db: &Db,
        params: &HeuristicParams,
    ) -> Result<Vec<AccountData>> {
        let addresses = db.get_active_watchlist()?;
        if addresses.is_empty() {
            return Ok(vec![]);
        }

        let total = addresses.len();
        let mut liquidatable = Vec::new();

        for chunk in addresses.chunks(params.scan_batch_size) {
            match self.batch_check(chunk).await {
                Ok(results) => {
                    for data in results {
                        // Update health factor in SQLite
                        let collateral_usd = data.total_collateral_base as f64 / 1e8;
                        let debt_usd = data.total_debt_base as f64 / 1e8;
                        let _ = db.update_health_factor(
                            &data.address.to_string(),
                            data.health_factor,
                            collateral_usd,
                            debt_usd,
                        );

                        // Liquidatable: HF < 1e18
                        if data.health_factor < 1_000_000_000_000_000_000u128 {
                            liquidatable.push(data);
                        }
                    }
                }
                Err(e) => warn!("Batch health check failed: {e}"),
            }
        }

        if !liquidatable.is_empty() {
            info!(
                found = liquidatable.len(),
                scanned = total,
                "Liquidatable positions found"
            );
        }

        Ok(liquidatable)
    }

    /// Check a single address (used for pre-flight confirmation before submission).
    pub async fn check_one(&self, address: Address) -> Result<AccountData> {
        let pool = IAavePool::new(self.pool, self.provider.clone());
        let result = pool.getUserAccountData(address).call().await?;

        Ok(AccountData {
            address,
            total_collateral_base: result.totalCollateralBase.to::<u128>(),
            total_debt_base: result.totalDebtBase.to::<u128>(),
            health_factor: result.healthFactor.to::<u128>(),
            liquidation_threshold: result.currentLiquidationThreshold.to::<u128>(),
        })
    }

    // ── Private ───────────────────────────────────────────────────────────────

    async fn batch_check(&self, addresses: &[Address]) -> Result<Vec<AccountData>> {
        // Build multicall batch
        let pool = IAavePool::new(self.pool, self.provider.clone());
        let mut out = Vec::with_capacity(addresses.len());

        // Execute concurrent calls via join_all
        let futures: Vec<_> = addresses
            .iter()
            .copied()
            .map(|addr| {
                let provider = self.provider.clone();
                let pool_addr = self.pool;
                async move {
                    IAavePool::new(pool_addr, provider)
                        .getUserAccountData(addr)
                        .call()
                        .await
                }
            })
            .collect();
        let results = futures::future::join_all(futures).await;

        for (i, result) in results.into_iter().enumerate() {
            match result {
                Ok(data) => {
                    // Skip accounts with no debt
                    if data.totalDebtBase == U256::ZERO {
                        continue;
                    }
                    out.push(AccountData {
                        address: addresses[i],
                        total_collateral_base: data.totalCollateralBase.to::<u128>(),
                        total_debt_base: data.totalDebtBase.to::<u128>(),
                        health_factor: data.healthFactor.to::<u128>(),
                        liquidation_threshold: data.currentLiquidationThreshold.to::<u128>(),
                    });
                }
                Err(e) => {
                    warn!(address = ?addresses[i], "getUserAccountData failed: {e}");
                }
            }
        }

        Ok(out)
    }
}
