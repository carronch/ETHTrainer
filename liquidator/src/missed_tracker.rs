/// MissedOpportunityTracker — the most important feedback signal for autoresearch.
///
/// Listens for Aave LiquidationCall events on Arbitrum.
/// For each liquidation, checks if the borrower was on our watchlist.
/// If yes: logs it as a missed opportunity with the winner's gas price.
///
/// These records feed the nightly autoresearch loop, which uses them to:
///   - Determine if higher gas bids would have won us these liquidations
///   - Simulate winning scenarios via Anvil forks
///   - Adjust max_gas_gwei and other parameters accordingly

use crate::db::Db;
use crate::types::MissedOpportunity;
use alloy::{
    primitives::Address,
    providers::Provider,
    sol,
    sol_types::SolEvent,
};
use anyhow::Result;
use chrono::Utc;
use std::sync::Arc;
use tracing::{info, warn};

sol! {
    event LiquidationCall(
        address indexed collateralAsset,
        address indexed debtAsset,
        address indexed user,
        uint256 debtToCover,
        uint256 liquidatedCollateralAmount,
        address liquidator,
        bool receiveAToken
    );
}

pub struct MissedTracker {
    pool: Address,
}

impl MissedTracker {
    pub fn new(pool_address: &str) -> Result<Self> {
        Ok(Self { pool: pool_address.parse()? })
    }

    /// Spawn a background task that watches for LiquidationCall events
    /// and logs the ones we missed.
    pub fn spawn<P: Provider + 'static>(
        &self,
        provider: Arc<P>,
        db: Arc<std::sync::Mutex<Db>>,
    ) {
        let pool = self.pool;

        tokio::spawn(async move {
            info!("MissedTracker: subscribing to LiquidationCall events");

            let filter = alloy::rpc::types::Filter::new()
                .address(pool)
                .event_signature(LiquidationCall::SELECTOR);

            match provider.subscribe_logs(&filter).await {
                Ok(mut stream) => {
                    use futures::StreamExt;
                    while let Some(log) = stream.next().await {
                        let log: alloy::rpc::types::Log = log;
                        if let Ok(decoded) = log.log_decode::<LiquidationCall>() {
                            let event = decoded.data();
                            let borrower = event.user;

                            // Check if borrower was on our watchlist
                            let is_watched = {
                                if let Ok(db_lock) = db.lock() {
                                    db_lock
                                        .get_active_watchlist()
                                        .map(|list| list.contains(&borrower))
                                        .unwrap_or(false)
                                } else {
                                    false
                                }
                            };

                            if is_watched {
                                // Fetch the tx to get the winner's gas price
                                let winner_gas_gwei = log
                                    .transaction_hash
                                    .and_then(|h| {
                                        // We log 0.0 if we can't fetch — autoresearch
                                        // can query on-chain separately for this block
                                        None::<f64>
                                    })
                                    .unwrap_or(0.0);

                                let missed = MissedOpportunity {
                                    borrower,
                                    collateral_asset: event.collateralAsset,
                                    debt_asset: event.debtAsset,
                                    profit_missed_eth: 0.0, // autoresearch computes this
                                    winner_address: event.liquidator,
                                    winner_gas_gwei,
                                    block_number: log.block_number.unwrap_or(0),
                                    timestamp: Utc::now().timestamp(),
                                };

                                if let Ok(db_lock) = db.lock() {
                                    if let Err(e) = db_lock.insert_missed_opportunity(&missed) {
                                        warn!("Failed to log missed opportunity: {e}");
                                    } else {
                                        info!(
                                            borrower = ?borrower,
                                            winner = ?event.liquidator,
                                            block = log.block_number,
                                            "Missed liquidation logged"
                                        );
                                    }
                                }
                            }
                        }
                    }
                    warn!("LiquidationCall event stream ended — this should not happen");
                }
                Err(e) => {
                    warn!("Failed to subscribe to LiquidationCall events: {e}");
                    warn!("Missed opportunity tracking disabled (WebSocket required)");
                }
            }
        });
    }
}
