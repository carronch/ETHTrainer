/// Heuristic parameters — compiled by the TS autoresearch loop nightly.
/// The Rust executor reads this file on startup and reloads when modified.
/// Written by: src/autoresearch/parameter_compiler.ts
/// Default values are used if the file doesn't exist yet (first run).

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, RwLock};
use tracing::{info, warn};

pub const PARAMS_FILE: &str = "heuristic_params.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HeuristicParams {
    /// Maximum gas price we'll pay (gwei). Autoresearch tunes this up/down.
    pub max_gas_gwei: f64,

    /// Minimum net profit to attempt a liquidation (ETH).
    pub min_profit_eth: f64,

    /// Health factor threshold to start watching a position closely.
    /// Positions below this get added to the pre-alert queue.
    pub hf_alert_threshold: f64,

    /// How often to scan the full watchlist (milliseconds).
    pub scan_interval_ms: u64,

    /// How many addresses to check per multicall batch.
    pub scan_batch_size: usize,

    /// Conservative gas estimate for one liquidation (gas units).
    pub gas_estimate_liquidation: u64,

    /// Consecutive tx failures before triggering circuit breaker.
    pub circuit_breaker_failures: u32,

    /// How long to pause after circuit breaker triggers (seconds).
    pub circuit_breaker_pause_secs: u64,

    /// Metadata — written by the autoresearch loop.
    pub version: u32,
    pub updated_at: Option<i64>,
    pub rationale: Option<String>,
}

impl Default for HeuristicParams {
    fn default() -> Self {
        Self {
            max_gas_gwei: 1.0,
            min_profit_eth: 0.005,
            hf_alert_threshold: 1.08,
            scan_interval_ms: 12_000,
            scan_batch_size: 50,
            gas_estimate_liquidation: 900_000,
            circuit_breaker_failures: 3,
            circuit_breaker_pause_secs: 3600,
            version: 0,
            updated_at: None,
            rationale: Some("Default seed parameters".to_string()),
        }
    }
}

impl HeuristicParams {
    pub fn load_or_default(path: &str) -> Self {
        if !Path::new(path).exists() {
            warn!("heuristic_params.json not found, using defaults");
            return Self::default();
        }
        match std::fs::read_to_string(path) {
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(params) => {
                    info!(version = ?{let p: HeuristicParams = params; p.version}, "Loaded heuristic params");
                    serde_json::from_str(&contents).unwrap_or_default()
                }
                Err(e) => {
                    warn!("Failed to parse heuristic_params.json: {e}, using defaults");
                    Self::default()
                }
            },
            Err(e) => {
                warn!("Failed to read heuristic_params.json: {e}, using defaults");
                Self::default()
            }
        }
    }

    /// Minimum profit in wei (u128), derived from ETH float param.
    pub fn min_profit_wei(&self) -> u128 {
        (self.min_profit_eth * 1e18) as u128
    }

    /// Max gas in wei per unit.
    pub fn max_gas_wei(&self) -> u128 {
        (self.max_gas_gwei * 1e9) as u128
    }

    /// Health factor threshold scaled to 1e18 units (Aave's format).
    pub fn hf_threshold_scaled(&self) -> u128 {
        (self.hf_alert_threshold * 1e18) as u128
    }
}

// ── Hot-reloadable params wrapper ─────────────────────────────────────────────

pub type SharedParams = Arc<RwLock<HeuristicParams>>;

pub fn make_shared(params: HeuristicParams) -> SharedParams {
    Arc::new(RwLock::new(params))
}

/// Spawns a background task that watches heuristic_params.json for changes
/// and reloads automatically. Changes take effect on the next scan cycle.
pub fn spawn_reload_watcher(shared: SharedParams, path: String) {
    tokio::spawn(async move {
        use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
        use std::sync::mpsc;
        use std::time::Duration;

        let (tx, rx) = mpsc::channel();
        let mut watcher = RecommendedWatcher::new(tx, Config::default()).unwrap();

        if let Err(e) = watcher.watch(Path::new(&path), RecursiveMode::NonRecursive) {
            warn!("Cannot watch {path}: {e}. Params will not auto-reload.");
            return;
        }

        info!("Watching {path} for parameter updates");

        loop {
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(_event)) => {
                    tokio::time::sleep(Duration::from_millis(200)).await; // debounce
                    let new_params = HeuristicParams::load_or_default(&path);
                    let version = new_params.version;
                    if let Ok(mut p) = shared.write() {
                        *p = new_params;
                        info!(version, "Reloaded heuristic params from disk");
                    }
                }
                Ok(Err(e)) => warn!("File watch error: {e}"),
                Err(_) => {} // timeout — keep looping
            }
        }
    });
}

/// Write current defaults to disk (used on first run to create the file).
pub fn write_defaults(path: &str) -> Result<()> {
    let defaults = HeuristicParams::default();
    let json = serde_json::to_string_pretty(&defaults)?;
    std::fs::write(path, json)?;
    info!("Wrote default heuristic_params.json to {path}");
    Ok(())
}
