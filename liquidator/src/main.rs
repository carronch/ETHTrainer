/// ETHTrainer — Rust Liquidation Executor
///
/// Layer 1 of the 3-layer architecture:
///   - Always-on, no LLM in the hot path
///   - Reads compiled heuristic parameters from heuristic_params.<chain>.json
///   - Parameters updated nightly by the TS autoresearch loop (Layer 2)
///
/// Modes:
///   --shadow   Detect + simulate opportunities but never submit real txs.
///              Used for 72h validation before going live.
///   --live     Submit real transactions (default after validation).

mod chains;
mod config;
mod db;
mod event_listener;
mod health_scanner;
mod missed_tracker;
mod opportunity_ranker;
mod tx_submitter;
mod types;

use anyhow::{Context, Result};
use clap::Parser;
use config::HeuristicParams;
use dotenvy::dotenv;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use types::{LiquidationOpportunity, RankResult, SkippedOpportunity};
use chrono::Utc;

// ── CLI ───────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(name = "liquidator", about = "ETHTrainer Aave v3 Liquidation Bot")]
struct Args {
    /// Shadow mode: detect opportunities but do NOT submit transactions.
    /// Use this for the 72h validation phases before going live.
    #[arg(long, default_value_t = false)]
    shadow: bool,

    /// Which chain to run on: arbitrum, base, optimism
    #[arg(long, default_value = "arbitrum")]
    chain: String,

    /// Override the HTTP RPC URL (defaults to <CHAIN>_RPC_URL env var)
    #[arg(long)]
    rpc_url: Option<String>,

    /// Override the WebSocket URL (defaults to <CHAIN>_RPC_URL_WS env var)
    #[arg(long)]
    rpc_ws_url: Option<String>,

    /// Path to the SQLite database file
    #[arg(long, default_value = "ethtrainer.db")]
    db_path: String,

    /// Deployed LiquidationBot contract address
    /// (can also be set via the chain's bot_address_env var)
    #[arg(long)]
    bot_address: Option<String>,

    /// Path to the encrypted keystore JSON file
    #[arg(long, default_value = "~/.ethtrainer/keystore.json")]
    keystore: String,
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    // Load .dev.vars environment (fall back to .env if not found)
    let _ = dotenvy::from_filename(".dev.vars").or_else(|_| dotenv());

    // Structured logging
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive("liquidator=info".parse()?))
        .init();

    let args = Args::parse();

    // ── Chain config ──────────────────────────────────────────────────────────

    let chain = chains::get_chain(&args.chain)?;
    info!(shadow = args.shadow, chain = chain.name, "ETHTrainer Liquidator starting");

    // ── Load or create heuristic_params.<chain>.json ──────────────────────────

    let params_file = format!("heuristic_params.{}.json", chain.name);
    if !std::path::Path::new(&params_file).exists() {
        info!("No {params_file} found — writing defaults");
        config::write_defaults(&params_file)?;
    }

    let initial_params = HeuristicParams::load_or_default(&params_file);
    info!(
        max_gas_gwei   = initial_params.max_gas_gwei,
        min_profit_eth = initial_params.min_profit_eth,
        scan_interval  = initial_params.scan_interval_ms,
        version        = initial_params.version,
        "Loaded heuristic params"
    );

    let shared_params = config::make_shared(initial_params);
    config::spawn_reload_watcher(shared_params.clone(), params_file.clone());

    // ── Database ──────────────────────────────────────────────────────────────

    let db = db::Db::open(&args.db_path, chain.name).context("Failed to open SQLite database")?;
    let db = Arc::new(std::sync::Mutex::new(db));

    // ── Wallet ────────────────────────────────────────────────────────────────

    let keystore_path = args.keystore.replace('~', &std::env::var("HOME").unwrap_or_default());
    let keystore_password = std::env::var("KEYSTORE_PASSWORD")
        .context("KEYSTORE_PASSWORD not set — add it to .dev.vars")?;

    let signer = alloy::signers::local::PrivateKeySigner::decrypt_keystore(
        &keystore_path,
        &keystore_password,
    )
    .context(format!("Failed to decrypt keystore at {keystore_path}"))?;

    info!(address = ?signer.address(), "Trading wallet loaded");

    // ── Ethereum provider (HTTP) ──────────────────────────────────────────────

    let rpc_url = args
        .rpc_url
        .or_else(|| std::env::var(chain.rpc_url_env).ok())
        .context(format!("{} not set", chain.rpc_url_env))?;

    let rpc_ws_url = args
        .rpc_ws_url
        .or_else(|| std::env::var(chain.rpc_ws_url_env).ok());

    // HTTP provider for reads + tx submission
    let provider = alloy::providers::ProviderBuilder::new()
        .wallet(alloy::network::EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);
    let provider = Arc::new(provider);

    // ── Contract addresses ────────────────────────────────────────────────────

    let bot_address_str = args
        .bot_address
        .or_else(|| std::env::var(chain.bot_address_env).ok())
        .context(format!("{} not set — run: npm run deploy:liquidation", chain.bot_address_env))?;

    let bot_address: alloy::primitives::Address = bot_address_str
        .parse()
        .context("Invalid bot contract address")?;

    let pool_address: alloy::primitives::Address = chain.aave_pool
        .parse()
        .context("Invalid aave_pool address in chain config")?;

    // ── Components ────────────────────────────────────────────────────────────

    let health_scanner     = health_scanner::HealthScanner::new(provider.clone(), chain.aave_pool)?;
    let opportunity_ranker = opportunity_ranker::OpportunityRanker::new(
        provider.clone(),
        chain.aave_pool,
        chain.aave_data_provider,
        chain.aave_oracle,
        chain.stable_tokens,
        chain.major_tokens,
    )?;
    let tx_submitter   = tx_submitter::TxSubmitter::new(provider.clone(), bot_address, pool_address, args.shadow);
    let event_listener = event_listener::EventListener::new(chain.aave_pool, chain.history_blocks)?;
    let missed_tracker = missed_tracker::MissedTracker::new(chain.aave_pool)?;

    // ── Startup: seed watchlist from history ──────────────────────────────────

    {
        let db_lock = db.lock().unwrap();
        let size = db_lock.watchlist_size().unwrap_or(0);
        if size == 0 {
            info!(
                blocks = chain.history_blocks,
                "Watchlist empty — seeding from Borrow history"
            );
            match event_listener.seed_from_history(&*provider, &db_lock).await {
                Ok(n) => info!(n, "Watchlist seeded"),
                Err(e) => warn!("History seed failed: {e}"),
            }
        } else {
            info!(size, "Watchlist already populated");
        }
    }

    // ── Live event subscriptions (WebSocket) ──────────────────────────────────
    // Best-effort — bot works without WS but won't pick up new borrowers in real-time.
    if let Some(ws_url) = rpc_ws_url {
        match alloy::providers::ProviderBuilder::new()
            .connect_ws(alloy::transports::ws::WsConnect::new(ws_url))
            .await
        {
            Ok(ws_provider) => {
                let ws_provider = Arc::new(ws_provider);
                event_listener.spawn_live_watch(ws_provider.clone(), db.clone());
                missed_tracker.spawn(ws_provider, db.clone());
                info!("WebSocket subscriptions active");
            }
            Err(e) => warn!("WS connection failed: {e}. Live events disabled."),
        }
    } else {
        warn!("{} not set — live event subscriptions disabled", chain.rpc_ws_url_env);
    }

    // ── Main scan loop ────────────────────────────────────────────────────────

    info!(
        shadow = args.shadow,
        chain = chain.name,
        "Starting scan loop. Press Ctrl+C to stop."
    );

    let mut cycle = 0u64;

    loop {
        cycle += 1;
        let params = shared_params.read().unwrap().clone();

        // Load watchlist (brief lock — synchronous only)
        let addresses = {
            let db_lock = db.lock().unwrap();
            match db_lock.get_active_watchlist() {
                Ok(a) => a,
                Err(e) => { error!("Failed to read watchlist: {e}"); vec![] }
            }
        };

        // Scan health factors — no lock held across async RPC calls
        let scanned = health_scanner.scan_addresses(&addresses, &params).await;

        // Write health factor updates back (brief lock per batch — synchronous only)
        let liquidatable: Vec<_> = {
            let db_lock = db.lock().unwrap();
            scanned.into_iter().filter(|data| {
                let collateral_usd = data.total_collateral_base as f64 / 1e8;
                let debt_usd = data.total_debt_base as f64 / 1e8;
                let _ = db_lock.update_health_factor(
                    &data.address.to_string(),
                    data.health_factor,
                    collateral_usd,
                    debt_usd,
                );
                data.health_factor < 1_000_000_000_000_000_000u128
            }).collect()
        };

        if !liquidatable.is_empty() {
            info!(found = liquidatable.len(), scanned = addresses.len(), "Liquidatable positions found");
        }

        // Process each liquidatable position
        let mut batch_candidates: Vec<LiquidationOpportunity> = Vec::new();

        for account in &liquidatable {
            match opportunity_ranker.find_best(account, &params).await {
                Ok(RankResult::Profitable(opp)) => {
                    info!(
                        borrower      = ?opp.borrower,
                        collateral    = opp.collateral_symbol,
                        debt          = opp.debt_symbol,
                        profit_eth    = opp.estimated_profit_wei as f64 / 1e18,
                        health_factor = account.health_factor as f64 / 1e18,
                        "Liquidation opportunity found"
                    );

                    let result = tx_submitter.execute(&opp, &db, &params).await;

                    if result.success {
                        if args.shadow {
                            info!(profit_eth = result.profit_eth, "[SHADOW] Would have earned");
                        } else {
                            info!(
                                tx_hash = result.tx_hash,
                                profit_eth = result.profit_eth,
                                "Liquidation SUCCESS"
                            );
                        }
                    }
                }
                Ok(RankResult::Skipped { opportunity: opp, shortfall_wei }) => {
                    // Log to DB for autoresearch analysis
                    let skipped = SkippedOpportunity {
                        borrower:                opp.borrower,
                        debt_asset:              opp.debt_asset,
                        debt_asset_symbol:       opp.debt_symbol.clone(),
                        collateral_asset:        opp.collateral_asset,
                        collateral_asset_symbol: opp.collateral_symbol.clone(),
                        estimated_profit_eth:    opp.gross_profit_wei as f64 / 1e18,
                        gas_cost_eth:            opp.estimated_gas_wei as f64 / 1e18,
                        shortfall_eth:           shortfall_wei as f64 / 1e18,
                        chain:                   chain.name.to_string(),
                        timestamp:               Utc::now().timestamp(),
                    };
                    if let Err(e) = db.lock().unwrap().insert_skipped(&skipped) {
                        warn!("Failed to log skipped opportunity: {e}");
                    }
                    // Queue as batch candidate
                    batch_candidates.push(opp);
                }
                Ok(RankResult::Ineligible) => {
                    // No valid position (no collateral/debt or zero prices)
                }
                Err(e) => {
                    warn!(borrower = ?account.address, "Opportunity finder error: {e}");
                }
            }
        }

        // ── Batch pass ────────────────────────────────────────────────────────
        // Group individually-unprofitable positions by debt asset and attempt
        // a batch liquidation if the collective profit covers batch gas overhead.
        if batch_candidates.len() >= 2 {
            let batches = opportunity_ranker
                .find_batch_candidates(&batch_candidates, &params)
                .await;

            for batch in &batches {
                info!(
                    debt_asset = ?batch.debt_asset,
                    positions  = batch.positions.len(),
                    gross_profit_eth = batch.total_gross_profit_wei as f64 / 1e18,
                    gas_eth          = batch.total_estimated_gas_wei as f64 / 1e18,
                    "Batch liquidation opportunity found"
                );

                let result = tx_submitter.execute_batch(batch, &db, &params).await;

                if result.success {
                    if args.shadow {
                        info!(profit_eth = result.profit_eth, positions = batch.positions.len(), "[SHADOW] Batch would have earned");
                    } else {
                        info!(
                            tx_hash    = result.tx_hash,
                            profit_eth = result.profit_eth,
                            positions  = batch.positions.len(),
                            "Batch liquidation SUCCESS"
                        );
                    }
                }
            }
        }

        // Periodic status log every 50 cycles
        if cycle % 50 == 0 {
            let watchlist_size = db.lock().unwrap().watchlist_size().unwrap_or(0);
            info!(
                cycle,
                watchlist_size,
                chain = chain.name,
                shadow = args.shadow,
                "Scan cycle complete"
            );
        }

        sleep(Duration::from_millis(params.scan_interval_ms)).await;
    }
}
