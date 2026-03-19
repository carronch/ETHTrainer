/// HealthScanner — Multicall3 batched AavePool.getUserAccountData.
///
/// Previous implementation fired individual eth_calls (5 parallel per 250ms),
/// which exceeded Alchemy free tier's 330 CU/s limit (520 CU/s actual) on a
/// 60k-address watchlist, causing 429 storms and blind spots during cascades.
///
/// This implementation bundles up to 500 getUserAccountData calls into one
/// Multicall3 aggregate3 eth_call — ~100x fewer RPC requests. A full 60k scan
/// now takes ~6 seconds instead of ~50 minutes.
///
/// Multicall3 is deployed at 0xcA11bde05977b3631167028862bE2a173976CA11
/// on Arbitrum, Base, Optimism, and all major EVM chains.

use crate::config::HeuristicParams;
use crate::types::AccountData;
use alloy::{
    primitives::{Address, Bytes, U256},
    providers::Provider,
    sol,
    sol_types::SolCall,
};
use anyhow::Result;
use std::sync::Arc;
use tracing::warn;

const MULTICALL3_ADDR: &str = "0xcA11bde05977b3631167028862bE2a173976CA11";

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

    #[sol(rpc)]
    interface IMulticall3 {
        struct Call3 {
            address target;
            bool allowFailure;
            bytes callData;
        }
        struct Result {
            bool success;
            bytes returnData;
        }
        function aggregate3(Call3[] calldata calls) external returns (Result[] memory returnData);
    }
}

pub struct HealthScanner<P: Provider> {
    provider: Arc<P>,
    pool: Address,
    multicall: Address,
}

impl<P: Provider> HealthScanner<P> {
    pub fn new(provider: Arc<P>, pool_address: &str) -> Result<Self> {
        let pool: Address = pool_address.parse()?;
        let multicall: Address = MULTICALL3_ADDR.parse()?;
        Ok(Self { provider, pool, multicall })
    }

    /// Scan a slice of addresses using Multicall3 batches.
    /// One RPC call per scan_batch_size addresses — ~100x fewer requests than
    /// the previous per-address approach.
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
            let mut attempts = 0u32;
            loop {
                match self.batch_check(chunk).await {
                    Ok(batch) => {
                        results.extend(batch);
                        break;
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.contains("429") && attempts < 4 {
                            attempts += 1;
                            let backoff_ms = 1000u64 * (1u64 << attempts); // 2s, 4s, 8s, 16s
                            warn!(
                                attempt = attempts,
                                backoff_ms,
                                "Rate limited (429) — backing off"
                            );
                            tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                        } else {
                            warn!("Batch health check failed: {e}");
                            break;
                        }
                    }
                }
            }
            // Small polite delay between multicall batches
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
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

    /// Bundle the entire chunk into a single Multicall3 aggregate3 eth_call.
    async fn batch_check(&self, addresses: &[Address]) -> Result<Vec<AccountData>> {
        let mc = IMulticall3::new(self.multicall, self.provider.clone());

        let calls: Vec<IMulticall3::Call3> = addresses
            .iter()
            .map(|&addr| {
                let calldata: Bytes =
                    IAavePool::getUserAccountDataCall { user: addr }.abi_encode().into();
                IMulticall3::Call3 {
                    target: self.pool,
                    allowFailure: true,
                    callData: calldata,
                }
            })
            .collect();

        let result = mc.aggregate3(calls).call().await?;

        let mut out = Vec::new();
        for (i, r) in result.iter().enumerate() {
            if !r.success || r.returnData.is_empty() {
                continue;
            }
            match IAavePool::getUserAccountDataCall::abi_decode_returns(&r.returnData) {
                Ok(data) => {
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
                    warn!(address = ?addresses[i], "Failed to decode multicall result: {e}");
                }
            }
        }

        Ok(out)
    }
}
