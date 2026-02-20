import type { Address } from 'viem'

// ── Watchlist ─────────────────────────────────────────────────────────────────

export interface WatchlistEntry {
  address: Address
  network: string
  firstSeenBlock: bigint
  lastCheckedBlock?: bigint
  lastHealthFactor?: bigint   // 1e18 = 1.0
  totalCollateralUsd?: number // in USD
  totalDebtUsd?: number
  isActive: boolean
}

// ── Account data from Aave ────────────────────────────────────────────────────

export interface AccountData {
  address: Address
  totalCollateralBase: bigint   // USD, 8 decimals
  totalDebtBase: bigint         // USD, 8 decimals
  availableBorrowsBase: bigint
  currentLiquidationThreshold: bigint  // basis points (e.g. 8500 = 85%)
  ltv: bigint
  healthFactor: bigint          // 1e18 = 1.0; < 1e18 = liquidatable
}

// ── User reserve position ─────────────────────────────────────────────────────

export interface UserReserveData {
  asset: Address
  symbol: string
  decimals: number
  currentATokenBalance: bigint   // collateral balance (scaled)
  currentStableDebt: bigint
  currentVariableDebt: bigint
  totalDebt: bigint              // stableDebt + variableDebt
  usageAsCollateralEnabled: boolean
  liquidationBonus: bigint       // e.g. 10500n = 5% bonus (10000 = no bonus)
  price: bigint                  // USD, 8 decimals per whole token
}

// ── Liquidation opportunity ───────────────────────────────────────────────────

export interface LiquidationOpportunity {
  borrower: Address
  collateralAsset: Address
  collateralSymbol: string
  debtAsset: Address
  debtSymbol: string
  debtToCover: bigint            // raw debt token amount (type(uint256).max = let Aave decide)
  expectedCollateralBonus: bigint // in debt asset units
  estimatedGasCostWei: bigint
  estimatedProfitWei: bigint     // in ETH equivalent after gas
  uniswapPoolFee: number         // 100 | 500 | 3000 | 10000
  minProfitWei: bigint           // 80% of estimated (slippage buffer)
  healthFactor: bigint
}

// ── Liquidation result ────────────────────────────────────────────────────────

export interface LiquidationResult {
  success: boolean
  txHash?: `0x${string}`
  profitEth?: number
  errorMessage?: string
  opportunity: LiquidationOpportunity
}
