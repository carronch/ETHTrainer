/**
 * LiquidationMonitor — listens to Aave v3 Borrow events on Arbitrum.
 * Every new borrower address is added to the SQLite watchlist.
 * This populates the pool of addresses the HealthChecker scans.
 */
import { createPublicClient, http, type Address } from 'viem'
import { arbitrum } from 'viem/chains'
import { getDb } from '../../db/index.js'
import { logAgent } from '../../db/queries.js'
import { AAVE_POOL_ABI } from './abi.js'
import { AAVE_POOL_ARBITRUM } from './constants.js'
import { alertInfo } from '../../telegram/bot.js'

export class LiquidationMonitor {
  private client: ReturnType<typeof createPublicClient>
  private stopFn: (() => void) | null = null
  private watchlistCount = 0

  constructor(rpcUrl: string) {
    this.client = createPublicClient({
      chain: arbitrum,
      transport: http(rpcUrl),
    })
  }

  /** Start listening to Borrow events. Non-blocking — runs indefinitely. */
  async start(): Promise<void> {
    const currentBlock = await this.client.getBlockNumber()

    // Seed watchlist from recent history before watching live events
    await this.seedFromHistory(currentBlock)

    this.stopFn = this.client.watchContractEvent({
      address:   AAVE_POOL_ARBITRUM,
      abi:       AAVE_POOL_ABI,
      eventName: 'Borrow',
      onLogs: (logs) => {
        for (const log of logs) {
          const borrower = (log.args as { onBehalfOf?: Address }).onBehalfOf
          if (borrower) {
            this.addToWatchlist(borrower, log.blockNumber ?? currentBlock)
          }
        }
      },
      onError: (err) => {
        logAgent('liquidation-monitor', 'error', `Borrow event watch error: ${err.message}`)
      },
    })

    logAgent('liquidation-monitor', 'info', 'Borrow event listener started', {
      pool: AAVE_POOL_ARBITRUM,
      startBlock: currentBlock.toString(),
    })
  }

  /** Stop listening. */
  stop(): void {
    this.stopFn?.()
    this.stopFn = null
  }

  /** Pull Borrow events from the last ~30 days to seed the watchlist. */
  private async seedFromHistory(currentBlock: bigint): Promise<void> {
    // Arbitrum produces ~4 blocks/sec → 30 days ≈ 10,368,000 blocks.
    // Limit to ~3 days to avoid RPC timeout: ~1,036,800 blocks.
    const fromBlock = currentBlock - 1_036_800n
    const chunkSize = 50_000n

    let processed = 0

    for (let from = fromBlock; from < currentBlock; from += chunkSize) {
      const to = from + chunkSize - 1n < currentBlock ? from + chunkSize - 1n : currentBlock
      try {
        const logs = await this.client.getContractEvents({
          address:   AAVE_POOL_ARBITRUM,
          abi:       AAVE_POOL_ABI,
          eventName: 'Borrow',
          fromBlock: from,
          toBlock:   to,
        })
        for (const log of logs) {
          const borrower = (log.args as { onBehalfOf?: Address }).onBehalfOf
          if (borrower) {
            this.addToWatchlist(borrower, log.blockNumber ?? from)
            processed++
          }
        }
      } catch {
        // Some RPCs don't support large block ranges — skip and continue
      }
    }

    logAgent('liquidation-monitor', 'info', `Seeded watchlist from history`, {
      borrowersFound: processed,
    })
  }

  private addToWatchlist(address: Address, blockNumber: bigint): void {
    const db = getDb()
    try {
      db.prepare(`
        INSERT INTO liquidation_watchlist (address, network, first_seen_block)
        VALUES (?, 'arbitrum', ?)
        ON CONFLICT(address) DO NOTHING
      `).run(address.toLowerCase(), blockNumber.toString())
      this.watchlistCount++
    } catch {
      // Ignore duplicate / constraint errors
    }
  }

  async getWatchlistSize(): Promise<number> {
    const db = getDb()
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM liquidation_watchlist WHERE network = 'arbitrum' AND is_active = 1`
    ).get() as { n: number }
    return row.n
  }
}
