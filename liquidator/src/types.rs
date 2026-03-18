use alloy::primitives::Address;
use serde::{Deserialize, Serialize};

// ── Aave position data ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AccountData {
    pub address: Address,
    pub total_collateral_base: u128, // USD, 8 decimals
    pub total_debt_base: u128,       // USD, 8 decimals
    pub health_factor: u128,         // 1e18 = 1.0; < 1e18 = liquidatable
    pub liquidation_threshold: u128, // basis points
}

#[derive(Debug, Clone)]
pub struct UserReserveData {
    pub asset: Address,
    pub symbol: String,
    pub decimals: u8,
    pub a_token_balance: u128,  // collateral balance
    pub stable_debt: u128,
    pub variable_debt: u128,
    pub total_debt: u128,
    pub usage_as_collateral: bool,
    pub liquidation_bonus: u128, // e.g. 10500 = 5% bonus
    pub price_usd: u128,         // oracle price, 8 decimals
}

// ── Opportunity ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationOpportunity {
    pub borrower: Address,
    pub collateral_asset: Address,
    pub collateral_symbol: String,
    pub debt_asset: Address,
    pub debt_symbol: String,
    pub debt_to_cover: u128,
    pub gross_profit_wei: u128,      // liquidation bonus profit BEFORE gas deduction
    pub estimated_profit_wei: u128,  // net profit after single-tx gas (18 decimals)
    pub estimated_gas_wei: u128,
    pub uniswap_pool_fee: u32,       // 100 | 500 | 3000 | 10000
    pub min_profit_wei: u128,        // 80% of estimated — slippage buffer
    pub health_factor: u128,
}

// ── Rank result ───────────────────────────────────────────────────────────────

/// Return value from OpportunityRanker::find_best().
pub enum RankResult {
    /// Profitable enough for a single-tx liquidation.
    Profitable(LiquidationOpportunity),
    /// Liquidatable but below single-tx profitability threshold.
    /// Carries full opportunity data so batch grouping can use it.
    Skipped {
        opportunity: LiquidationOpportunity,
        /// How far below break-even (in wei). 0 if only below min_profit threshold.
        shortfall_wei: u128,
    },
    /// No valid collateral/debt position, or zero prices — nothing to do.
    Ineligible,
}

// ── Batch opportunity ─────────────────────────────────────────────────────────

/// A group of individually-unprofitable positions sharing the same debt asset
/// that together exceed the batch gas cost.
#[derive(Debug, Clone)]
pub struct BatchLiquidationOpportunity {
    pub debt_asset: Address,
    pub debt_asset_symbol: String,
    /// All positions in this batch. Each holds full calldata-ready data.
    pub positions: Vec<LiquidationOpportunity>,
    pub total_gross_profit_wei: u128,
    pub total_estimated_gas_wei: u128,
    pub min_total_profit_wei: u128, // 80% of (gross - gas) — slippage buffer
}

// ── Result ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationResult {
    pub success: bool,
    pub tx_hash: Option<String>,
    pub profit_eth: Option<f64>,
    pub error: Option<String>,
    pub borrower: Address,
    pub collateral_symbol: String,
    pub debt_symbol: String,
    pub was_shadow: bool,
}

// ── Missed opportunity ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissedOpportunity {
    pub borrower: Address,
    pub collateral_asset: Address,
    pub debt_asset: Address,
    pub profit_missed_eth: f64,
    pub winner_address: Address,
    pub winner_gas_gwei: f64,
    pub block_number: u64,
    pub timestamp: i64,
}

// ── Skipped opportunity (DB logging) ─────────────────────────────────────────

/// A position that was liquidatable but not profitable enough for a single tx.
/// Logged to skipped_opportunities table for autoresearch analysis.
#[derive(Debug, Clone)]
pub struct SkippedOpportunity {
    pub borrower: Address,
    pub debt_asset: Address,
    pub debt_asset_symbol: String,
    pub collateral_asset: Address,
    pub collateral_asset_symbol: String,
    pub estimated_profit_eth: f64,  // gross profit before gas
    pub gas_cost_eth: f64,          // single-tx gas cost
    pub shortfall_eth: f64,         // gas_cost - profit (positive = not profitable)
    pub chain: String,
    pub timestamp: i64,
}

// ── Watchlist entry ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct WatchlistEntry {
    pub address: Address,
    pub last_health_factor: Option<u128>,
    pub total_collateral_usd: Option<f64>,
    pub total_debt_usd: Option<f64>,
}
