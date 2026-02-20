import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { getEthBalance } from '../ethereum/client.js'
import { getTradingAccount } from '../wallet/keystore.js'
import { getAgentLogs, getAllStrategies, getTotalSwept } from '../db/queries.js'
import { alertWarning, alertError } from '../telegram/bot.js'

export interface RiskStatus {
  healthy: boolean
  issues: string[]
  tradingBalanceEth: string
  treasuryProgressPct: number
  activeStrategies: number
}

const RISK_MANAGER_TOOLS: Tool[] = [
  {
    name: 'check_risk_status',
    description: 'Run a full risk status check on the system.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async (): Promise<RiskStatus> => {
      const account = getTradingAccount()
      const { eth } = await getEthBalance(account.address)
      const balance = parseFloat(eth)
      const floor = parseFloat(process.env.TRADING_WALLET_FLOOR_ETH ?? '0.5')
      const totalSwept = getTotalSwept()
      const strategies = getAllStrategies()
      const liveStrategies = strategies.filter(s => s.status === 'live')

      const issues: string[] = []

      if (balance < floor) {
        issues.push(`CRITICAL: Trading wallet (${eth} ETH) is below floor (${floor} ETH)`)
      } else if (balance < floor * 1.5) {
        issues.push(`WARNING: Trading wallet (${eth} ETH) is close to floor (${floor} ETH)`)
      }

      const unapprovedLive = liveStrategies.filter(s => !s.approved_by_munger)
      if (unapprovedLive.length > 0) {
        issues.push(`CRITICAL: ${unapprovedLive.length} live strategies without Munger approval: ${unapprovedLive.map(s => s.name).join(', ')}`)
      }

      const losingStrategies = liveStrategies.filter(s =>
        s.total_trades && s.total_trades > 10 && (s.winning_trades ?? 0) / s.total_trades < 0.35
      )
      if (losingStrategies.length > 0) {
        issues.push(`WARNING: Underperforming strategies: ${losingStrategies.map(s => s.name).join(', ')}`)
      }

      return {
        healthy: issues.filter(i => i.startsWith('CRITICAL')).length === 0,
        issues,
        tradingBalanceEth: eth,
        treasuryProgressPct: (totalSwept / 32) * 100,
        activeStrategies: liveStrategies.length,
      }
    },
  },

  {
    name: 'pause_strategy',
    description: 'Pause a strategy immediately due to risk concerns.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['name', 'reason'],
    },
    execute: async (input) => {
      const { upsertStrategy } = await import('../db/queries.js')
      const { getStrategy } = await import('../db/queries.js')
      const existing = getStrategy(input.name as string)
      if (!existing) return { error: 'Strategy not found' }
      upsertStrategy({ ...existing, status: 'paused' })
      await alertWarning(`Strategy paused: *${input.name}*\nReason: ${input.reason}`)
      return { paused: true, name: input.name }
    },
  },

  {
    name: 'get_recent_errors',
    description: 'Get recent error logs from all agents.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Number of recent errors to fetch (default 20)' } },
      required: [],
    },
    execute: async (input) => {
      return getAgentLogs(undefined, (input.limit as number) ?? 20)
    },
  },
]

const RISK_MANAGER_SYSTEM_PROMPT = `
You are the RiskManagerAgent for the ETHTrainer system.

Your job: continuous monitoring and enforcement of risk rules.
You are the system's immune system — you detect threats before they become losses.

## Hard Limits You Enforce

1. Trading wallet never below 0.5 ETH floor
2. No live strategies without Munger approval
3. Any strategy with <35% win rate after 10+ trades → pause immediately
4. Any strategy with 3 consecutive losses → flag for review
5. On mainnet: any single trade >1 ETH requires a log entry justifying it

## Your Monitoring Checklist (run every cycle)

- [ ] Check trading wallet balance vs floor
- [ ] Check all live strategies for win rate degradation
- [ ] Check recent error logs for patterns
- [ ] Verify no unapproved strategies are live
- [ ] Report treasury progress toward 32 ETH goal

## Output

Always end your report with:
- System status: HEALTHY | DEGRADED | CRITICAL
- Actions taken (if any)
- Recommended next actions
`.trim()

export class RiskManagerAgent extends BaseAgent {
  constructor() {
    super({
      name: 'risk-manager',
      systemPrompt: RISK_MANAGER_SYSTEM_PROMPT,
      tools: RISK_MANAGER_TOOLS,
      provider: 'claude',
      model: 'claude-haiku-4-5-20251001',  // fast + cheap for routine monitoring
    })
  }

  async runCheck(): Promise<RiskStatus> {
    const tool = RISK_MANAGER_TOOLS.find(t => t.name === 'check_risk_status')!
    const status = await tool.execute({}) as RiskStatus

    if (!status.healthy) {
      const criticals = status.issues.filter(i => i.startsWith('CRITICAL'))
      for (const issue of criticals) {
        await alertError(`Risk: ${issue}`)
      }
      const warnings = status.issues.filter(i => i.startsWith('WARNING'))
      for (const w of warnings) {
        await alertWarning(w)
      }
    }

    return status
  }

  async fullReport(): Promise<string> {
    return this.runOnce('Run a full risk check and produce a status report.')
  }
}
