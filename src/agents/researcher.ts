import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { getPublicClient, getEthBalance } from '../ethereum/client.js'
import { insertBacktestResult, upsertStrategy, logAgent } from '../db/queries.js'

// ── Tools available to the ResearcherAgent ────────────────────────────────────

const RESEARCHER_TOOLS: Tool[] = [
  {
    name: 'fetch_ethskill',
    description: 'Fetch an ETHSkills curriculum module to learn about a specific Ethereum topic before researching it.',
    inputSchema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill name. Options: ship, concepts, wallets, gas, standards, building-blocks, addresses, security, testing, orchestration, tools, wallets, indexing, l2s',
        },
      },
      required: ['skill'],
    },
    execute: async (input) => {
      const url = `https://ethskills.com/${input.skill}/SKILL.md`
      try {
        const res = await fetch(url)
        if (!res.ok) return { error: `HTTP ${res.status} for ${url}` }
        const text = await res.text()
        return { url, content: text.slice(0, 8000) }  // truncate for context window
      } catch (err) {
        return { error: String(err) }
      }
    },
  },

  {
    name: 'get_block_info',
    description: 'Get current block number and basic chain state.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => {
      const client = getPublicClient()
      const [blockNumber, gasPrice] = await Promise.all([
        client.getBlockNumber(),
        client.getGasPrice(),
      ])
      return {
        blockNumber: blockNumber.toString(),
        gasPrice: gasPrice.toString(),
        gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
      }
    },
  },

  {
    name: 'get_address_balance',
    description: 'Get the ETH balance of any address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Ethereum address (0x...)' },
      },
      required: ['address'],
    },
    execute: async (input) => {
      return getEthBalance(input.address as `0x${string}`)
    },
  },

  {
    name: 'fetch_web',
    description: 'Fetch a public URL to research DeFi protocols, MEV strategies, Polymarket data, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
    execute: async (input) => {
      try {
        const res = await fetch(input.url as string, {
          headers: { 'User-Agent': 'ETHTrainer-ResearchBot/1.0' },
          signal: AbortSignal.timeout(10_000),
        })
        const text = await res.text()
        // Strip HTML tags for cleaner content
        const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        return { url: input.url, content: stripped.slice(0, 6000) }
      } catch (err) {
        return { error: String(err) }
      }
    },
  },

  {
    name: 'register_opportunity',
    description: 'Register a discovered opportunity as a new strategy for further evaluation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short strategy name (snake_case)' },
        description: { type: 'string', description: 'Full description of the opportunity' },
        confidence: { type: 'number', description: 'Initial confidence score 0.0-1.0' },
      },
      required: ['name', 'description', 'confidence'],
    },
    execute: async (input) => {
      upsertStrategy({
        name: input.name as string,
        description: input.description as string,
        status: 'research',
        confidence: input.confidence as number,
        approved_by_munger: 0,
      })
      logAgent('researcher', 'decision', `New opportunity registered: ${input.name}`, input)
      return { registered: true, name: input.name }
    },
  },
]

const RESEARCHER_SYSTEM_PROMPT = `
You are the ResearcherAgent for the ETHTrainer system.

Your mission: discover on-chain opportunities to generate ETH profit that will fund a validator.

## Your Research Domains

1. **MEV (Maximal Extractable Value)**
   - Sandwich attacks, arbitrage, liquidations, flashloans
   - Flashbots bundles, private mempools
   - Focus: consistent, repeatable edge

2. **Polymarket & Prediction Markets**
   - Asymmetric bets where the market is wrong
   - Events with high information advantage
   - Focus: +EV positions with clear edge

3. **DeFi Yield**
   - LP positions, yield farming, liquid staking
   - Protocol incentive programs
   - Focus: risk-adjusted returns

4. **On-chain Arbitrage**
   - Cross-DEX price discrepancies
   - Cross-chain bridges
   - Focus: gas-efficient execution

## Research Process

1. First, fetch relevant ETHSkills modules to ground yourself in the domain
2. Research the opportunity using fetch_web and on-chain data
3. Estimate profitability: expected value, win rate, gas costs
4. If promising: register_opportunity with a clear description
5. Always note the risks alongside the opportunity

## Output Format

For each opportunity found:
- **What**: What is the trade?
- **Why it works**: The market inefficiency being exploited
- **Expected value**: Rough estimate of profit per trade, win rate
- **Gas cost**: Estimated gas cost on mainnet
- **Risk**: Main failure modes
- **Next step**: What needs to be backtested?

Be specific and quantitative. Vague opportunities are not useful.
`.trim()

export class ResearcherAgent extends BaseAgent {
  constructor() {
    super({
      name: 'researcher',
      systemPrompt: RESEARCHER_SYSTEM_PROMPT,
      tools: RESEARCHER_TOOLS,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    })
  }

  async researchDomain(domain: string): Promise<string> {
    this.log('info', `Researching domain: ${domain}`)
    return this.runOnce(`Research the following domain for ETH profit opportunities: ${domain}`)
  }

  async deepResearch(topic: string): Promise<string> {
    this.log('info', `Deep research: ${topic}`)
    return this.run(topic)
  }
}
