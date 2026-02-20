import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { getAllStrategies, getStrategy, upsertStrategy } from '../db/queries.js'

const PLAYBOOKS_DIR = join(process.cwd(), 'tasks', 'playbooks')

const STRATEGIST_TOOLS: Tool[] = [
  {
    name: 'get_all_strategies',
    description: 'List all known strategies with their performance stats.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => getAllStrategies(),
  },
  {
    name: 'get_strategy',
    description: 'Get details on a specific strategy.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute: async (input) => getStrategy(input.name as string),
  },
  {
    name: 'write_playbook',
    description: 'Write or update a strategy playbook file.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Strategy name (snake_case)' },
        content: { type: 'string', description: 'Full markdown playbook content' },
      },
      required: ['name', 'content'],
    },
    execute: async (input) => {
      const path = join(PLAYBOOKS_DIR, `${input.name}.md`)
      writeFileSync(path, input.content as string, 'utf8')
      upsertStrategy({
        name: input.name as string,
        status: 'backtesting',
        confidence: 0.5,
        playbook_path: path,
      })
      return { saved: true, path }
    },
  },
  {
    name: 'read_playbook',
    description: 'Read an existing strategy playbook.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute: async (input) => {
      const path = join(PLAYBOOKS_DIR, `${input.name}.md`)
      if (!existsSync(path)) return { error: 'Playbook not found' }
      return { content: readFileSync(path, 'utf8') }
    },
  },
  {
    name: 'promote_strategy',
    description: 'Promote a strategy to the next phase (backtesting → testnet → live).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { type: 'string', enum: ['backtesting', 'testnet', 'live', 'paused'] },
        confidence: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['name', 'status', 'reason'],
    },
    execute: async (input) => {
      const existing = getStrategy(input.name as string)
      if (!existing) return { error: 'Strategy not found' }
      if (!existing.approved_by_munger && input.status === 'live') {
        return { error: 'Cannot go live without Munger approval. Get MungerAgent to evaluate first.' }
      }
      upsertStrategy({
        ...existing,
        status: input.status as Strategy['status'],
        confidence: (input.confidence as number) ?? existing.confidence,
      })
      return { promoted: true, name: input.name, newStatus: input.status }
    },
  },
]

type Strategy = {
  status: 'research' | 'backtesting' | 'testnet' | 'live' | 'paused'
}

const STRATEGIST_SYSTEM_PROMPT = `
You are the StrategistAgent for the ETHTrainer system.

Your job: turn research findings and backtest results into actionable, well-documented strategy playbooks.
You manage the lifecycle of each strategy from research → backtesting → testnet → live.

## Playbook Format

Every playbook must include:
1. **What**: One-sentence description
2. **Why it works**: The market inefficiency
3. **Entry conditions**: Exact conditions to enter a trade
4. **Exit conditions**: When to exit (profit target, stop loss, time limit)
5. **Position sizing**: How much ETH to allocate per trade
6. **Gas budget**: Maximum acceptable gas cost
7. **Risk controls**: What makes this trade invalid
8. **Backtest summary**: Key stats
9. **Munger verdict**: Approval status and notes

## Promotion Rules

- research → backtesting: After 3+ days of research
- backtesting → testnet: After backtest shows >45% win rate AND positive expected value
- testnet → live: After 30+ simulated trades on testnet AND Munger approval
- Any status → paused: Any time a strategy looks wrong

Guard the pipeline. A strategy that hasn't been properly backtested and Munger-approved
never goes live.
`.trim()

export class StrategistAgent extends BaseAgent {
  constructor() {
    super({
      name: 'strategist',
      systemPrompt: STRATEGIST_SYSTEM_PROMPT,
      tools: STRATEGIST_TOOLS,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    })
  }

  async buildPlaybook(strategyName: string, researchNotes: string, backtestReport: string): Promise<string> {
    this.log('decision', `Building playbook for: ${strategyName}`)
    return this.runOnce(
      `Build a complete playbook for strategy "${strategyName}".\n\nResearch notes:\n${researchNotes}\n\nBacktest report:\n${backtestReport}`
    )
  }

  async reviewPipeline(): Promise<string> {
    this.log('info', 'Reviewing strategy pipeline')
    return this.runOnce('Review all strategies in the pipeline. Which are ready to be promoted? Which need attention?')
  }
}
