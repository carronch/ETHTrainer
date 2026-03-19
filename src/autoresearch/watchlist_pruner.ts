/**
 * watchlist_pruner.ts — Nightly watchlist hygiene.
 *
 * Run as part of the autoresearch cycle to prevent the watchlist from
 * growing unbounded and overwhelming RPC quota.
 *
 * Strategy:
 *   1. Deactivate addresses with HF > 1.5 (safe, no liquidation risk)
 *   2. Re-enable a small batch of NULL addresses so they get scanned
 *      gradually rather than all at once
 */

import { getDb } from '../db/index.js'

const HF_SAFE_THRESHOLD = 1.5e18   // Deactivate above this
const NULL_REQUEUE_BATCH = 500      // Re-enable this many NULL addresses per night

export interface PruneResult {
  deactivated: number
  requeued: number
  active_total: number
}

export function pruneWatchlist(): PruneResult {
  const db = getDb()

  // 1. Deactivate safe addresses (HF > 1.5)
  const deactivated = Number(db.prepare(`
    UPDATE liquidation_watchlist
    SET    is_active = 0,
           updated_at = unixepoch()
    WHERE  is_active = 1
      AND  last_health_factor IS NOT NULL
      AND  CAST(last_health_factor AS REAL) > ?
  `).run(HF_SAFE_THRESHOLD).changes)

  // 2. Re-enable a small batch of NULL addresses (oldest first)
  //    so the scanner works through the backlog at a controlled pace
  const requeued = Number(db.prepare(`
    UPDATE liquidation_watchlist
    SET    is_active = 1,
           updated_at = unixepoch()
    WHERE  id IN (
      SELECT id FROM liquidation_watchlist
      WHERE  is_active = 0
        AND  last_health_factor IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    )
  `).run(NULL_REQUEUE_BATCH).changes)

  // 3. Count remaining active addresses per network for the report
  const rows = db.prepare(`
    SELECT network, COUNT(*) as cnt
    FROM   liquidation_watchlist
    WHERE  is_active = 1
    GROUP  BY network
  `).all() as { network: string; cnt: number }[]

  const active_total = rows.reduce((sum, r) => sum + r.cnt, 0)

  console.log(
    `[Pruner] Deactivated ${deactivated} safe addresses, ` +
    `requeued ${requeued} NULL addresses. ` +
    `Active total: ${active_total} (${rows.map(r => `${r.network}:${r.cnt}`).join(', ')})`
  )

  return { deactivated, requeued, active_total }
}
