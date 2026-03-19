/**
 * ETHTrainer — TypeScript entrypoint.
 *
 * This process manages Layer 2 (autoresearch) and Layer 3 (monitor).
 * Layer 1 (Rust executor) runs as a separate pm2 process.
 *
 * What this does:
 *   1. Initialize the database (create tables if needed)
 *   2. Start the monitor (process watchdog + daily P&L reporting)
 *   3. Schedule the nightly autoresearch loop (2am UTC)
 *   4. Handle graceful shutdown
 *
 * The Rust liquidator process is started separately:
 *   pm2 start ./target/release/liquidator --name liquidator -- --live
 */

import 'dotenv/config'
import { getDb, closeDb } from './db/index.js'
import { alertStartup, alertError } from './telegram/bot.js'
import { startMonitor } from './monitor/index.js'
import { runAutoresearchCycle } from './autoresearch/loop.js'
import { config } from './config.js'

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  console.log('ETHTrainer TS layer starting...')

  // Initialize database (creates tables if first run)
  getDb()
  console.log('Database initialized')

  await alertStartup(config.NETWORK, '(TS monitor + autoresearch)', '0')
  console.log('Telegram alert sent')
}

// ── Autoresearch scheduler ────────────────────────────────────────────────────

function scheduleAutoresearch(): void {
  const runAt2amUTC = () => {
    const now = new Date()
    const msUntil2am = (() => {
      const next2am = new Date(now)
      next2am.setUTCHours(2, 0, 0, 0)
      if (next2am <= now) next2am.setUTCDate(next2am.getUTCDate() + 1)
      return next2am.getTime() - now.getTime()
    })()

    console.log(`Autoresearch next run in ${(msUntil2amUTC / 3600000).toFixed(1)}h`)

    setTimeout(async () => {
      for (const chain of ['arbitrum', 'base']) {
        try {
          await runAutoresearchCycle(chain)
        } catch (err) {
          const msg = `Autoresearch (${chain}) failed: ${err instanceof Error ? err.message : String(err)}`
          console.error(msg)
          await alertError(msg)
        }
      }
      // Schedule next run (24h later)
      runAt2amUTC()
    }, msUntil2am)
  }

  const msUntil2amUTC = (() => {
    const now = new Date()
    const next2am = new Date(now)
    next2am.setUTCHours(2, 0, 0, 0)
    if (next2am <= now) next2am.setUTCDate(next2am.getUTCDate() + 1)
    return next2am.getTime() - now.getTime()
  })()

  console.log(`Autoresearch scheduled for 2am UTC (in ${(msUntil2amUTC / 3600000).toFixed(1)}h)`)

  setTimeout(async () => {
    for (const chain of ['arbitrum', 'base']) {
      try {
        await runAutoresearchCycle(chain)
      } catch (err) {
        const msg = `Autoresearch (${chain}) failed: ${err instanceof Error ? err.message : String(err)}`
        console.error(msg)
        await alertError(msg)
      }
    }
    // Schedule next run
    runAt2amUTC()
  }, msUntil2amUTC)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await startup()

  // Start monitor (process watchdog + daily P&L)
  await startMonitor()

  // Schedule nightly autoresearch at 2am UTC
  scheduleAutoresearch()

  console.log('ETHTrainer TS layer running. Rust liquidator managed by pm2.')
  console.log('Ctrl+C to stop this process (does NOT stop the Rust bot).')

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nETHTrainer TS layer shutting down...')
    closeDb()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Keep process alive (monitor uses setInterval internally)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
