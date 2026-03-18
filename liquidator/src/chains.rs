/// Chain configuration — Aave v3 contract addresses, RPC env var names,
/// and chain-specific constants for each supported network.
///
/// Verify addresses at: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/
///
/// To add a new chain:
///   1. Add a ChainConfig constant below
///   2. Add it to the match in get_chain()
///   3. Add RPC env vars to .dev.vars
///   4. Deploy LiquidationBot.sol on the new chain
///   5. Add a new pm2 process in ecosystem.config.cjs

use anyhow::{anyhow, Result};

// ── Chain config struct ────────────────────────────────────────────────────────

pub struct ChainConfig {
    /// Short name used in CLI, log messages, DB records, and params file names.
    pub name: &'static str,

    /// EVM chain ID.
    pub chain_id: u64,

    /// Env var name for the HTTPS RPC URL.
    pub rpc_url_env: &'static str,

    /// Env var name for the WebSocket RPC URL.
    pub rpc_ws_url_env: &'static str,

    /// Env var name for the deployed LiquidationBot contract address.
    pub bot_address_env: &'static str,

    /// Aave v3 Pool (PoolProxy) address.
    pub aave_pool: &'static str,

    /// Aave v3 Pool Data Provider address.
    pub aave_data_provider: &'static str,

    /// Aave v3 Price Oracle address.
    pub aave_oracle: &'static str,

    /// Approximate number of blocks in 3 days (used for watchlist history seed).
    /// Arbitrum: ~4 blocks/sec → 1,036,800. Optimism/Base: ~2 sec/block → 129,600.
    pub history_blocks: u64,

    /// Lowercase token addresses treated as stablecoins (use 0.01% Uniswap pool fee).
    pub stable_tokens: &'static [&'static str],

    /// Lowercase WETH and WBTC addresses (use 0.05% Uniswap pool fee).
    pub major_tokens: &'static [&'static str],

    /// WETH address on this chain — used by OpportunityRanker to look up live ETH/USD from oracle.
    pub weth_address: &'static str,
}

// ── Chain presets ─────────────────────────────────────────────────────────────

pub const ARBITRUM: ChainConfig = ChainConfig {
    name: "arbitrum",
    chain_id: 42161,
    rpc_url_env: "ARBITRUM_RPC_URL",
    rpc_ws_url_env: "ARBITRUM_RPC_URL_WS",
    bot_address_env: "LIQUIDATION_BOT_ADDRESS",
    // Verified: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/arbitrum
    aave_pool:          "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aave_data_provider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    aave_oracle:        "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
    history_blocks: 1_036_800, // 3 days @ ~4 blocks/sec
    stable_tokens: &[
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC
        "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", // USDC.e
        "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // USDT
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
    ],
    major_tokens: &[
        "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH
        "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", // WBTC
    ],
    weth_address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
};

pub const OPTIMISM: ChainConfig = ChainConfig {
    name: "optimism",
    chain_id: 10,
    rpc_url_env: "OPTIMISM_RPC_URL",
    rpc_ws_url_env: "OPTIMISM_RPC_URL_WS",
    bot_address_env: "LIQUIDATION_BOT_ADDRESS_OPTIMISM",
    // Verified: https://docs.aave.com/developers/deployed-contracts/v3-mainnet/optimism
    aave_pool:          "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aave_data_provider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    aave_oracle:        "0xD81eb3728a631871a7eBBaD631b5f424909f0c77",
    history_blocks: 129_600, // 3 days @ ~2 sec/block
    stable_tokens: &[
        "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // USDC (native)
        "0x7f5c764cbc14f9669b88837ca1490cca17c31607", // USDC.e (bridged)
        "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", // USDT
        "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", // DAI
    ],
    major_tokens: &[
        "0x4200000000000000000000000000000000000006", // WETH (OP Stack canonical)
        "0x68f180fcce6836688e9084f035309e29bf0a2095", // WBTC
    ],
    weth_address: "0x4200000000000000000000000000000000000006",
};

pub const BASE: ChainConfig = ChainConfig {
    name: "base",
    chain_id: 8453,
    rpc_url_env: "BASE_RPC_URL",
    rpc_ws_url_env: "BASE_RPC_URL_WS",
    bot_address_env: "LIQUIDATION_BOT_ADDRESS_BASE",
    // ⚠️ Verified at bgd-labs aave-address-book
    aave_pool:          "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    aave_data_provider: "0x2d8A3C5677189723C4cB8873CfC9C8976ddf54D8",
    aave_oracle:        "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    history_blocks: 129_600, // 3 days @ ~2 sec/block
    stable_tokens: &[
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC (native)
        "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC (bridged)
        "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
    ],
    major_tokens: &[
        "0x4200000000000000000000000000000000000006", // WETH (OP Stack canonical)
        "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC
    ],
    weth_address: "0x4200000000000000000000000000000000000006",
};

// ── Lookup ────────────────────────────────────────────────────────────────────

pub fn get_chain(name: &str) -> Result<&'static ChainConfig> {
    match name {
        "arbitrum" => Ok(&ARBITRUM),
        "optimism" => Ok(&OPTIMISM),
        "base"     => Ok(&BASE),
        other => Err(anyhow!(
            "Unknown chain '{}'. Supported: arbitrum, optimism, base",
            other
        )),
    }
}

impl ChainConfig {
    /// Returns a map of lowercase token address → ticker symbol for well-known
    /// Aave v3 reserves on this chain. Used by OpportunityRanker to produce
    /// human-readable symbols in logs, trades table, and Telegram alerts.
    pub fn token_symbols(&self) -> std::collections::HashMap<String, &'static str> {
        let pairs: &[(&str, &str)] = match self.name {
            "arbitrum" => &[
                ("0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC"),
                ("0xff970a61a04b1ca14834a43f5de4533ebddb5cc8", "USDC.e"),
                ("0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "USDT"),
                ("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", "DAI"),
                ("0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "WETH"),
                ("0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", "WBTC"),
                ("0x5979d7b546e38e414f7e9822514be443a4800529", "wstETH"),
                ("0x35751007a407ca6feffe80b3cb397736d2cf4dbe", "weETH"),
                ("0x912ce59144191c1204e64559fe8253a0e49e6548", "ARB"),
                ("0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8", "rETH"),
                ("0xf97f4df75117a78c1a5a0dbb814af92458539fb4", "LINK"),
            ],
            "base" => &[
                ("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC"),
                ("0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", "USDbC"),
                ("0x50c5725949a6f0c72e6c4a641f24049a917db0cb", "DAI"),
                ("0x4200000000000000000000000000000000000006", "WETH"),
                ("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "cbBTC"),
                ("0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", "cbETH"),
                ("0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", "wstETH"),
                ("0x04c0599ae5a44757c0af6f9ec3b93da8976c150a", "weETH"),
            ],
            "optimism" => &[
                ("0x0b2c639c533813f4aa9d7837caf62653d097ff85", "USDC"),
                ("0x7f5c764cbc14f9669b88837ca1490cca17c31607", "USDC.e"),
                ("0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", "USDT"),
                ("0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", "DAI"),
                ("0x4200000000000000000000000000000000000006", "WETH"),
                ("0x68f180fcce6836688e9084f035309e29bf0a2095", "WBTC"),
                ("0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", "wstETH"),
                ("0x9bcef72be871e61ed4fbbc7630889bee758eb81d", "rETH"),
                ("0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6", "LINK"),
                ("0x4200000000000000000000000000000000000042", "OP"),
            ],
            _ => &[],
        };
        pairs.iter().map(|&(addr, sym)| (addr.to_string(), sym)).collect()
    }
}
