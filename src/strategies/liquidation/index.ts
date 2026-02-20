/**
 * LiquidationBot — main orchestrator.
 *
 * Lifecycle:
 *   1. start()  — kick off Borrow event monitor + scanning interval
 *   2. runCheck() — one scan cycle (can be called manually or by MasterAgent)
 *   3. stop()   — tear down cleanly
 *
 * Scanning loop:
 *   Every SCAN_INTERVAL_MS:
 *     a. HealthChecker scans watchlist in batches
 *     b. For each liquidatable position, OpportunityFinder finds best opportunity
 *     c. LiquidationExecutor submits the transaction
 *     d. Results logged to SQLite
 */
import { logAgent } from '../../db/queries.js'
import { alertInfo } from '../../telegram/bot.js'
import { HealthChecker }     from './health-checker.js'
import { LiquidationMonitor } from './monitor.js'
import { OpportunityFinder } from './opportunity-finder.js'
import { LiquidationExecutor } from './executor.js'
import { LIMITS } from './constants.js'
import type { LiquidationResult } from './types.js'
import type { Address } from 'viem'

export class LiquidationBot {
  private monitor:  LiquidationMonitor
  private checker:  HealthChecker
  private finder:   OpportunityFinder
  private executor: LiquidationExecutor
  private interval: NodeJS.Timeout | null = null
  private running   = false

  constructor(rpcUrl: string, botContractAddress: Address) {
    this.monitor  = new LiquidationMonitor(rpcUrl)
    this.checker  = new HealthChecker(rpcUrl)
    this.finder   = new OpportunityFinder(rpcUrl)
    this.executor = new LiquidationExecutor(rpcUrl, botContractAddress)
  }

  /** Start the bot — begins monitoring events and scanning periodically. */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    logAgent('liquidation-bot', 'info', 'Starting liquidation bot on Arbitrum')
    await alertInfo('Liquidation bot started on Arbitrum')

    // Start event monitor (seeds watchlist from history, then listens live)
    await this.monitor.start()

    // Begin periodic scanning
    this.interval = setInterval(async () => {
      try {
        await this.runCheck()
      } catch (err) {
        logAgent('liquidation-bot', 'error', `Scan cycle error: ${String(err)}`)
      }
    }, LIMITS.SCAN_INTERVAL_MS)

    // Run first check immediately
    await this.runCheck()
  }

  /** Stop the bot. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.monitor.stop()
    this.running = false
    logAgent('liquidation-bot', 'info', 'Liquidation bot stopped')
  }

  /**
   * One scan cycle. Exposed for MasterAgent to call directly.
   * Returns results of any liquidation attempts this cycle.
   */
  async runCheck(): Promise<LiquidationResult[]> {
    const liquidatableAccounts = await this.checker.scanWatchlist()

    if (liquidatableAccounts.length === 0) return []

    logAgent('liquidation-bot', 'info',
      `Found ${liquidatableAccounts.length} liquidatable position(s)`)

    const results: LiquidationResult[] = []

    for (const account of liquidatableAccounts) {
      const opportunity = await this.finder.findBestOpportunity(account)
      if (!opportunity) continue

      logAgent('liquidation-bot', 'decision', 'Executing liquidation', {
        borrower:           opportunity.borrower,
        collateral:         opportunity.collateralSymbol,
        debt:               opportunity.debtSymbol,
        estimatedProfitEth: (Number(opportunity.estimatedProfitWei) / 1e18).toFixed(6),
        healthFactor:       (Number(opportunity.healthFactor) / 1e18).toFixed(4),
      })

      const result = await this.executor.execute(opportunity)
      results.push(result)
    }

    return results
  }

  /** Status summary for MasterAgent / RiskManager. */
  async getStatus(): Promise<{
    running: boolean
    watchlistSize: number
  }> {
    return {
      running: this.running,
      watchlistSize: await this.monitor.getWatchlistSize(),
    }
  }
}

// Re-export types for agent tools
export type { LiquidationOpportunity, LiquidationResult } from './types.js'
