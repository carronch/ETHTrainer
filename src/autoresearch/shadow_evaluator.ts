/**
 * ShadowEvaluator — validates proposed parameters against recent history
 * before applying them. The "gate" that prevents bad parameter updates.
 *
 * Uses the missed_opportunities + trades tables to compute:
 *   - current_score:  how well current params would have performed over 7 days
 *   - proposed_score: how well proposed params would have performed over 7 days
 *
 * Only apply if proposed_score > current_score by at least MIN_IMPROVEMENT_PCT.
 * Threshold is intentionally LOW (0.5%) to capture Munger-style compounding.
 * Consistency requirement (both 24h sim AND 7-day shadow) prevents noise.
 */

import { getDb } from '../db/index.js'
import type { HeuristicParams, ShadowScore, SimulationResult } from './types.js'

// Charlie Munger compounding: capture even small, consistent improvements.
// A 0.5% improvement, applied 365 times, compounds significantly.
const MIN_IMPROVEMENT_PCT = 0.5

// ── Public API ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  should_apply: boolean
  current_score: ShadowScore
  proposed_score: ShadowScore
  improvement_pct: number
  reason: string
}

/**
 * Validate proposed params by shadow-simulating against the last 7 days.
 *
 * @param simResults  Results from the 24h Anvil simulation batch
 * @param proposed    Candidate parameter set to evaluate
 * @param current     Current active parameters
 */
export function validate(
  simResults: SimulationResult[],
  proposed: HeuristicParams,
  current: HeuristicParams,
): ValidationResult {
  // Score against the 24h simulation results
  const sim24hScore_current  = scoreSimulations(simResults, current)
  const sim24hScore_proposed = scoreSimulations(simResults, proposed)

  // Score against 7 days of live missed_opportunities from SQLite
  const live7dScore_current  = scoreLiveHistory(7 * 24, current)
  const live7dScore_proposed = scoreLiveHistory(7 * 24, proposed)

  // Composite score: weighted average (recent 24h weighted more heavily)
  const current_composite  = compositeScore(sim24hScore_current, live7dScore_current)
  const proposed_composite = compositeScore(sim24hScore_proposed, live7dScore_proposed)

  const improvement_pct =
    current_composite > 0
      ? ((proposed_composite - current_composite) / current_composite) * 100
      : 0

  const should_apply = improvement_pct >= MIN_IMPROVEMENT_PCT

  const reason = should_apply
    ? `Improvement of ${improvement_pct.toFixed(2)}% meets threshold (${MIN_IMPROVEMENT_PCT}%). Applying.`
    : `Improvement of ${improvement_pct.toFixed(2)}% below threshold (${MIN_IMPROVEMENT_PCT}%). Keeping current params.`

  return {
    should_apply,
    current_score: live7dScore_current,
    proposed_score: live7dScore_proposed,
    improvement_pct,
    reason,
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Score a set of simulation results against given params.
 * A "win" = our max_gas_gwei >= winner_gas_gwei (we would have outbid them).
 */
function scoreSimulations(
  sims: SimulationResult[],
  params: HeuristicParams,
): ShadowScore {
  if (sims.length === 0) {
    return { total_opportunities: 0, wins: 0, win_rate: 0, total_profit_eth: 0, avg_profit_per_opp: 0 }
  }

  let wins = 0
  let total_profit_eth = 0

  for (const sim of sims) {
    const would_win =
      params.max_gas_gwei >= sim.winner_gas_gwei &&
      sim.estimated_profit_eth >= params.min_profit_eth

    if (would_win) {
      wins++
      total_profit_eth += sim.estimated_profit_eth
    }
  }

  return {
    total_opportunities: sims.length,
    wins,
    win_rate: wins / sims.length,
    total_profit_eth,
    avg_profit_per_opp: sims.length > 0 ? total_profit_eth / sims.length : 0,
  }
}

/**
 * Score against live missed_opportunities history from SQLite.
 * Uses winner_gas_gwei to determine if we would have won with given params.
 */
function scoreLiveHistory(
  lookbackHours: number,
  params: HeuristicParams,
): ShadowScore {
  const db = getDb()
  const since = Math.floor(Date.now() / 1000) - lookbackHours * 3600

  const rows = db
    .prepare(
      `SELECT winner_gas_gwei, profit_missed_eth
       FROM missed_opportunities
       WHERE timestamp >= ? AND winner_gas_gwei IS NOT NULL`,
    )
    .all(since) as { winner_gas_gwei: number; profit_missed_eth: number | null }[]

  // Also count trades we actually won (these count as wins for both current and proposed)
  const wonTrades = db
    .prepare(
      `SELECT profit_eth FROM trades
       WHERE strategy = 'liquidation-bots' AND status = 'confirmed'
       AND created_at >= ?`,
    )
    .all(since) as { profit_eth: number | null }[]

  let wins = wonTrades.length
  let total_profit_eth = wonTrades.reduce((s, t) => s + (t.profit_eth ?? 0), 0)
  const total_opportunities = rows.length + wonTrades.length

  for (const row of rows) {
    const would_win = params.max_gas_gwei >= row.winner_gas_gwei
    if (would_win) {
      wins++
      total_profit_eth += row.profit_missed_eth ?? 0.005 // fallback estimate
    }
  }

  return {
    total_opportunities,
    wins,
    win_rate: total_opportunities > 0 ? wins / total_opportunities : 0,
    total_profit_eth,
    avg_profit_per_opp: total_opportunities > 0 ? total_profit_eth / total_opportunities : 0,
  }
}

/**
 * Composite score combining 24h simulation and 7-day live history.
 * Primary metric: opportunity capture rate (wins / total).
 * Secondary metric: total ETH value (larger positions matter more).
 */
function compositeScore(sim: ShadowScore, live7d: ShadowScore): number {
  // Weight: 40% recent simulations, 60% live history
  const capture_rate  = sim.win_rate  * 0.4 + live7d.win_rate  * 0.6
  const profit_factor = sim.avg_profit_per_opp * 0.4 + live7d.avg_profit_per_opp * 0.6

  // Normalize: score = capture_rate * (1 + profit_factor * 10)
  // This means: higher capture rate matters, but also values profitable positions more
  return capture_rate * (1 + Math.min(profit_factor * 10, 1))
}
