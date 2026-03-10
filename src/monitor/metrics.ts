/**
 * Metrics — daily P&L summary and operational stats.
 * Queries SQLite for the last 24h of trades, missed opps, and treasury progress.
 */

import { getDb } from '../db/index.js'

export interface DailyMetrics {
  // Trade performance
  total_attempts: number
  successes: number
  win_rate: number
  total_profit_eth: number
  avg_profit_per_win: number

  // Missed opportunities
  total_missed: number

  // Watchlist
  watchlist_size: number

  // Treasury progress
  total_swept_eth: number
  treasury_pct_of_32: number

  // System health
  last_successful_liquidation_ts: number | null
  hours_since_last_win: number | null
}

export function getDailyMetrics(lookbackHours = 24): DailyMetrics {
  const db = getDb()
  const since = Math.floor(Date.now() / 1000) - lookbackHours * 3600

  // Trade stats
  const tradeRow = db.prepare(`
    SELECT
      COUNT(*) as total_attempts,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN status = 'confirmed' THEN profit_eth ELSE 0 END) as total_profit,
      SUM(CASE WHEN status = 'confirmed' AND profit_eth > 0 THEN profit_eth ELSE 0 END) as winning_profit,
      MAX(CASE WHEN status = 'confirmed' THEN confirmed_at ELSE NULL END) as last_win_ts
    FROM trades
    WHERE strategy = 'liquidation-bots' AND created_at >= ?
  `).get(since) as {
    total_attempts: number
    successes: number
    total_profit: number
    winning_profit: number
    last_win_ts: number | null
  }

  // Missed opps
  const missedRow = db.prepare(
    `SELECT COUNT(*) as n FROM missed_opportunities WHERE timestamp >= ?`,
  ).get(since) as { n: number }

  // Watchlist size
  const watchlistRow = db.prepare(
    `SELECT COUNT(*) as n FROM liquidation_watchlist WHERE network = 'arbitrum' AND is_active = 1`,
  ).get() as { n: number }

  // Treasury
  const treasuryRow = db.prepare(
    `SELECT COALESCE(SUM(amount_eth), 0) as total FROM treasury_sweeps`,
  ).get() as { total: number }

  const successes = tradeRow.successes ?? 0
  const totalAttempts = tradeRow.total_attempts ?? 0
  const winningProfit = tradeRow.winning_profit ?? 0
  const totalProfit = tradeRow.total_profit ?? 0
  const lastWinTs = tradeRow.last_win_ts ?? null
  const totalSwept = treasuryRow.total ?? 0

  const now = Math.floor(Date.now() / 1000)
  const hoursSinceLastWin = lastWinTs ? (now - lastWinTs) / 3600 : null

  return {
    total_attempts: totalAttempts,
    successes,
    win_rate: totalAttempts > 0 ? successes / totalAttempts : 0,
    total_profit_eth: totalProfit,
    avg_profit_per_win: successes > 0 ? winningProfit / successes : 0,
    total_missed: missedRow.n,
    watchlist_size: watchlistRow.n,
    total_swept_eth: totalSwept,
    treasury_pct_of_32: (totalSwept / 32) * 100,
    last_successful_liquidation_ts: lastWinTs,
    hours_since_last_win: hoursSinceLastWin,
  }
}

export function formatDailyReport(m: DailyMetrics): string {
  const lines: string[] = [
    `*Daily P&L Report*`,
    ``,
    `*Liquidation Performance (24h)*`,
    `Attempts: ${m.total_attempts}`,
    `Wins: ${m.successes} (${(m.win_rate * 100).toFixed(1)}%)`,
    `Profit: +${m.total_profit_eth.toFixed(6)} ETH`,
    `Missed opps: ${m.total_missed}`,
    ``,
    `*System*`,
    `Watchlist: ${m.watchlist_size} borrowers`,
    m.hours_since_last_win !== null
      ? `Last win: ${m.hours_since_last_win.toFixed(1)}h ago`
      : `Last win: never (bot not yet live)`,
    ``,
    `*Treasury Progress*`,
    `Total swept: ${m.total_swept_eth.toFixed(4)} ETH`,
    `Validator progress: ${m.treasury_pct_of_32.toFixed(1)}% of 32 ETH`,
    ``,
    progressBar(m.treasury_pct_of_32),
  ]
  return lines.join('\n')
}

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5) // 20 chars = 100%
  const empty = 20 - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct.toFixed(1)}%`
}
