/// HotTracker — block-subscription fast path for near-liquidation positions.
///
/// On L2s the sequencer is FIFO (first-in-first-out), not ordered by gas price.
/// Speed wins, not gas bidding. This tracker subscribes to new block headers via
/// WebSocket and, on every block, scans only the "danger zone" addresses
/// (HF between 0.90 and hf_hot_threshold) for sub-block-time detection.
///
/// Runs in parallel with the normal 3s scan loop.
/// Shares an `in_flight` set with the main loop to prevent double-submission.

use crate::config::HeuristicParams;
use crate::db::Db;
use crate::health_scanner::HealthScanner;
use crate::opportunity_ranker::OpportunityRanker;
use crate::tx_submitter::TxSubmitter;
use crate::types::RankResult;
use alloy::{
    primitives::Address,
    providers::{Provider, WalletProvider},
};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
use tracing::{debug, info, warn};

/// Spawn the hot tracker background task.
///
/// - `W`  — WS provider (block subscription only, no wallet needed)
/// - `P`  — HTTP provider (health scan + tx submission, must have WalletProvider)
pub fn spawn<W, P>(
    ws_provider:     Arc<W>,
    db:              Arc<Mutex<Db>>,
    scanner:         Arc<HealthScanner<P>>,
    ranker:          Arc<OpportunityRanker<P>>,
    submitter:       Arc<TxSubmitter<P>>,
    shared_params:   crate::config::SharedParams,
    in_flight:       Arc<Mutex<HashSet<Address>>>,
    chain_name:      &'static str,
) where
    W: Provider + 'static,
    P: Provider + WalletProvider + 'static,
{
    tokio::spawn(async move {
        info!("[HotTracker] Starting block-subscription hot path (chain={})", chain_name);

        loop {
            match ws_provider.subscribe_blocks().await {
                Ok(mut stream) => {
                    loop {
                        match stream.recv().await {
                            Ok(header) => {
                                let params: HeuristicParams = shared_params.read().unwrap().clone();

                                // Pull danger-zone addresses (brief synchronous lock)
                                let danger_zone: Vec<Address> = {
                                    let db_lock = db.lock().unwrap();
                                    db_lock
                                        .get_danger_zone_watchlist(
                                            params.hf_hot_threshold,
                                            params.hot_scan_cap,
                                        )
                                        .unwrap_or_default()
                                };

                                if danger_zone.is_empty() {
                                    continue;
                                }

                                debug!(
                                    block  = header.number,
                                    count  = danger_zone.len(),
                                    chain  = chain_name,
                                    "[HotTracker] Scanning danger zone"
                                );

                                // Scan HF — no lock held across async RPC calls
                                let scanned = scanner.scan_addresses(&danger_zone, &params).await;

                                // Update DB HFs + collect those that crossed below 1.0
                                let liquidatable: Vec<_> = {
                                    let db_lock = db.lock().unwrap();
                                    scanned.into_iter().filter(|data| {
                                        let col_usd  = data.total_collateral_base as f64 / 1e8;
                                        let debt_usd = data.total_debt_base as f64 / 1e8;
                                        let _ = db_lock.update_health_factor(
                                            &data.address.to_string(),
                                            data.health_factor,
                                            col_usd,
                                            debt_usd,
                                        );
                                        data.health_factor < 1_000_000_000_000_000_000u128
                                    }).collect()
                                };

                                for account in &liquidatable {
                                    // Dedup: skip if main loop (or previous hot cycle) already owns it
                                    {
                                        let mut flight = in_flight.lock().unwrap();
                                        if flight.contains(&account.address) {
                                            debug!(borrower = ?account.address, "[HotTracker] Already in-flight, skipping");
                                            continue;
                                        }
                                        flight.insert(account.address);
                                    }

                                    match ranker.find_best(account, &params).await {
                                        Ok(RankResult::Profitable(opp)) => {
                                            info!(
                                                block      = header.number,
                                                borrower   = ?opp.borrower,
                                                profit_eth = opp.estimated_profit_wei as f64 / 1e18,
                                                "[HotTracker] 🔥 Profitable — submitting"
                                            );

                                            let result = submitter.execute(&opp, &db, &params).await;
                                            in_flight.lock().unwrap().remove(&opp.borrower);

                                            if result.success {
                                                info!(
                                                    tx_hash    = result.tx_hash,
                                                    profit_eth = result.profit_eth,
                                                    "[HotTracker] ✅ Liquidation SUCCESS"
                                                );
                                            }
                                        }
                                        Ok(_) => {
                                            // Skipped or Ineligible — remove from in-flight
                                            in_flight.lock().unwrap().remove(&account.address);
                                        }
                                        Err(e) => {
                                            warn!(borrower = ?account.address, "[HotTracker] Ranker error: {e}");
                                            in_flight.lock().unwrap().remove(&account.address);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("[HotTracker] Block stream ended: {e} — reconnecting in 3s");
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("[HotTracker] Subscribe failed: {e} — retrying in 3s");
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}
