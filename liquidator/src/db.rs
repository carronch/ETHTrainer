/// SQLite integration for the Rust executor.
/// Reads the watchlist (written by TS event listener + autoresearch).
/// Writes trade results and missed opportunities (read by TS autoresearch).

use crate::types::{AccountData, LiquidationResult, MissedOpportunity};
use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::Path;
use tracing::warn;

pub struct Db {
    conn: Connection,
    chain: String,
}

impl Db {
    pub fn open(path: &str, chain: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch(Self::SCHEMA_SQL)?;
        Ok(Self { conn, chain: chain.to_string() })
    }

    const SCHEMA_SQL: &'static str = "
        CREATE TABLE IF NOT EXISTS liquidation_watchlist (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            address               TEXT NOT NULL,
            network               TEXT NOT NULL DEFAULT 'arbitrum',
            first_seen_block      TEXT,
            last_checked_block    TEXT,
            last_health_factor    TEXT,
            total_collateral_usd  REAL,
            total_debt_usd        REAL,
            is_active             INTEGER NOT NULL DEFAULT 1,
            created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(address, network)
        );
        CREATE TABLE IF NOT EXISTS trades (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            tx_hash      TEXT UNIQUE,
            strategy     TEXT NOT NULL,
            action       TEXT NOT NULL,
            network      TEXT NOT NULL DEFAULT 'arbitrum',
            from_addr    TEXT NOT NULL,
            to_addr      TEXT NOT NULL,
            value_wei    TEXT NOT NULL DEFAULT '0',
            gas_used     TEXT,
            gas_price    TEXT,
            status       TEXT NOT NULL DEFAULT 'pending',
            profit_eth   REAL,
            notes        TEXT,
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            confirmed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS missed_opportunities (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            borrower          TEXT NOT NULL,
            collateral_asset  TEXT NOT NULL,
            debt_asset        TEXT NOT NULL,
            profit_missed_eth REAL,
            winner_address    TEXT NOT NULL,
            winner_gas_gwei   REAL,
            block_number      INTEGER NOT NULL,
            timestamp         INTEGER NOT NULL DEFAULT (unixepoch()),
            chain             TEXT NOT NULL DEFAULT 'arbitrum',
            analyzed          INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS agent_logs (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            agent      TEXT NOT NULL,
            level      TEXT NOT NULL DEFAULT 'info',
            message    TEXT NOT NULL,
            metadata   TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_network ON liquidation_watchlist (network, is_active);
        CREATE INDEX IF NOT EXISTS idx_watchlist_hf      ON liquidation_watchlist (last_health_factor);
        CREATE INDEX IF NOT EXISTS idx_missed_opps_chain ON missed_opportunities (chain, analyzed);
        CREATE INDEX IF NOT EXISTS idx_trades_status     ON trades (status);
    ";

    // ── Watchlist reads ───────────────────────────────────────────────────────

    /// Fetch all active Arbitrum borrowers, ordered by health factor ascending
    /// (most at-risk positions first).
    pub fn get_active_watchlist(&self) -> Result<Vec<alloy::primitives::Address>> {
        let mut stmt = self.conn.prepare(
            "SELECT address FROM liquidation_watchlist
             WHERE network = ? AND is_active = 1
             ORDER BY CAST(last_health_factor AS REAL) ASC NULLS LAST",
        )?;
        let addresses: Vec<alloy::primitives::Address> = stmt
            .query_map(params![self.chain], |row| {
                let addr: String = row.get(0)?;
                Ok(addr)
            })?
            .filter_map(|r| {
                r.ok().and_then(|s: String| s.parse().ok())
            })
            .collect();
        Ok(addresses)
    }

    pub fn watchlist_size(&self) -> Result<usize> {
        let n: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM liquidation_watchlist WHERE network = ? AND is_active = 1",
            params![self.chain],
            |row| row.get(0),
        )?;
        Ok(n)
    }

    // ── Watchlist writes ──────────────────────────────────────────────────────

    pub fn upsert_borrower(
        &self,
        address: &str,
        first_seen_block: u64,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO liquidation_watchlist (address, network, first_seen_block)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(address, network) DO NOTHING",
            params![address.to_lowercase(), self.chain, first_seen_block.to_string()],
        )?;
        Ok(())
    }

    pub fn update_health_factor(
        &self,
        address: &str,
        health_factor: u128,
        collateral_usd: f64,
        debt_usd: f64,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE liquidation_watchlist
             SET last_health_factor   = ?1,
                 total_collateral_usd = ?2,
                 total_debt_usd       = ?3,
                 updated_at           = unixepoch()
             WHERE address = ?4",
            params![
                health_factor.to_string(),
                collateral_usd,
                debt_usd,
                address.to_lowercase(),
            ],
        )?;
        Ok(())
    }

    // ── Trade logging ─────────────────────────────────────────────────────────

    /// Log a liquidation attempt before submission. Returns the row id.
    pub fn insert_trade_pending(
        &self,
        borrower: &str,
        collateral_symbol: &str,
        debt_symbol: &str,
        estimated_profit_eth: f64,
        shadow_mode: bool,
    ) -> Result<i64> {
        let notes = serde_json::json!({
            "borrower": borrower,
            "collateral": collateral_symbol,
            "debt": debt_symbol,
            "estimated_profit_eth": estimated_profit_eth,
            "shadow": shadow_mode,
        })
        .to_string();

        self.conn.execute(
            "INSERT INTO trades
             (strategy, action, network, from_addr, to_addr, value_wei, status, notes)
             VALUES ('liquidation-bots', 'liquidate', ?1, '', '', '0', 'pending', ?2)",
            params![self.chain, notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Update trade after confirmation.
    pub fn confirm_trade(
        &self,
        row_id: i64,
        tx_hash: &str,
        status: &str,
        profit_eth: Option<f64>,
        gas_used: Option<u64>,
        gas_price: Option<u128>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE trades
             SET tx_hash      = ?1,
                 status       = ?2,
                 profit_eth   = ?3,
                 gas_used     = ?4,
                 gas_price    = ?5,
                 confirmed_at = unixepoch()
             WHERE id = ?6",
            params![
                tx_hash,
                status,
                profit_eth,
                gas_used.map(|g| g.to_string()),
                gas_price.map(|g| g.to_string()),
                row_id,
            ],
        )?;
        Ok(())
    }

    // ── Missed opportunity logging ────────────────────────────────────────────
    // These are critical for the autoresearch loop.

    pub fn insert_missed_opportunity(&self, opp: &MissedOpportunity) -> Result<()> {
        self.conn.execute(
            "INSERT INTO missed_opportunities
             (borrower, collateral_asset, debt_asset, profit_missed_eth,
              winner_address, winner_gas_gwei, block_number, timestamp, chain)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                opp.borrower.to_string().to_lowercase(),
                opp.collateral_asset.to_string().to_lowercase(),
                opp.debt_asset.to_string().to_lowercase(),
                opp.profit_missed_eth,
                opp.winner_address.to_string().to_lowercase(),
                opp.winner_gas_gwei,
                opp.block_number,
                opp.timestamp,
                self.chain,
            ],
        )?;
        Ok(())
    }

    // ── Agent log ─────────────────────────────────────────────────────────────

    pub fn log(&self, level: &str, message: &str, metadata: Option<serde_json::Value>) {
        let meta_str = metadata.map(|m| m.to_string());
        if let Err(e) = self.conn.execute(
            "INSERT INTO agent_logs (agent, level, message, metadata)
             VALUES ('liquidator-rust', ?1, ?2, ?3)",
            params![level, message, meta_str],
        ) {
            warn!("Failed to write agent log: {e}");
        }
    }
}
