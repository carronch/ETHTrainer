import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { MungerAgent } from './munger.js'
import { ResearcherAgent } from './researcher.js'
import { StrategistAgent } from './strategist.js'
import { ExecutorAgent } from './executor-agent.js'
import { RiskManagerAgent } from './risk-manager.js'
import { getAllStrategies, getTotalSwept } from '../db/queries.js'
import { alertInfo } from '../telegram/bot.js'
import { getEthBalance } from '../ethereum/client.js'
import { getTradingAccount } from '../wallet/keystore.js'

/**
 * MasterAgent — the top-level orchestrator.
 *
 * Spawns and coordinates the full agent team:
 *   MungerAgent → strategic advisor
 *   ResearcherAgent → finds opportunities
 *   StrategistAgent → builds and manages playbooks
 *   ExecutorAgent → submits transactions
 *   RiskManagerAgent → monitors health
 */
export class MasterAgent extends BaseAgent {
  private munger: MungerAgent
  private researcher: ResearcherAgent
  private strategist: StrategistAgent
  private executor: ExecutorAgent
  private riskManager: RiskManagerAgent

  constructor(obsidianVaultPath?: string) {
    // Instantiate the team
    const munger = new MungerAgent(obsidianVaultPath)
    const researcher = new ResearcherAgent()
    const strategist = new StrategistAgent()
    const executor = new ExecutorAgent()
    const riskManager = new RiskManagerAgent()

    // Master's tools = delegate calls to team agents
    const masterTools: Tool[] = [
      BaseAgent.makeDelegateTool(
        munger,
        'ask_munger',
        'Ask the MungerAgent to evaluate a strategy, apply mental models, or provide strategic advice.'
      ),
      BaseAgent.makeDelegateTool(
        researcher,
        'ask_researcher',
        'Ask the ResearcherAgent to research an on-chain opportunity, fetch ethskills, or analyse market data.'
      ),
      BaseAgent.makeDelegateTool(
        strategist,
        'ask_strategist',
        'Ask the StrategistAgent to build a playbook, review the strategy pipeline, or promote/pause a strategy.'
      ),
      BaseAgent.makeDelegateTool(
        executor,
        'ask_executor',
        'Ask the ExecutorAgent to execute a trade, sweep profits to treasury, or check wallet status.'
      ),
      BaseAgent.makeDelegateTool(
        riskManager,
        'ask_risk_manager',
        'Ask the RiskManagerAgent to run a health check, get a risk report, or pause a strategy.'
      ),
      {
        name: 'get_system_overview',
        description: 'Get a high-level overview of the system state: balances, strategies, treasury progress.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          const account = getTradingAccount()
          const { eth } = await getEthBalance(account.address)
          const strategies = getAllStrategies()
          const totalSwept = getTotalSwept()
          return {
            network: process.env.NETWORK ?? 'holesky',
            tradingWallet: account.address,
            tradingBalanceEth: eth,
            treasurySweptEth: totalSwept,
            validatorProgressPct: ((totalSwept / 32) * 100).toFixed(2),
            strategies: {
              total: strategies.length,
              live: strategies.filter(s => s.status === 'live').length,
              testnet: strategies.filter(s => s.status === 'testnet').length,
              backtesting: strategies.filter(s => s.status === 'backtesting').length,
              research: strategies.filter(s => s.status === 'research').length,
            },
          }
        },
      },
    ]

    const MASTER_SYSTEM_PROMPT = `
You are the MasterAgent for ETHTrainer — an autonomous system accumulating ETH toward a 32 ETH validator.

You orchestrate a team of specialized agents:
- **MungerAgent**: Your strategic advisor. Consult before approving any new strategy.
- **ResearcherAgent**: Finds on-chain opportunities, fetches market data.
- **StrategistAgent**: Builds playbooks, manages strategy lifecycle.
- **ExecutorAgent**: Executes trades and treasury sweeps.
- **RiskManagerAgent**: Monitors system health and enforces limits.

## Your Cycle (run every session)

1. Get system overview
2. Ask risk manager for health check — if CRITICAL, stop and fix
3. Review strategy pipeline — any ready to promote?
4. Direct researcher on new domains if pipeline is thin
5. Consult Munger before approving any new strategy
6. Instruct executor on any pending trades or sweeps
7. Report status via alert

## Decision Principles

- Safety first: never skip the risk check
- Never approve a strategy without Munger's blessing
- Always prefer testnet before mainnet
- When in doubt, research more before acting
- Accumulate steadily — 32 ETH is the mission

Goal: 32 ETH in treasury → Ethereum validator → long-term staking rewards.
`.trim()

    super({
      name: 'master',
      systemPrompt: MASTER_SYSTEM_PROMPT,
      tools: masterTools,
      provider: 'claude',
      model: 'claude-opus-4-6',
    })

    this.munger = munger
    this.researcher = researcher
    this.strategist = strategist
    this.executor = executor
    this.riskManager = riskManager
  }

  /**
   * Run one full orchestration cycle.
   */
  async runCycle(): Promise<void> {
    this.log('info', '=== Starting orchestration cycle ===')

    // 1. Risk check first — always
    const riskStatus = await this.riskManager.runCheck()
    if (!riskStatus.healthy) {
      this.log('warn', 'System not healthy — limiting cycle to risk resolution')
      await this.runOnce('The risk manager reports the system is not healthy. Review the issues and determine what to fix before resuming normal operations.')
      return
    }

    // 2. Full cycle via LLM orchestration
    await this.runOnce(`
Run a full orchestration cycle:
1. Get system overview
2. Review strategy pipeline and decide what needs attention
3. If pipeline has fewer than 2 active research items, ask researcher to investigate a new domain
4. If any strategy is ready to promote, coordinate with strategist and munger
5. Check if any treasury sweep is due
6. Summarize what was done this cycle
    `.trim())

    this.log('info', '=== Cycle complete ===')
  }
}
