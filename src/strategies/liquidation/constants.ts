import type { Address } from 'viem'

// ── Aave v3 Arbitrum ──────────────────────────────────────────────────────────

export const AAVE_POOL_ARBITRUM = '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as Address
export const AAVE_DATA_PROVIDER_ARBITRUM = '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654' as Address
export const AAVE_ORACLE_ARBITRUM = '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C' as Address

// ── Aave v3 Ethereum Mainnet ──────────────────────────────────────────────────

export const AAVE_POOL_MAINNET = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as Address
export const AAVE_DATA_PROVIDER_MAINNET = '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3' as Address

// ── Uniswap v3 SwapRouter02 ───────────────────────────────────────────────────

export const UNISWAP_ROUTER_ARBITRUM = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address
export const UNISWAP_ROUTER_MAINNET = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Address

// ── Uniswap fee tiers ─────────────────────────────────────────────────────────

export const FEE_TIER = {
  STABLE: 100,    // 0.01% — stablecoin pairs
  LOW: 500,       // 0.05% — ETH/USDC, ETH/WBTC
  MEDIUM: 3000,   // 0.30% — most pairs
  HIGH: 10000,    // 1.00% — exotic pairs
} as const

// ── Lido (Ethereum mainnet only) ──────────────────────────────────────────────

export const LIDO_CONTRACT = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as Address
export const LIDO_CURVE_POOL = '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022' as Address
export const STETH_TOKEN = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84' as Address

// ── Known Arbitrum tokens ─────────────────────────────────────────────────────

export const TOKENS_ARBITRUM = {
  WETH:  '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
  WBTC:  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' as Address,
  USDC:  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
  USDCe: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' as Address,
  USDT:  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address,
  DAI:   '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1' as Address,
  ARB:   '0x912CE59144191C1204E64559FE8253a0e49E6548' as Address,
  LINK:  '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4' as Address,
} as const

// Preferred Uniswap fee tier for each pair (tokenIn → tokenOut)
export const PREFERRED_FEE_TIERS: Record<string, Record<string, number>> = {
  [TOKENS_ARBITRUM.WETH]: {
    [TOKENS_ARBITRUM.USDC]:  FEE_TIER.LOW,
    [TOKENS_ARBITRUM.USDCe]: FEE_TIER.LOW,
    [TOKENS_ARBITRUM.USDT]:  FEE_TIER.LOW,
    [TOKENS_ARBITRUM.DAI]:   FEE_TIER.LOW,
    [TOKENS_ARBITRUM.WBTC]:  FEE_TIER.LOW,
  },
  [TOKENS_ARBITRUM.WBTC]: {
    [TOKENS_ARBITRUM.USDC]:  FEE_TIER.LOW,
    [TOKENS_ARBITRUM.WETH]:  FEE_TIER.LOW,
  },
  [TOKENS_ARBITRUM.USDC]: {
    [TOKENS_ARBITRUM.USDT]:  FEE_TIER.STABLE,
    [TOKENS_ARBITRUM.DAI]:   FEE_TIER.STABLE,
  },
}

// ── Bot limits ────────────────────────────────────────────────────────────────

export const LIMITS = {
  MIN_PROFIT_ETH: 0.005,                // min net profit to attempt (ETH)
  MAX_GAS_GWEI: 1.0,                    // skip if gas > 1 gwei on Arbitrum
  GAS_ESTIMATE_LIQUIDATION: 800_000n,   // conservative gas estimate
  SCAN_BATCH_SIZE: 50,                  // how many addresses per multicall batch
  SCAN_INTERVAL_MS: 12_000,            // scan watchlist every 12 seconds
  HEALTH_FACTOR_THRESHOLD: 10n ** 18n, // liquidatable when HF < 1e18
  CIRCUIT_BREAKER_FAILURES: 3,         // consecutive failures before pause
  CIRCUIT_BREAKER_PAUSE_MS: 3_600_000, // 1 hour pause
} as const
