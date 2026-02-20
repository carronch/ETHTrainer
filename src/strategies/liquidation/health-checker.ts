/**
 * HealthChecker — batch-reads getUserAccountData for all addresses in the watchlist.
 * Uses viem multicall to minimise RPC round trips.
 * Returns addresses where health factor < 1 (liquidatable).
 */
import { createPublicClient, http, type Address } from 'viem'
import { arbitrum } from 'viem/chains'
import { getDb } from '../../db/index.js'
import { logAgent } from '../../db/queries.js'
import { AAVE_POOL_ABI } from './abi.js'
import { AAVE_POOL_ARBITRUM, LIMITS } from './constants.js'
import type { AccountData } from './types.js'

export class HealthChecker {
  private client: ReturnType<typeof createPublicClient>

  constructor(rpcUrl: string) {
    this.client = createPublicClient({
      chain: arbitrum,
      transport: http(rpcUrl),
    })
  }

  /** Scan entire watchlist in batches. Returns all liquidatable positions. */
  async scanWatchlist(): Promise<AccountData[]> {
    const addresses = this.getActiveWatchlist()
    if (addresses.length === 0) return []

    const liquidatable: AccountData[] = []
    const batchSize = LIMITS.SCAN_BATCH_SIZE

    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize)
      const results = await this.batchCheckHealthFactor(batch)
      for (const data of results) {
        this.updateWatchlistEntry(data)
        if (data.healthFactor < LIMITS.HEALTH_FACTOR_THRESHOLD) {
          liquidatable.push(data)
        }
      }
    }

    return liquidatable
  }

  /** Check a single address. */
  async checkAddress(address: Address): Promise<AccountData> {
    const result = await this.client.readContract({
      address: AAVE_POOL_ARBITRUM,
      abi:     AAVE_POOL_ABI,
      functionName: 'getUserAccountData',
      args:    [address],
    })
    return {
      address,
      totalCollateralBase:          result[0],
      totalDebtBase:                result[1],
      availableBorrowsBase:         result[2],
      currentLiquidationThreshold:  result[3],
      ltv:                          result[4],
      healthFactor:                 result[5],
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async batchCheckHealthFactor(addresses: Address[]): Promise<AccountData[]> {
    const contracts = addresses.map((addr) => ({
      address:      AAVE_POOL_ARBITRUM,
      abi:          AAVE_POOL_ABI,
      functionName: 'getUserAccountData' as const,
      args:         [addr] as [Address],
    }))

    const results = await this.client.multicall({ contracts, allowFailure: true })

    const out: AccountData[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status !== 'success') continue
      const [totalCollateralBase, totalDebtBase, availableBorrowsBase,
             currentLiquidationThreshold, ltv, healthFactor] = r.result as [
        bigint, bigint, bigint, bigint, bigint, bigint
      ]
      // Skip accounts with no debt (can't be liquidated)
      if (totalDebtBase === 0n) continue
      out.push({
        address: addresses[i],
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor,
      })
    }
    return out
  }

  private getActiveWatchlist(): Address[] {
    const db = getDb()
    const rows = db.prepare(
      `SELECT address FROM liquidation_watchlist
       WHERE network = 'arbitrum' AND is_active = 1
       ORDER BY last_health_factor ASC NULLS LAST`
    ).all() as { address: string }[]
    return rows.map((r) => r.address as Address)
  }

  private updateWatchlistEntry(data: AccountData): void {
    const db = getDb()
    db.prepare(`
      UPDATE liquidation_watchlist
      SET last_health_factor    = ?,
          total_collateral_usd  = ?,
          total_debt_usd        = ?,
          updated_at            = unixepoch()
      WHERE address = ?
    `).run(
      data.healthFactor.toString(),
      Number(data.totalCollateralBase) / 1e8,
      Number(data.totalDebtBase) / 1e8,
      data.address.toLowerCase(),
    )
  }
}
