/**
 * Standalone research runner — no wallet, no node, no Telegram required.
 * Only needs: ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .dev.vars
 *
 * Usage:
 *   npm run research                        — full research cycle
 *   npm run research -- --domain mev        — research one domain
 *   npm run research -- --domain polymarket
 *   npm run research -- --domain defi-yield
 *   npm run research -- --evaluate <name>   — run MungerAgent on a strategy
 */

import 'dotenv/config'
import { getDb } from '../src/db/index.js'
import { ResearcherAgent } from '../src/agents/researcher.js'
import { MungerAgent } from '../src/agents/munger.js'
import { getAllStrategies } from '../src/db/queries.js'

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const domainArg = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null
const evaluateArg = args.includes('--evaluate') ? args[args.indexOf('--evaluate') + 1] : null

// ── Research domains ──────────────────────────────────────────────────────────

const RESEARCH_DOMAINS = [
  {
    name: 'mev',
    prompt: `
Research MEV (Maximal Extractable Value) opportunities on Ethereum.
Focus on:
1. Sandwich attacks — how they work, current profitability, gas costs
2. DEX arbitrage — cross-DEX price discrepancies, realistic edge
3. Liquidation bots — lending protocol liquidations (Aave, Compound)
4. Flashloan arbitrage — capital-efficient strategies

For each opportunity:
- Estimate realistic profit per trade (not best case)
- Estimate gas cost on mainnet
- Assess competition level (how saturated is this?)
- What infrastructure is actually needed?

Use fetch_ethskill to read: building-blocks, gas, orchestration
Then register the top 2-3 opportunities as strategies.
`.trim(),
  },
  {
    name: 'polymarket',
    prompt: `
Research Polymarket as an ETH accumulation strategy.

Fetch and analyze:
1. https://polymarket.com — what markets exist right now?
2. https://docs.polymarket.com — how does the API work? What data is available?
3. What are the contract mechanics? How are bets settled?

Focus on:
- Asymmetric bets: markets where the crowd is systematically wrong
- Information edge opportunities: events where we can have better data
- Liquidity: are markets liquid enough to trade profitably after fees?
- How much ETH is needed to make meaningful returns?

Use fetch_ethskill to read: building-blocks, standards
Then register the top opportunity as a strategy.
`.trim(),
  },
  {
    name: 'defi-yield',
    prompt: `
Research risk-adjusted DeFi yield strategies for ETH accumulation.

Investigate:
1. Liquid staking: Lido (stETH), Rocket Pool (rETH) — current APY, risks
2. Lending: Aave v3 — ETH supply APY, safety
3. LP positions: Uniswap v3 ETH/stablecoin — realistic fees vs impermanent loss
4. Pendle Finance — yield trading opportunities
5. EigenLayer — restaking yields

For each:
- Current APY (real, not incentivized)
- Smart contract risk
- Capital requirement
- Complexity to automate

Use fetch_ethskill to read: building-blocks, security
Register the top 2 strategies.
`.trim(),
  },
  {
    name: 'onchain-data-edges',
    prompt: `
Research on-chain data edge opportunities — strategies that require reading
blockchain state faster or smarter than others.

Investigate:
1. Mempool monitoring — what can be seen before blocks are confirmed?
2. On-chain sentiment signals — wallet tracking, whale movements
3. Protocol-specific edges — governance votes, token unlocks, large transfers
4. NFT/token launch sniping — is this still viable?

What data sources exist?
- Etherscan API
- The Graph (indexing)
- Dune Analytics
- Nansen

Which of these strategies can be run WITHOUT a private node?

Use fetch_ethskill to read: indexing, orchestration
Register top opportunities.
`.trim(),
  },
]

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 ETHTrainer Research Runner\n')

  // Validate API keys
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('❌ No API key found.')
    console.error('   Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .dev.vars')
    process.exit(1)
  }

  // Initialize DB (no node/wallet needed)
  getDb()
  console.log('✅ Database ready')

  const obsidianPath = process.env.OBSIDIAN_VAULT_PATH
  console.log(`✅ Obsidian vault: ${obsidianPath ?? '(not set — MungerAgent uses built-in models only)'}`)
  console.log()

  const researcher = new ResearcherAgent()
  const munger = new MungerAgent(obsidianPath)

  // ── Mode: evaluate a specific strategy ──────────────────────────────────────
  if (evaluateArg) {
    const strategies = getAllStrategies()
    const strategy = strategies.find(s => s.name === evaluateArg)
    if (!strategy) {
      console.error(`Strategy "${evaluateArg}" not found in database.`)
      console.error('Known strategies:', strategies.map(s => s.name).join(', '))
      process.exit(1)
    }
    console.log(`🧠 MungerAgent evaluating: ${evaluateArg}\n`)
    const evaluation = await munger.evaluate(strategy.name, strategy.description ?? '(no description)')
    console.log(evaluation)
    return
  }

  // ── Mode: research a specific domain ────────────────────────────────────────
  if (domainArg) {
    const domain = RESEARCH_DOMAINS.find(d => d.name === domainArg)
    if (!domain) {
      console.error(`Unknown domain: ${domainArg}`)
      console.error('Available:', RESEARCH_DOMAINS.map(d => d.name).join(', '))
      process.exit(1)
    }
    await runDomainResearch(researcher, munger, domain)
    return
  }

  // ── Mode: full research cycle ────────────────────────────────────────────────
  console.log('Running full research cycle across all domains...')
  console.log('This will take a while. Results are saved to the database as we go.\n')

  for (const domain of RESEARCH_DOMAINS) {
    await runDomainResearch(researcher, munger, domain)
    console.log()
  }

  // Final summary
  console.log('\n📊 Research Complete — Strategy Summary:\n')
  const strategies = getAllStrategies()
  for (const s of strategies) {
    const mungerStatus = s.approved_by_munger ? '✅ Munger approved' : '⏳ Pending Munger review'
    console.log(`  ${s.name}`)
    console.log(`    Status: ${s.status} | Confidence: ${(s.confidence * 100).toFixed(0)}% | ${mungerStatus}`)
    if (s.munger_notes) {
      console.log(`    Munger: ${s.munger_notes.slice(0, 120)}...`)
    }
    console.log()
  }

  console.log('Next step: npm run research -- --evaluate <strategy-name>')
  console.log('Or: npm run backtest <strategy-name>  (once node is connected)')
}

async function runDomainResearch(
  researcher: ResearcherAgent,
  munger: MungerAgent,
  domain: { name: string; prompt: string },
) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🔍 Researching: ${domain.name.toUpperCase()}`)
  console.log('─'.repeat(60))

  const findings = await researcher.deepResearch(domain.prompt)

  console.log('\n📋 Research findings:')
  console.log(findings)

  // Auto-evaluate newly registered strategies with Munger
  const strategies = getAllStrategies().filter(
    s => s.status === 'research' && !s.approved_by_munger && !s.munger_notes,
  )

  if (strategies.length > 0) {
    console.log(`\n🧠 MungerAgent reviewing ${strategies.length} new strategies...`)
    for (const s of strategies) {
      console.log(`\n  Evaluating: ${s.name}`)
      const evaluation = await munger.evaluate(s.name, s.description ?? findings)
      console.log(evaluation.slice(0, 500) + '...')
    }
  }
}

main().catch(err => {
  console.error('Research failed:', err)
  process.exit(1)
})
