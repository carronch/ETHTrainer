/// EventListener — subscribes to Aave Borrow events to populate the watchlist.
///
/// Two modes:
///   1. Historical seed: pull last 3 days of Borrow events on startup
///   2. Live watch: WebSocket subscription for new events
///
/// Every new borrower address is upserted into liquidation_watchlist in SQLite.

use crate::db::Db;
use alloy::{
    primitives::Address,
    providers::Provider,
    rpc::types::{BlockNumberOrTag, Filter},
    sol,
    sol_types::SolEvent,
};
use anyhow::Result;
use std::sync::Arc;
use tracing::{info, warn};

sol! {
    event Borrow(
        address indexed reserve,
        address user,
        address indexed onBehalfOf,
        uint256 amount,
        uint8 interestRateMode,
        uint256 borrowRate,
        uint16 indexed referralCode
    );
}

const CHUNK_SIZE: u64 = 50_000;

pub struct EventListener {
    pool: Address,
    history_blocks: u64,
}

impl EventListener {
    pub fn new(pool_address: &str, history_blocks: u64) -> Result<Self> {
        Ok(Self { pool: pool_address.parse()?, history_blocks })
    }

    /// Seed the watchlist from historical Borrow events (last 3 days).
    pub async fn seed_from_history<P: Provider>(
        &self,
        provider: &P,
        db: &Db,
    ) -> Result<usize> {
        let current_block = provider.get_block_number().await?;
        let from_block = current_block.saturating_sub(self.history_blocks);

        info!(from_block, to_block = current_block, "Seeding watchlist from Borrow history");

        let mut count = 0usize;
        let mut from = from_block;

        while from < current_block {
            let to = (from + CHUNK_SIZE - 1).min(current_block);

            let filter = Filter::new()
                .address(self.pool)
                .event_signature(Borrow::SIGNATURE_HASH)
                .from_block(BlockNumberOrTag::Number(from))
                .to_block(BlockNumberOrTag::Number(to));

            match provider.get_logs(&filter).await {
                Ok(logs) => {
                    for log in logs {
                        if let Ok(decoded) = log.log_decode::<Borrow>() {
                            let borrower = decoded.data().onBehalfOf;
                            let block = log.block_number.unwrap_or(from);
                            let _ = db.upsert_borrower(&borrower.to_string(), block);
                            count += 1;
                        }
                    }
                }
                Err(e) => {
                    warn!(from, to, "Chunk failed: {e}");
                }
            }

            from = to + 1;
        }

        info!(count, "Watchlist seeded from history");
        Ok(count)
    }

    /// Spawn a background task that watches for new Borrow events.
    pub fn spawn_live_watch<P: Provider + 'static>(
        &self,
        provider: Arc<P>,
        db: Arc<std::sync::Mutex<Db>>,
    ) {
        let pool = self.pool;

        tokio::spawn(async move {
            info!("EventListener: subscribing to Borrow events");

            let filter = Filter::new()
                .address(pool)
                .event_signature(Borrow::SIGNATURE_HASH);

            match provider.subscribe_logs(&filter).await {
                Ok(stream) => {
                    use futures::StreamExt;
                    tokio::pin!(stream);
                    while let Some(log) = stream.next().await {
                        let log: alloy::rpc::types::Log = log;
                        if let Ok(decoded) = log.log_decode::<Borrow>() {
                            let borrower = decoded.data().onBehalfOf;
                            let block = log.block_number.unwrap_or(0);
                            if let Ok(db_lock) = db.lock() {
                                let _ = db_lock.upsert_borrower(&borrower.to_string(), block);
                            }
                        }
                    }
                    warn!("Borrow event stream ended unexpectedly");
                }
                Err(e) => {
                    warn!("Failed to subscribe to Borrow events: {e}");
                    warn!("Live watchlist updates disabled (WebSocket required)");
                }
            }
        });
    }
}
