/**
 * Collector — pulls recent missed opportunities and LiquidationCall events.
 *
 * Data sources:
 *   1. SQLite missed_opportunities table (logged by Rust missed_tracker)
 *   2. The Graph (Aave v3 Arbitrum) for enrichment — winner gas prices, profit amounts
 *
 * The Graph endpoint for Aave v3 Arbitrum:
 *   https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum
 */

import { getDb } from '../db/index.js'
import type { MissedOpportunity } from './types.js'

const THEGRAPH_URLS: Record<string, string> = {
  arbitrum: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum',
  optimism: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-optimism',
  base:     'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base',
}

// ── Queries ───────────────────────────────────────────────────────────────────

const LIQUIDATION_CALLS_QUERY = `
query GetLiquidations($since: Int!, $first: Int!) {
  liquidationCalls(
    first: $first
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gte: $since }
  ) {
    id
    borrower { id }
    collateralReserve { id symbol decimals }
    principalReserve { id symbol decimals }
    collateralAmount
    principalAmount
    liquidator
    timestamp
    txHash
    gasUsed
    gasPrice
  }
}
`

interface GraphLiquidationCall {
  id: string
  borrower: { id: string }
  collateralReserve: { id: string; symbol: string }
  principalReserve: { id: string; symbol: string }
  collateralAmount: string
  principalAmount: string
  liquidator: string
  timestamp: string
  txHash: string
  gasUsed: string
  gasPrice: string
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch missed opportunities from the last N hours.
 * Enriches gas data from The Graph where available.
 */
export async function getMissedOpportunities(
  chain = 'arbitrum',
  lookbackHours = 24,
): Promise<MissedOpportunity[]> {
  const db = getDb()
  const since = Math.floor(Date.now() / 1000) - lookbackHours * 3600

  const rows = db
    .prepare(
      `SELECT * FROM missed_opportunities
       WHERE timestamp >= ? AND chain = ? AND analyzed = 0
       ORDER BY timestamp DESC`,
    )
    .all(since, chain) as unknown as MissedOpportunity[]

  if (rows.length === 0) return []

  // Enrich with on-chain gas data from The Graph
  try {
    const enriched = await enrichWithGraphData(rows, since, chain)
    return enriched
  } catch {
    // The Graph is best-effort — return raw rows if enrichment fails
    return rows
  }
}

/**
 * Pull the full on-chain liquidation history for the last N hours.
 * Used to measure our theoretical capture rate (how many total liquidations
 * happened vs how many we executed).
 */
export async function getOnChainLiquidations(
  chain = 'arbitrum',
  lookbackHours = 24,
): Promise<GraphLiquidationCall[]> {
  const since = Math.floor(Date.now() / 1000) - lookbackHours * 3600
  const graphUrl = THEGRAPH_URLS[chain] ?? THEGRAPH_URLS.arbitrum

  const response = await fetch(graphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: LIQUIDATION_CALLS_QUERY,
      variables: { since, first: 1000 },
    }),
  })

  if (!response.ok) throw new Error(`The Graph request failed: ${response.status}`)

  const json = (await response.json()) as {
    data?: { liquidationCalls: GraphLiquidationCall[] }
    errors?: unknown[]
  }

  if (json.errors?.length) throw new Error(`The Graph errors: ${JSON.stringify(json.errors)}`)
  return json.data?.liquidationCalls ?? []
}

/**
 * Mark missed opportunities as analyzed so they don't get re-processed.
 */
export function markAnalyzed(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE missed_opportunities SET analyzed = 1 WHERE id IN (${placeholders})`).run(...ids)
}

// ── Private ───────────────────────────────────────────────────────────────────

async function enrichWithGraphData(
  rows: MissedOpportunity[],
  since: number,
  chain: string,
): Promise<MissedOpportunity[]> {
  const onChain = await getOnChainLiquidations(
    chain,
    Math.ceil((Date.now() / 1000 - since) / 3600),
  )

  // Build a map: borrower_address → on-chain liquidation
  const byBorrower = new Map(onChain.map((l) => [l.borrower.id.toLowerCase(), l]))

  return rows.map((row) => {
    const match = byBorrower.get(row.borrower.toLowerCase())
    if (!match) return row

    const gasPriceGwei = match.gasPrice ? Number(match.gasPrice) / 1e9 : null
    return {
      ...row,
      winner_gas_gwei: gasPriceGwei ?? row.winner_gas_gwei,
    }
  })
}
