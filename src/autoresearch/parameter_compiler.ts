/**
 * ParameterCompiler — uses Claude to analyze simulation results and
 * propose updated heuristic parameters.
 *
 * Input:  SimulationResult[], current HeuristicParams, recent trade stats
 * Output: proposed HeuristicParams with rationale
 *
 * The LLM does NOT have access to external tools here.
 * It receives a structured JSON prompt and returns structured JSON.
 * This is fast, cheap, and deterministic enough for parameter tuning.
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync } from 'node:fs'
import { getDb } from '../db/index.js'
import type { HeuristicParams, SimulationResult } from './types.js'

const PARAMS_FILE = 'heuristic_params.json'

export function loadParams(): HeuristicParams {
  try {
    return JSON.parse(readFileSync(PARAMS_FILE, 'utf8')) as HeuristicParams
  } catch {
    return defaultParams()
  }
}

export function writeParams(params: HeuristicParams): void {
  writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2), 'utf8')
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CompileInput {
  current_params: HeuristicParams
  simulation_results: SimulationResult[]
  recent_trade_stats: TradeStats
}

export interface TradeStats {
  total_attempts: number
  successes: number
  win_rate: number
  total_profit_eth: number
  avg_profit_per_win: number
  total_missed: number
  missed_due_to_gas: number      // where winner_gas > our max_gas
  missed_due_to_timing: number   // where winner got there first (gas similar)
}

export async function compileParams(input: CompileInput): Promise<HeuristicParams> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = buildPrompt(input)

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // Use fast model for parameter tuning
    max_tokens: 1024,
    system: `You are a parameter optimizer for an Ethereum liquidation bot.
You analyze trading performance data and simulation results, then propose small,
conservative parameter adjustments to improve the bot's opportunity capture rate.

You MUST respond with valid JSON only — no markdown, no explanation outside the JSON.
The JSON must match the HeuristicParams schema exactly.

Key principles:
- Prefer small, consistent improvements over large jumps (compounding advantage)
- Only increase max_gas_gwei if simulations show we lose opportunities due to gas
- Only decrease min_profit_eth if win rate is high and we're leaving money on the table
- Increase hf_alert_threshold if we're frequently beaten to positions (earlier warning)
- Changes should be incremental: ±10-20% per cycle at most`,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected LLM response type')
  }

  try {
    const proposed = JSON.parse(content.text) as HeuristicParams
    // Ensure version is bumped
    proposed.version = input.current_params.version + 1
    proposed.updated_at = Math.floor(Date.now() / 1000)
    return proposed
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${content.text}`)
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

function buildPrompt(input: CompileInput): string {
  const { current_params: p, simulation_results: sims, recent_trade_stats: stats } = input

  const missedDueToGas = sims.filter(
    (s) => !s.current_params_win && s.winner_gas_gwei > 0,
  )
  const avgWinnerGas = missedDueToGas.length > 0
    ? missedDueToGas.reduce((a, b) => a + b.winner_gas_gwei, 0) / missedDueToGas.length
    : 0
  const maxWinnerGas = missedDueToGas.length > 0
    ? Math.max(...missedDueToGas.map((s) => s.winner_gas_gwei))
    : 0

  return `
CURRENT PARAMETERS:
${JSON.stringify(p, null, 2)}

LAST 24H PERFORMANCE:
- Trade attempts: ${stats.total_attempts}
- Successes: ${stats.successes}
- Win rate: ${(stats.win_rate * 100).toFixed(1)}%
- Total profit: ${stats.total_profit_eth.toFixed(6)} ETH
- Avg profit per win: ${stats.avg_profit_per_win.toFixed(6)} ETH

MISSED OPPORTUNITIES (${stats.total_missed} total):
- Missed due to gas too low: ${stats.missed_due_to_gas}
- Missed due to timing: ${stats.missed_due_to_timing}

GAS ANALYSIS (from ${missedDueToGas.length} simulations):
- Average winner gas: ${avgWinnerGas.toFixed(4)} gwei
- Maximum winner gas: ${maxWinnerGas.toFixed(4)} gwei
- Our current max gas: ${p.max_gas_gwei} gwei
- Gas gap: ${(avgWinnerGas - p.max_gas_gwei).toFixed(4)} gwei

TASK: Propose updated parameters to improve opportunity capture rate.
Return ONLY valid JSON matching this schema:
{
  "max_gas_gwei": number,
  "min_profit_eth": number,
  "hf_alert_threshold": number,
  "scan_interval_ms": number,
  "scan_batch_size": number,
  "gas_estimate_liquidation": number,
  "circuit_breaker_failures": number,
  "circuit_breaker_pause_secs": number,
  "version": number,
  "updated_at": number,
  "rationale": string  // explain what you changed and why
}
`.trim()
}

export function getRecentTradeStats(lookbackHours = 24): TradeStats {
  const db = getDb()
  const since = Math.floor(Date.now() / 1000) - lookbackHours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as total_attempts,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN status = 'confirmed' THEN profit_eth ELSE 0 END) as total_profit,
      SUM(CASE WHEN status = 'confirmed' AND profit_eth > 0 THEN profit_eth ELSE 0 END) as winning_profit
    FROM trades
    WHERE strategy = 'liquidation-bots' AND created_at >= ?
  `).get(since) as {
    total_attempts: number
    successes: number
    total_profit: number
    winning_profit: number
  }

  const missed = db.prepare(
    `SELECT COUNT(*) as n FROM missed_opportunities WHERE timestamp >= ?`,
  ).get(since) as { n: number }

  const missedGas = db.prepare(
    `SELECT COUNT(*) as n FROM missed_opportunities
     WHERE timestamp >= ? AND winner_gas_gwei IS NOT NULL AND winner_gas_gwei > 0`,
  ).get(since) as { n: number }

  const totalAttempts = row.total_attempts ?? 0
  const successes = row.successes ?? 0
  const totalProfit = row.total_profit ?? 0
  const winningProfit = row.winning_profit ?? 0

  return {
    total_attempts: totalAttempts,
    successes,
    win_rate: totalAttempts > 0 ? successes / totalAttempts : 0,
    total_profit_eth: totalProfit,
    avg_profit_per_win: successes > 0 ? winningProfit / successes : 0,
    total_missed: missed.n,
    missed_due_to_gas: missedGas.n,
    missed_due_to_timing: missed.n - missedGas.n,
  }
}

function defaultParams(): HeuristicParams {
  return {
    max_gas_gwei: 1.0,
    min_profit_eth: 0.005,
    hf_alert_threshold: 1.08,
    scan_interval_ms: 12_000,
    scan_batch_size: 50,
    gas_estimate_liquidation: 900_000,
    circuit_breaker_failures: 3,
    circuit_breaker_pause_secs: 3600,
    version: 0,
    updated_at: null,
    rationale: 'Default seed parameters',
  }
}
