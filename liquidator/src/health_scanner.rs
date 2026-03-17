/// HealthScanner — batch multicall to AavePool.getUserAccountData.
/// Reads the watchlist from SQLite, checks all addresses in batches,
/// returns those with health factor < 1e18 (liquidatable).

use crate::config::HeuristicParams;
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

    /// Scan a slice of addresses in batches. Returns all scanned results so the
    /// caller can update the DB and filter for liquidatable positions without
    /// holding any mutex across async RPC calls.
    pub async fn scan_addresses(
        &self,
        addresses: &[Address],
        params: &HeuristicParams,
    ) -> Vec<AccountData> {
        if addresses.is_empty() {
            return vec![];
        }

        let mut results = Vec::new();

        for chunk in addresses.chunks(params.scan_batch_size) {
            match self.batch_check(chunk).await {
                Ok(batch) => results.extend(batch),
                Err(e) => warn!("Batch health check failed: {e}"),
            }
            // Sleep 500ms between large batches to be nice to the RPC node
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        results
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
        let mut out = Vec::with_capacity(addresses.len());

        // Process inside batch_check in micro-chunks of 5 to strictly enforce RPC rate limits
        for micro_chunk in addresses.chunks(5) {
            let futures: Vec<_> = micro_chunk
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
                        if data.totalDebtBase == U256::ZERO {
                            continue;
                        }
                        out.push(AccountData {
                            address: micro_chunk[i],
                            total_collateral_base: data.totalCollateralBase.to::<u128>(),
                            total_debt_base: data.totalDebtBase.to::<u128>(),
                            health_factor: data.healthFactor.to::<u128>(),
                            liquidation_threshold: data.currentLiquidationThreshold.to::<u128>(),
                        });
                    }
                    Err(e) => {
                        warn!(address = ?micro_chunk[i], "getUserAccountData failed: {e}");
                    }
                }
            }
            
            // Sleep between micro-chunks to ensure we stay under 330 CUPS
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }

        Ok(out)
    }
}
