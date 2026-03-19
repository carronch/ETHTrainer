/**
 * AutoresearchLoop — the Karpathy-inspired nightly learning cycle.
 *
 * Runs at 2am UTC every day via the pm2 cron scheduler.
 *
 * Cycle:
 *   1. Collect missed opportunities from the last 24h (SQLite + The Graph)
 *   2. Simulate each miss via Anvil fork (would higher gas have won?)
 *   3. Ask Claude to propose parameter adjustments
 *   4. Shadow-validate proposals against 7 days of history
 *   5. Apply if improvement >= 0.5% (compound the small edges)
 *   6. Send Telegram report
 *   7. Mark processed records as analyzed
 */

import { getDb } from '../db/index.js'
import { alertInfo, alertError } from '../telegram/bot.js'
import {
  getMissedOpportunities,
  getOnChainLiquidations,
  markAnalyzed,
} from './collector.js'
import { simulateMissedOpportunities } from './anvil_simulator.js'
import {
  compileParams,
  getRecentTradeStats,
  loadParams,
  writeParams,
} from './parameter_compiler.js'
import { validate } from './shadow_evaluator.js'
import { pruneWatchlist } from './watchlist_pruner.js'
import type { AutoresearchReport, SimulationResult } from './types.js'

const CHAIN_RPC_URLS: Record<string, string> = {
  arbitrum: process.env.ARBITRUM_RPC_URL ?? '',
  base:     process.env.BASE_RPC_URL ?? '',
  optimism: process.env.OPTIMISM_RPC_URL ?? '',
}

// ── Main cycle ────────────────────────────────────────────────────────────────

export async function runAutoresearchCycle(chain = 'arbitrum'): Promise<AutoresearchReport> {
  const db = getDb()
  const startedAt = new Date().toISOString()

  console.log('[Autoresearch] Starting nightly cycle:', startedAt)

  const currentParams = loadParams()
  let missedOppsAnalyzed = 0
  let simulationsRun = 0

  try {
    // ── Step 0: Prune watchlist ───────────────────────────────────────────────
    const pruneResult = pruneWatchlist()

    // ── Step 1: Collect missed opportunities ──────────────────────────────────

    const missed = await getMissedOpportunities(chain, 24)
    missedOppsAnalyzed = missed.length
    console.log(`[Autoresearch] ${missed.length} missed opportunities to analyze`)

    // ── Step 2: Compute trade stats ───────────────────────────────────────────

    const tradeStats = getRecentTradeStats(24)
    console.log(
      `[Autoresearch] Trade stats: ${tradeStats.successes}/${tradeStats.total_attempts} wins, ` +
      `${tradeStats.total_profit_eth.toFixed(6)} ETH profit`,
    )

    // ── Step 3: Propose new params via Claude ─────────────────────────────────

    // If we have no missed opportunities and win rate is good, skip simulation
    const chainRpcUrl = CHAIN_RPC_URLS[chain] ?? ''
    const shouldSimulate = missed.length > 0 && chainRpcUrl

    let simResults: SimulationResult[] = []
    let proposedParams = null

    if (shouldSimulate) {
      // Ask Claude for initial proposal based on stats alone first
      proposedParams = await compileParams({
        current_params: currentParams,
        simulation_results: [],
        recent_trade_stats: tradeStats,
      })

      // Then run Anvil simulations to validate the gas assumptions
      simResults = await simulateMissedOpportunities(
        missed.slice(0, 20), // cap at 20 simulations per night (cost control)
        currentParams,
        proposedParams,
        chainRpcUrl,
      )
      simulationsRun = simResults.length

      // Refine proposal with simulation results
      proposedParams = await compileParams({
        current_params: currentParams,
        simulation_results: simResults,
        recent_trade_stats: tradeStats,
      })

      console.log(`[Autoresearch] Proposed: max_gas=${proposedParams.max_gas_gwei} gwei, ` +
                  `min_profit=${proposedParams.min_profit_eth} ETH`)
    } else if (!shouldSimulate) {
      // No missed opps → still run parameter review with trade stats only
      if (tradeStats.total_attempts > 0) {
        proposedParams = await compileParams({
          current_params: currentParams,
          simulation_results: [],
          recent_trade_stats: tradeStats,
        })
      }
    }

    // ── Step 4: Shadow validate ────────────────────────────────────────────────

    let validation = null
    let applied = false

    if (proposedParams) {
      validation = validate(simResults, proposedParams, currentParams)
      console.log(`[Autoresearch] Validation: ${validation.reason}`)

      // ── Step 5: Apply if improvement found ────────────────────────────────────

      if (validation.should_apply) {
        writeParams(proposedParams)
        applied = true

        // Log to SQLite history
        const paramEntries = Object.entries(proposedParams).filter(
          ([k]) => !['version', 'updated_at', 'rationale'].includes(k),
        )
        for (const [key, value] of paramEntries) {
          const prev = (currentParams as unknown as Record<string, unknown>)[key]
          if (prev !== value) {
            db.prepare(`
              INSERT INTO strategy_params (param_key, param_value, previous_value, rationale, applied)
              VALUES (?, ?, ?, ?, 1)
            `).run(key, String(value), String(prev), proposedParams.rationale)
          }
        }

        console.log(`[Autoresearch] Parameters updated (v${proposedParams.version})`)
      }
    }

    // ── Step 6: Log run to SQLite ─────────────────────────────────────────────

    const runRow = db.prepare(`
      INSERT INTO autoresearch_runs
        (missed_opps_analyzed, simulations_run, proposed_params,
         current_score, proposed_score, improvement_pct, applied, apply_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      missedOppsAnalyzed,
      simulationsRun,
      proposedParams ? JSON.stringify(proposedParams) : null,
      validation?.current_score.win_rate ?? null,
      validation?.proposed_score.win_rate ?? null,
      validation?.improvement_pct ?? null,
      applied ? 1 : 0,
      validation?.reason ?? 'No proposal generated',
    )

    const runId = runRow.lastInsertRowid as number

    // ── Step 7: Send Telegram report ──────────────────────────────────────────

    // Also measure total on-chain liquidations to compute capture rate
    const onChainLiqs = await getOnChainLiquidations(chain, 24).catch(() => [])
    const captureRate = onChainLiqs.length > 0
      ? ((tradeStats.successes / onChainLiqs.length) * 100).toFixed(1)
      : 'N/A'

    const report: AutoresearchReport = {
      run_id: runId,
      timestamp: startedAt,
      missed_opps_analyzed: missedOppsAnalyzed,
      simulations_run: simulationsRun,
      current_score: validation?.current_score ?? { total_opportunities: 0, wins: 0, win_rate: 0, total_profit_eth: 0, avg_profit_per_opp: 0 },
      proposed_score: validation?.proposed_score ?? null,
      improvement_pct: validation?.improvement_pct ?? null,
      applied,
      new_params: applied ? proposedParams : null,
      rationale: validation?.reason ?? 'No proposal generated',
    }

    await sendReport(report, tradeStats, captureRate, pruneResult)

    // ── Step 8: Mark analyzed ─────────────────────────────────────────────────

    markAnalyzed(missed.map((m) => m.id))

    return report
  } catch (err) {
    const msg = `Autoresearch cycle failed: ${err instanceof Error ? err.message : String(err)}`
    console.error('[Autoresearch]', msg)
    await alertError(msg)
    throw err
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

async function sendReport(
  report: AutoresearchReport,
  stats: ReturnType<typeof getRecentTradeStats>,
  captureRate: string,
  prune: { deactivated: number; requeued: number; active_total: number },
): Promise<void> {
  const paramsChanged = report.applied && report.new_params

  const lines = [
    `*Autoresearch Report* — ${new Date(report.timestamp).toUTCString()}`,
    ``,
    `*Last 24h Performance*`,
    `Trades: ${stats.successes}/${stats.total_attempts} wins (${(stats.win_rate * 100).toFixed(1)}%)`,
    `Profit: ${stats.total_profit_eth.toFixed(6)} ETH`,
    `Missed opps: ${stats.total_missed} (${stats.missed_due_to_gas} due to gas)`,
    `On-chain capture rate: ${captureRate}%`,
    ``,
    `*Simulations*`,
    `Analyzed: ${report.missed_opps_analyzed} missed opps`,
    `Simulated: ${report.simulations_run} Anvil forks`,
    ``,
    report.improvement_pct !== null
      ? `*Shadow Evaluation*\nImprovement: ${report.improvement_pct.toFixed(2)}%\n${report.rationale}`
      : `*No parameter changes proposed*`,
    ``,
    `*Watchlist Housekeeping*`,
    `Deactivated (HF>1.5): ${prune.deactivated}`,
    `Requeued (NULL batch): ${prune.requeued}`,
    `Active total: ${prune.active_total}`,
  ]

  if (paramsChanged && report.new_params) {
    const p = report.new_params
    lines.push(
      ``,
      `*Parameters Updated (v${p.version})*`,
      `max_gas_gwei: ${p.max_gas_gwei}`,
      `min_profit_eth: ${p.min_profit_eth}`,
      `hf_alert_threshold: ${p.hf_alert_threshold}`,
      `Rationale: ${p.rationale}`,
    )
  }

  await alertInfo(lines.join('\n'))
}
