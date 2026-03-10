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
    pub estimated_profit_wei: u128,  // in ETH (18 decimals)
    pub estimated_gas_wei: u128,
    pub uniswap_pool_fee: u32,       // 100 | 500 | 3000 | 10000
    pub min_profit_wei: u128,        // 80% of estimated — slippage buffer
    pub health_factor: u128,
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

// ── Watchlist entry ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct WatchlistEntry {
    pub address: Address,
    pub last_health_factor: Option<u128>,
    pub total_collateral_usd: Option<f64>,
    pub total_debt_usd: Option<f64>,
}
