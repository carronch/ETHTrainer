/**
 * seed-borrowers.ts — Fetch all active Aave v3 borrowers on Arbitrum from The Graph
 * and seed them into the `liquidation_watchlist` SQLite database.
 *
 * Usage:
 *   npx tsx scripts/seed-borrowers.ts [--db=ethtrainer.db]
 */

import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: '.dev.vars' })
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

const THEGRAPH_URL = 'https://gateway-arbitrum.network.thegraph.com/api/1fcfe048e5def62f0f8a85c390cb30e4/subgraphs/id/4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf'

const options = {
  db: { type: 'string' as const, default: 'ethtrainer.db' },
}
const { values } = parseArgs({ args: process.argv.slice(2), options })

interface BorrowerData {
  id: string
}

async function fetchAllBorrowers(): Promise<Set<string>> {
  const borrowers = new Set<string>()
  let skip = 0

  const query = `
    query GetBorrowers($skip: Int!) {
      users(
        first: 1000
        skip: $skip
        where: { borrowedReservesCount_gt: 0 }
      ) {
        id
      }
    }
  `

  while (true) {
    console.log(`Fetching batch (skip: ${skip})...`)
    const response = await fetch(THEGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { skip } }),
    })

    const json = await response.json() as {
      data?: { users: BorrowerData[] }
      errors?: unknown[]
    }

    if (json.errors?.length) {
      console.error('The Graph error:', json.errors)
      break
    }

    const batch = json.data?.users ?? []
    if (batch.length === 0) break

    for (const b of batch) {
      // The Graph returns addresses lowercased
      borrowers.add(b.id)
    }

    if (batch.length < 1000) break
    skip += 1000
    await new Promise(r => setTimeout(r, 200)) // Light rate limiting
  }

  return borrowers
}

async function main() {
  console.log(`Connecting to SQLite DB: ${values.db}`)
  const db = new DatabaseSync(values.db)

  // Ensure table exists (matches Rust schema)
  db.exec(`
    CREATE TABLE IF NOT EXISTS liquidation_watchlist (
        address TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        last_checked_at INTEGER,
        last_block_seen INTEGER NOT NULL
    )
  `)

  // Prepare UPSERT statement
  const stmt = db.prepare(`
    INSERT INTO liquidation_watchlist (address, added_at, last_block_seen)
    VALUES (?, strftime('%s', 'now'), 0)
    ON CONFLICT(address) DO UPDATE SET
        last_block_seen = MAX(last_block_seen, 0)
  `)

  console.log(`Fetching all active borrowers from The Graph (${THEGRAPH_URL})...`)
  const borrowers = await fetchAllBorrowers()
  
  if (borrowers.size === 0) {
    console.log('No borrowers found or The Graph query failed.')
    return
  }

  console.log(`\nFound ${borrowers.size} active borrowers. Upserting to database...`)
  
  let inserted = 0
  db.exec('BEGIN TRANSACTION')
  try {
    for (const address of borrowers) {
      stmt.run(address)
      inserted++
    }
    db.exec('COMMIT')
    console.log(`✅ Successfully seeded ${inserted} borrowers into the watchlist!`)
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('Failed to write to database:', err)
  }
  
  db.close()
}

main().catch(console.error)
