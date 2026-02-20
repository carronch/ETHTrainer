/**
 * OpportunityFinder — for a liquidatable position, finds the best collateral to seize
 * and estimates the profit after gas costs.
 *
 * Strategy:
 *   1. Get all active reserves on Aave
 *   2. For each reserve, check if the borrower has collateral or debt there
 *   3. Find the collateral with the highest liquidation bonus
 *   4. Estimate profit: collateral_bonus_usd - gas_cost_usd - flash_loan_fee
 *   5. Return the best opportunity if profitable above the minimum threshold
 */
import { createPublicClient, http, type Address, formatEther } from 'viem'
import { arbitrum } from 'viem/chains'
import { logAgent } from '../../db/queries.js'
import { AAVE_DATA_PROVIDER_ABI, AAVE_ORACLE_ABI, AAVE_POOL_ABI } from './abi.js'
import {
  AAVE_DATA_PROVIDER_ARBITRUM,
  AAVE_ORACLE_ARBITRUM,
  AAVE_POOL_ARBITRUM,
  FEE_TIER,
  LIMITS,
  PREFERRED_FEE_TIERS,
} from './constants.js'
import type { AccountData, LiquidationOpportunity, UserReserveData } from './types.js'

const RAY = 10n ** 18n
const FLASH_LOAN_FEE_BPS = 9n // 0.09% Aave v3 flash loan fee

export class OpportunityFinder {
  private client: ReturnType<typeof createPublicClient>
  private reservesList: Address[] | null = null

  constructor(rpcUrl: string) {
    this.client = createPublicClient({
      chain: arbitrum,
      transport: http(rpcUrl),
    })
  }

  /** Find the best liquidation opportunity for a given underwater account. */
  async findBestOpportunity(account: AccountData): Promise<LiquidationOpportunity | null> {
    // Load reserves (cached per session)
    const reserves = await this.getReservesList()

    // Get user positions across all reserves (batch multicall)
    const [userReserves, prices, configs] = await Promise.all([
      this.getUserReserves(account.address, reserves),
      this.getPrices(reserves),
      this.getReserveConfigs(reserves),
    ])

    // Split into collateral assets and debt assets
    const collaterals = userReserves.filter(
      (r) => r.currentATokenBalance > 0n && r.usageAsCollateralEnabled,
    )
    const debts = userReserves.filter((r) => r.totalDebt > 0n)

    if (collaterals.length === 0 || debts.length === 0) return null

    // Pick debt asset: largest debt in USD value
    const bestDebt = debts.reduce((a, b) => {
      const aUsd = (a.totalDebt * prices.get(a.asset)!) / 10n ** BigInt(a.decimals)
      const bUsd = (b.totalDebt * prices.get(b.asset)!) / 10n ** BigInt(b.decimals)
      return aUsd > bUsd ? a : b
    })

    // Pick collateral: highest liquidation bonus
    const bestCollateral = collaterals.reduce((a, b) =>
      a.liquidationBonus > b.liquidationBonus ? a : b,
    )

    // Estimate profit
    const debtPrice       = prices.get(bestDebt.asset) ?? 0n
    const collateralPrice = prices.get(bestCollateral.asset) ?? 0n
    if (debtPrice === 0n || collateralPrice === 0n) return null

    // Flash loan amount = 50% of debt (Aave v3 close factor; max if HF < 0.95)
    const closeFactor = account.healthFactor < (RAY * 95n) / 100n ? 100n : 50n
    const debtToCover = (bestDebt.totalDebt * closeFactor) / 100n

    // Collateral received = debtToCover * debtPrice * liquidationBonus / collateralPrice / 10000
    const collateralReceived =
      (debtToCover * debtPrice * bestCollateral.liquidationBonus) /
      (collateralPrice * 10000n)

    // Flash loan fee (0.09% of debt amount)
    const flashLoanFee = (debtToCover * FLASH_LOAN_FEE_BPS) / 10000n

    // Gross profit in debt token units
    const grossProfitDebtUnits =
      (collateralReceived * collateralPrice) / debtPrice - debtToCover - flashLoanFee

    // Convert to ETH equivalent for minimum check
    // Use ETH price from oracle (Aave oracle is USD with 8 decimals)
    // Approximate: debt token → USD → ETH
    // For simplicity, skip ETH conversion and use USD value / 3000 (approximate ETH price)
    const gasPrice = await this.client.getGasPrice()
    const gasEstimate = LIMITS.GAS_ESTIMATE_LIQUIDATION * gasPrice
    const profitInEthRaw = (grossProfitDebtUnits * debtPrice) / (10n ** BigInt(bestDebt.decimals))
    // profitInEthRaw is in USD (8 decimals), convert to ETH:
    // profitEth = profitUsd / ethPriceUsd — we'll approximate ETH at $3000 = 3000_0000_0000 (8 dec)
    const profitWei = (profitInEthRaw * 10n ** 18n) / 3_000_0000_0000n
    const netProfitWei = profitWei > gasEstimate ? profitWei - gasEstimate : 0n

    if (netProfitWei < BigInt(Math.round(LIMITS.MIN_PROFIT_ETH * 1e18))) {
      logAgent('opportunity-finder', 'info', `Skipping underprofitable liquidation`, {
        borrower: account.address,
        netProfitEth: formatEther(netProfitWei),
      })
      return null
    }

    const uniswapPoolFee = this.getPreferredFee(bestCollateral.asset, bestDebt.asset)
    const minProfitWei   = (netProfitWei * 80n) / 100n // 80% of estimated = slippage buffer

    return {
      borrower:              account.address,
      collateralAsset:       bestCollateral.asset,
      collateralSymbol:      bestCollateral.symbol,
      debtAsset:             bestDebt.asset,
      debtSymbol:            bestDebt.symbol,
      debtToCover,
      expectedCollateralBonus: grossProfitDebtUnits,
      estimatedGasCostWei:   gasEstimate,
      estimatedProfitWei:    netProfitWei,
      uniswapPoolFee,
      minProfitWei,
      healthFactor:          account.healthFactor,
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async getReservesList(): Promise<Address[]> {
    if (this.reservesList) return this.reservesList
    const list = await this.client.readContract({
      address:      AAVE_POOL_ARBITRUM,
      abi:          AAVE_POOL_ABI,
      functionName: 'getReservesList',
    })
    this.reservesList = list as Address[]
    return this.reservesList
  }

  private async getUserReserves(user: Address, reserves: Address[]): Promise<UserReserveData[]> {
    // Batch: getUserReserveData + getReserveConfigurationData for all reserves
    const userCalls = reserves.map((asset) => ({
      address:      AAVE_DATA_PROVIDER_ARBITRUM,
      abi:          AAVE_DATA_PROVIDER_ABI,
      functionName: 'getUserReserveData' as const,
      args:         [asset, user] as [Address, Address],
    }))
    const configCalls = reserves.map((asset) => ({
      address:      AAVE_DATA_PROVIDER_ARBITRUM,
      abi:          AAVE_DATA_PROVIDER_ABI,
      functionName: 'getReserveConfigurationData' as const,
      args:         [asset] as [Address],
    }))

    const [userResults, configResults] = await Promise.all([
      this.client.multicall({ contracts: userCalls, allowFailure: true }),
      this.client.multicall({ contracts: configCalls, allowFailure: true }),
    ])

    const out: UserReserveData[] = []
    for (let i = 0; i < reserves.length; i++) {
      const ur = userResults[i]
      const cr = configResults[i]
      if (ur.status !== 'success' || cr.status !== 'success') continue

      const [aTokenBalance, stableDebt, variableDebt, , , , , , usageAsCollateral] = ur.result as [
        bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, boolean
      ]
      const [decimals, , , liquidationBonus, , , , , isActive] = cr.result as [
        bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean, boolean, boolean
      ]

      if (!isActive) continue
      if (aTokenBalance === 0n && stableDebt === 0n && variableDebt === 0n) continue

      out.push({
        asset:                   reserves[i],
        symbol:                  reserves[i].slice(0, 8), // placeholder — could fetch from token
        decimals:                Number(decimals),
        currentATokenBalance:    aTokenBalance,
        currentStableDebt:       stableDebt,
        currentVariableDebt:     variableDebt,
        totalDebt:               stableDebt + variableDebt,
        usageAsCollateralEnabled: usageAsCollateral,
        liquidationBonus,
        price:                   0n, // filled in by getPrices()
      })
    }
    return out
  }

  private async getPrices(reserves: Address[]): Promise<Map<Address, bigint>> {
    const prices = await this.client.readContract({
      address:      AAVE_ORACLE_ARBITRUM,
      abi:          AAVE_ORACLE_ABI,
      functionName: 'getAssetsPrices',
      args:         [reserves],
    })
    const map = new Map<Address, bigint>()
    ;(prices as bigint[]).forEach((p, i) => map.set(reserves[i], p))
    return map
  }

  private async getReserveConfigs(
    reserves: Address[],
  ): Promise<Map<Address, { decimals: number; liquidationBonus: bigint }>> {
    const map = new Map<Address, { decimals: number; liquidationBonus: bigint }>()
    // Already fetched in getUserReserves — this avoids a second call
    // In a refactor, we'd share the multicall result
    return map
  }

  private getPreferredFee(tokenIn: Address, tokenOut: Address): number {
    const inLower  = tokenIn.toLowerCase()
    const outLower = tokenOut.toLowerCase()
    return (
      PREFERRED_FEE_TIERS[inLower]?.[outLower] ??
      PREFERRED_FEE_TIERS[outLower]?.[inLower] ??
      FEE_TIER.MEDIUM
    )
  }
}
