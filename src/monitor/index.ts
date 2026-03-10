/**
 * Monitor — lightweight process watchdog and alert dispatcher.
 *
 * Responsibilities:
 *   1. Watch that the Rust executor process is alive (restart via pm2 if not)
 *   2. Alert if no successful liquidation in 48h (CRITICAL)
 *   3. Send one daily P&L summary message
 *   4. Forward critical errors from SQLite agent_logs
 *
 * Telegram rules (sparse = high signal):
 *   CRITICAL:  process crash, circuit breaker triggered, no win in 48h
 *   DAILY:     one P&L summary at 9am UTC
 *   PARAM UPDATE: what changed, why, expected improvement (sent by autoresearch loop)
 *   NEVER:     every scan cycle, routine heartbeats, minor errors
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getDb } from '../db/index.js'
import { alertError, alertInfo } from '../telegram/bot.js'
import { getDailyMetrics, formatDailyReport } from './metrics.js'

const execAsync = promisify(exec)

// ── Thresholds ────────────────────────────────────────────────────────────────

const NO_WIN_ALERT_HOURS = 48    // alert if no liquidation in 48h
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000  // check every 5 minutes
const DAILY_REPORT_HOUR_UTC = 9  // send daily report at 9am UTC

// ── State ─────────────────────────────────────────────────────────────────────

let lastDailyReportDate = ''
let lastNoWinAlertTs = 0

// ── Public API ────────────────────────────────────────────────────────────────

/** Start the monitor loop. Runs indefinitely. */
export async function startMonitor(): Promise<void> {
  console.log('[Monitor] Starting health watchdog')

  // Initial health check
  await runHealthCheck()

  // Periodic health checks
  setInterval(async () => {
    try {
      await runHealthCheck()
    } catch (err) {
      console.error('[Monitor] Health check failed:', err)
    }
  }, HEALTH_CHECK_INTERVAL_MS)

  // Daily report: check if we should send at 9am UTC
  setInterval(() => {
    const now = new Date()
    const hour = now.getUTCHours()
    const dateStr = now.toISOString().slice(0, 10)

    if (hour === DAILY_REPORT_HOUR_UTC && dateStr !== lastDailyReportDate) {
      lastDailyReportDate = dateStr
      sendDailyReport().catch((err) =>
        console.error('[Monitor] Failed to send daily report:', err),
      )
    }
  }, 60 * 1000) // check every minute
}

// ── Private ───────────────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
  // 1. Check Rust process is alive
  await checkRustProcess()

  // 2. Check for recent circuit breaker events
  await checkCircuitBreaker()

  // 3. Check for no-win alert
  await checkNoWinAlert()
}

async function checkRustProcess(): Promise<void> {
  try {
    const { stdout } = await execAsync('pm2 jlist')
    const processes = JSON.parse(stdout) as { name: string; pm2_env: { status: string } }[]
    const liquidator = processes.find((p) => p.name === 'liquidator')

    if (!liquidator) {
      await alertError('Rust liquidator process NOT FOUND in pm2. Manual intervention required.')
      return
    }

    if (liquidator.pm2_env.status !== 'online') {
      await alertError(`Rust liquidator process status: ${liquidator.pm2_env.status}. Attempting restart.`)
      try {
        await execAsync('pm2 restart liquidator')
        await alertInfo('Liquidator process restarted via pm2')
      } catch (restartErr) {
        await alertError(`Failed to restart liquidator: ${restartErr}`)
      }
    }
  } catch {
    // pm2 not available (dev environment) — skip silently
  }
}

async function checkCircuitBreaker(): Promise<void> {
  const db = getDb()
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300

  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM agent_logs
       WHERE agent = 'liquidator-rust'
       AND level = 'warn'
       AND message LIKE '%Circuit breaker%'
       AND created_at >= ?`,
    )
    .get(fiveMinutesAgo) as { n: number }

  if (row.n > 0) {
    await alertError(
      `Circuit breaker triggered on liquidation bot. Check logs: pm2 logs liquidator`,
    )
  }
}

async function checkNoWinAlert(): Promise<void> {
  const metrics = getDailyMetrics(48)
  const now = Date.now()

  // Only alert once per 4 hours to avoid spam
  if (
    metrics.hours_since_last_win !== null &&
    metrics.hours_since_last_win > NO_WIN_ALERT_HOURS &&
    now - lastNoWinAlertTs > 4 * 3600 * 1000
  ) {
    lastNoWinAlertTs = now
    await alertError(
      `No successful liquidation in ${metrics.hours_since_last_win.toFixed(0)}h. ` +
      `Watchlist: ${metrics.watchlist_size} borrowers. Check bot status.`,
    )
  }
}

async function sendDailyReport(): Promise<void> {
  const metrics = getDailyMetrics(24)
  const report = formatDailyReport(metrics)
  await alertInfo(report)
}
