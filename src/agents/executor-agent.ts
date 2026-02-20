import { BaseAgent } from './base.js'
import type { Tool } from '../llm/index.js'
import { getEthBalance, sendEth, getGasPrice } from '../ethereum/client.js'
import { getTradingAccount } from '../wallet/keystore.js'
import { insertTrade, updateTradeConfirmed, insertSweep, getTotalSwept } from '../db/queries.js'
import { alertTrade, alertTreasurySweep, alertError } from '../telegram/bot.js'
import { getAddress } from 'viem'

const EXECUTOR_TOOLS: Tool[] = [
  {
    name: 'get_wallet_status',
    description: 'Get current trading wallet address, balance, and treasury stats.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const account = getTradingAccount()
      const { eth } = await getEthBalance(account.address)
      const totalSwept = getTotalSwept()
      return {
        tradingAddress: account.address,
        tradingBalanceEth: eth,
        treasuryTotalSweptEth: totalSwept,
        validatorProgressPct: ((totalSwept / 32) * 100).toFixed(2),
      }
    },
  },

  {
    name: 'sweep_to_treasury',
    description: 'Send a % of profit to the cold treasury wallet. Enforces all safety rules.',
    inputSchema: {
      type: 'object',
      properties: {
        amount_eth: { type: 'string', description: 'Amount of ETH to sweep (e.g. "0.1")' },
        reason: { type: 'string', description: 'Why this sweep is happening' },
      },
      required: ['amount_eth', 'reason'],
    },
    execute: async (input) => {
      const treasuryAddress = getAddress(process.env.TREASURY_ADDRESS as string) as `0x${string}`
      const floor = parseFloat(process.env.TRADING_WALLET_FLOOR_ETH ?? '0.5')
      const amount = parseFloat(input.amount_eth as string)
      const minSweep = parseFloat(process.env.TREASURY_SWEEP_MIN_ETH ?? '0.05')

      if (amount < minSweep) {
        return { error: `Sweep amount ${amount} ETH is below minimum ${minSweep} ETH. Accumulate more before sweeping.` }
      }

      const network = process.env.NETWORK ?? 'holesky'
      if (network === 'mainnet') {
        // Extra confirmation log for mainnet sweeps
        console.log(`[ExecutorAgent] MAINNET SWEEP: ${amount} ETH → ${treasuryAddress}`)
      }

      try {
        const account = getTradingAccount()
        const { eth: balanceBefore } = await getEthBalance(account.address)

        const hash = await sendEth(treasuryAddress, input.amount_eth as string, floor)

        const tradeId = insertTrade({
          tx_hash: hash,
          strategy: 'treasury_sweep',
          action: 'sweep',
          network,
          from_addr: account.address,
          to_addr: treasuryAddress,
          value_wei: String(BigInt(Math.floor(amount * 1e18))),
          status: 'confirmed',
          notes: input.reason as string,
        })

        insertSweep(hash, amount, parseFloat(balanceBefore), input.reason as string)

        const totalSwept = getTotalSwept()
        await alertTreasurySweep(amount, totalSwept)

        return { success: true, txHash: hash, amountEth: amount, totalSweptEth: totalSwept }
      } catch (err) {
        await alertError(`Sweep failed: ${String(err)}`)
        return { error: String(err) }
      }
    },
  },

  {
    name: 'send_transaction',
    description: 'Send a raw ETH transaction. Only use for approved strategy executions.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address' },
        amount_eth: { type: 'string', description: 'Amount in ETH' },
        strategy: { type: 'string', description: 'Strategy name this trade belongs to' },
        action: { type: 'string', description: 'Trade action description' },
        notes: { type: 'string', description: 'Notes about this trade' },
      },
      required: ['to', 'amount_eth', 'strategy', 'action'],
    },
    execute: async (input) => {
      const network = process.env.NETWORK ?? 'holesky'
      const floor = parseFloat(process.env.TRADING_WALLET_FLOOR_ETH ?? '0.5')
      const account = getTradingAccount()

      // Safety: never send to treasury address via this tool (use sweep_to_treasury)
      const treasuryAddress = process.env.TREASURY_ADDRESS?.toLowerCase()
      if ((input.to as string).toLowerCase() === treasuryAddress) {
        return { error: 'Use sweep_to_treasury to send to the treasury wallet.' }
      }

      const tradeId = insertTrade({
        strategy: input.strategy as string,
        action: input.action as string,
        network,
        from_addr: account.address,
        to_addr: input.to as string,
        value_wei: String(BigInt(Math.floor(parseFloat(input.amount_eth as string) * 1e18))),
        status: 'pending',
        notes: (input.notes as string) ?? null,
      })

      try {
        const hash = await sendEth(input.to as `0x${string}`, input.amount_eth as string, floor)
        updateTradeConfirmed(hash, 'confirmed')

        await alertTrade({
          strategy: input.strategy as string,
          action: input.action as string,
          amountEth: input.amount_eth as string,
          txHash: hash,
          network,
        })

        return { success: true, txHash: hash }
      } catch (err) {
        await alertError(`Trade failed [${input.strategy}]: ${String(err)}`)
        return { error: String(err) }
      }
    },
  },
]

const EXECUTOR_SYSTEM_PROMPT = `
You are the ExecutorAgent for the ETHTrainer system.

Your job: execute approved trades and treasury sweeps safely and precisely.

## Rules You MUST Follow

1. Never send to the treasury address via send_transaction — use sweep_to_treasury.
2. Never execute a strategy that isn't in 'live' status.
3. Always check wallet status before any transaction.
4. If balance is near the floor (0.5 ETH), refuse to trade and alert.
5. All transactions are logged automatically — never skip logging.
6. On mainnet: extra caution. Log everything. Transactions > 1 ETH require explicit justification.

## Treasury Sweep Schedule

- Trigger a sweep when accumulated profit exceeds the configured minimum.
- Target: 25% of net profit per cycle.
- Always check floor before sweeping.

You are not creative — you are precise. Execute exactly what the playbook says.
`.trim()

export class ExecutorAgent extends BaseAgent {
  constructor() {
    super({
      name: 'executor',
      systemPrompt: EXECUTOR_SYSTEM_PROMPT,
      tools: EXECUTOR_TOOLS,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    })
  }

  async executeSweep(profitEth: number, reason: string): Promise<string> {
    const sweepPct = parseFloat(process.env.TREASURY_SWEEP_PCT ?? '25') / 100
    const sweepAmount = (profitEth * sweepPct).toFixed(6)
    this.log('decision', `Initiating treasury sweep: ${sweepAmount} ETH`)
    return this.runOnce(`Sweep ${sweepAmount} ETH to the treasury. Reason: ${reason}`)
  }
}
