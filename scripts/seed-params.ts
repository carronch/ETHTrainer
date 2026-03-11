/**
 * seed-params.ts — Pull 6 months of Aave v3 Arbitrum liquidation history
 * from The Graph and compute optimal initial heuristic parameters.
 *
 * Writes the result to heuristic_params.json (the file the Rust executor reads).
 *
 * Run once before going live:
 *   tsx scripts/seed-params.ts
 */

import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: '.dev.vars' })
import { writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'

const CHAIN = process.env['NETWORK'] ?? 'arbitrum'
const THEGRAPH_URL = 'https://api.studio.thegraph.com/query/75401/aave-v3-arbitrum-project/version/latest'
const PARAMS_FILE = `heuristic_params.${CHAIN}.json`

// ── Data fetching ─────────────────────────────────────────────────────────────

interface LiquidationEvent {
  timestamp: number
  gasPrice: number     // in wei
  collateralAmountUSD: number
  principalAmountUSD: number
  profit: number       // estimated: collateral * bonus - principal - flash_fee
}

async function fetchLiquidationHistory(daysBack = 180): Promise<LiquidationEvent[]> {
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400

  const query = `
    query GetHistory($since: Int!, $skip: Int!) {
      liquidationCalls(
        first: 1000
        skip: $skip
        orderBy: timestamp
        orderDirection: asc
        where: { timestamp_gte: $since }
      ) {
        timestamp
        gasPrice
        collateralAmountUSD
        principalAmountUSD
        collateralReserve { id }
        principalReserve { id }
      }
    }
  `

  const events: LiquidationEvent[] = []
  let skip = 0

  while (true) {
    const response = await fetch(THEGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { since, skip } }),
    })

    const json = await response.json() as {
      data?: { liquidationCalls: {
        timestamp: string
        gasPrice: string
        collateralAmountUSD: string
        principalAmountUSD: string
      }[] }
      errors?: unknown[]
    }

    if (json.errors?.length) {
      console.error('The Graph error:', json.errors)
      break
    }

    const batch = json.data?.liquidationCalls ?? []
    if (batch.length === 0) break

    for (const l of batch) {
      const collateralUSD = parseFloat(l.collateralAmountUSD)
      const principalUSD = parseFloat(l.principalAmountUSD)
      const gasPrice = parseFloat(l.gasPrice) / 1e9 // convert to gwei
      // Estimated profit: liquidation bonus is ~5% on Aave v3
      // profit ≈ collateral * 1.05 - principal - flash_fee (0.09%)
      const profit = collateralUSD * 1.05 - principalUSD * 1.0009

      events.push({
        timestamp: parseInt(l.timestamp),
        gasPrice,
        collateralAmountUSD: collateralUSD,
        principalAmountUSD: principalUSD,
        profit,
      })
    }

    if (batch.length < 1000) break // last page
    skip += 1000
    await new Promise(r => setTimeout(r, 200)) // rate limit
  }

  return events
}

// ── Analysis ──────────────────────────────────────────────────────────────────

interface ParamAnalysis {
  total_liquidations: number
  avg_gas_gwei: number
  p50_gas_gwei: number
  p75_gas_gwei: number
  p90_gas_gwei: number
  avg_profit_usd: number
  min_profitable_usd: number  // 10th percentile profit
  profitable_count: number
  days_analyzed: number
}

function analyzeHistory(events: LiquidationEvent[]): ParamAnalysis {
  if (events.length === 0) {
    return {
      total_liquidations: 0,
      avg_gas_gwei: 0.5,
      p50_gas_gwei: 0.3,
      p75_gas_gwei: 0.5,
      p90_gas_gwei: 1.0,
      avg_profit_usd: 50,
      min_profitable_usd: 10,
      profitable_count: 0,
      days_analyzed: 0,
    }
  }

  const profitable = events.filter(e => e.profit > 0)
  const gasPrices = events.map(e => e.gasPrice).sort((a, b) => a - b)
  const profits = profitable.map(e => e.profit).sort((a, b) => a - b)

  const p = (arr: number[], pct: number) => arr[Math.floor(arr.length * pct)]

  const daysSpan = events.length > 0
    ? (events[events.length - 1].timestamp - events[0].timestamp) / 86400
    : 0

  return {
    total_liquidations: events.length,
    avg_gas_gwei: gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length,
    p50_gas_gwei: p(gasPrices, 0.5),
    p75_gas_gwei: p(gasPrices, 0.75),
    p90_gas_gwei: p(gasPrices, 0.9),
    avg_profit_usd: profits.reduce((a, b) => a + b, 0) / (profits.length || 1),
    min_profitable_usd: p(profits, 0.1) || 0,
    profitable_count: profitable.length,
    days_analyzed: daysSpan,
  }
}

// ── LLM param seeding ─────────────────────────────────────────────────────────

async function seedParamsWithLLM(analysis: ParamAnalysis): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `
You are seeding initial parameters for an Ethereum liquidation bot targeting Aave v3 on Arbitrum.

HISTORICAL DATA (last ${analysis.days_analyzed.toFixed(0)} days):
- Total liquidations observed: ${analysis.total_liquidations}
- Gas prices: avg=${analysis.avg_gas_gwei.toFixed(4)} gwei, p50=${analysis.p50_gas_gwei.toFixed(4)}, p75=${analysis.p75_gas_gwei.toFixed(4)}, p90=${analysis.p90_gas_gwei.toFixed(4)}
- Profitable liquidations: ${analysis.profitable_count} (${((analysis.profitable_count / analysis.total_liquidations) * 100).toFixed(1)}%)
- Avg profit (profitable only): $${analysis.avg_profit_usd.toFixed(2)} USD
- Min profitable: $${analysis.min_profitable_usd.toFixed(2)} USD (10th percentile)
- ETH price approx: $3000 (for gas cost conversion)

GOAL: Set conservative but competitive initial parameters.
- max_gas_gwei should be at or just above p75 gas (to win ~75% of opportunities)
- min_profit_eth should cover 2x our gas cost (800k gas * max_gas_gwei * gas_price)
- hf_alert_threshold: slightly above 1.0 to get early warnings (1.05-1.10 is typical)
- scan_interval_ms: 12000 (12s) is standard for Arbitrum

Return ONLY valid JSON matching this exact schema:
{
  "max_gas_gwei": number,
  "min_profit_eth": number,
  "hf_alert_threshold": number,
  "scan_interval_ms": number,
  "scan_batch_size": number,
  "gas_estimate_liquidation": number,
  "circuit_breaker_failures": number,
  "circuit_breaker_pause_secs": number,
  "version": 1,
  "updated_at": ${Math.floor(Date.now() / 1000)},
  "rationale": "string explaining the initial seed values"
}
`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')

  // Clean markdown code fences if present
  const cleaned = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const params = JSON.parse(cleaned)

  writeFileSync(PARAMS_FILE, JSON.stringify(params, null, 2), 'utf8')
  console.log('\nSeeded heuristic_params.json:')
  console.log(JSON.stringify(params, null, 2))
  console.log(`\nWritten to ${PARAMS_FILE}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Fetching 6 months of Aave v3 Arbitrum liquidation history...')
  console.log('(This may take a minute due to rate limiting)\n')

  let events: LiquidationEvent[] = []
  try {
    events = await fetchLiquidationHistory(180)
    console.log(`Fetched ${events.length} liquidation events`)
  } catch (err) {
    console.error('Failed to fetch history:', err)
    console.log('Proceeding with hardcoded conservative defaults\n')
  }

  const analysis = analyzeHistory(events)
  console.log('\nAnalysis:', analysis)

  if (!process.env.ANTHROPIC_API_KEY || analysis.total_liquidations === 0) {
    if (analysis.total_liquidations === 0) {
      console.log('\nNo historical data — writing conservative defaults')
    } else {
      console.error('\nANTHROPIC_API_KEY not set — writing conservative defaults instead')
    }
    const defaults = {
      max_gas_gwei: 1.0,
      min_profit_eth: 0.005,
      hf_alert_threshold: 1.08,
      scan_interval_ms: 12000,
      scan_batch_size: 50,
      gas_estimate_liquidation: 900000,
      circuit_breaker_failures: 3,
      circuit_breaker_pause_secs: 3600,
      version: 1,
      updated_at: Math.floor(Date.now() / 1000),
      rationale: 'Conservative defaults (no LLM seeding — ANTHROPIC_API_KEY not set)',
    }
    writeFileSync(PARAMS_FILE, JSON.stringify(defaults, null, 2), 'utf8')
    return
  }

  console.log('\nAsking Claude to compute optimal initial parameters...')
  await seedParamsWithLLM(analysis)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
