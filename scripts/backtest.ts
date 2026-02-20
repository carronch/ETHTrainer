/**
 * Backtest runner script.
 * Usage: npm run backtest <strategy-name>
 *
 * Example: npm run backtest mev_sandwich
 */

import 'dotenv/config'
import { getDb } from '../src/db/index.js'
import { runBacktest, formatBacktestReport } from '../src/backtester/index.js'
import { getPublicClient } from '../src/ethereum/client.js'
import { MungerAgent } from '../src/agents/munger.js'

const strategyName = process.argv[2]

if (!strategyName) {
  console.error('Usage: npm run backtest <strategy-name>')
  process.exit(1)
}

async function main() {
  console.log(`\n=== Backtesting: ${strategyName} ===\n`)

  // Initialize DB
  getDb()

  const client = getPublicClient()
  const currentBlock = await client.getBlockNumber()

  // Backtest over the last ~7 days of blocks (Holesky: ~12s/block → ~50400 blocks/week)
  const toBlock = currentBlock
  const fromBlock = toBlock - BigInt(50_400)

  console.log(`Block range: ${fromBlock} → ${toBlock}`)
  console.log('Loading strategy simulator...')

  // Dynamically load the strategy simulator if it exists
  let simulate: (block: bigint) => Promise<{ timestamp: number; action: 'arb'; profitEth: number; gasEth: number; netProfitEth: number } | null>

  try {
    const mod = await import(`../src/strategies/${strategyName}.js`) as { simulate: typeof simulate }
    simulate = mod.simulate
  } catch {
    console.error(`No simulator found for "${strategyName}". Create one at src/strategies/${strategyName}.ts`)
    console.log('\nExample simulator structure:')
    console.log(`
// src/strategies/${strategyName}.ts
export async function simulate(blockNumber: bigint) {
  // Your simulation logic here
  // Return null if no trade would have occurred
  // Return trade details if a trade would have occurred
  return null
}
`)
    process.exit(1)
  }

  const summary = await runBacktest({ strategyName, fromBlock, toBlock, simulate })
  const report = formatBacktestReport(strategyName, summary)
  console.log('\n' + report)

  // Auto-submit to Munger for review if results look promising
  if (summary.winRate >= 0.4 && summary.avgProfitEth > 0) {
    console.log('\n📋 Submitting to MungerAgent for review...')
    const munger = new MungerAgent(process.env.OBSIDIAN_VAULT_PATH)
    const evaluation = await munger.evaluate(strategyName, report)
    console.log('\n=== Munger Evaluation ===\n')
    console.log(evaluation)
  } else {
    console.log('\n⚠️  Results below threshold — not submitting to Munger yet.')
    console.log('   Win rate < 40% or negative expected value. More research needed.')
  }
}

main().catch(err => {
  console.error('Backtest failed:', err)
  process.exit(1)
})
