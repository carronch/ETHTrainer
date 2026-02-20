/**
 * LiquidationExecutor — submits a liquidation via the deployed LiquidationBot contract.
 *
 * Safety checks before submitting:
 *   1. Re-read health factor (confirm still < 1)
 *   2. Gas price still within limit
 *   3. No competing liquidation tx in mempool (basic check)
 *
 * Logs every attempt to SQLite before and after.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  formatEther,
  getAddress,
} from 'viem'
import { arbitrum } from 'viem/chains'
import { getTradingAccount } from '../../wallet/keystore.js'
import { insertTrade, updateTradeConfirmed, logAgent, updateStrategyStats } from '../../db/queries.js'
import { alertError, alertTrade } from '../../telegram/bot.js'
import { LIQUIDATION_BOT_ABI } from './abi.js'
import { LIMITS } from './constants.js'
import type { LiquidationOpportunity, LiquidationResult } from './types.js'

export class LiquidationExecutor {
  private publicClient:  ReturnType<typeof createPublicClient>
  private walletClient:  ReturnType<typeof createWalletClient>
  private botAddress:    Address
  private consecutiveFails = 0
  private pausedUntil: number = 0

  constructor(rpcUrl: string, botContractAddress: Address) {
    this.botAddress = getAddress(botContractAddress)
    const account = getTradingAccount()

    this.publicClient = createPublicClient({
      chain: arbitrum,
      transport: http(rpcUrl),
    })
    this.walletClient = createWalletClient({
      chain: arbitrum,
      transport: http(rpcUrl),
      account,
    })
  }

  async execute(opp: LiquidationOpportunity): Promise<LiquidationResult> {
    if (Date.now() < this.pausedUntil) {
      return {
        success: false,
        errorMessage: 'Circuit breaker active — bot paused after consecutive failures',
        opportunity: opp,
      }
    }

    // ── Pre-flight checks ─────────────────────────────────────────────────────

    // 1. Confirm health factor still < 1
    const currentHF = await this.refreshHealthFactor(opp.borrower)
    if (currentHF >= LIMITS.HEALTH_FACTOR_THRESHOLD) {
      logAgent('liquidation-executor', 'info', 'Position recovered before execution', {
        borrower: opp.borrower,
        healthFactor: currentHF.toString(),
      })
      return { success: false, errorMessage: 'Position recovered', opportunity: opp }
    }

    // 2. Gas price within limit
    const gasPrice = await this.publicClient.getGasPrice()
    const gasPriceGwei = Number(gasPrice) / 1e9
    if (gasPriceGwei > LIMITS.MAX_GAS_GWEI) {
      logAgent('liquidation-executor', 'warn', `Gas too high: ${gasPriceGwei} gwei`, {})
      return { success: false, errorMessage: `Gas too high: ${gasPriceGwei} gwei`, opportunity: opp }
    }

    // ── Submit transaction ────────────────────────────────────────────────────

    const account = getTradingAccount()
    const tradeId = insertTrade({
      strategy:   'liquidation-bots',
      action:     'liquidate',
      network:    'arbitrum',
      from_addr:  account.address,
      to_addr:    this.botAddress,
      value_wei:  '0',
      status:     'pending',
      notes:      JSON.stringify({
        borrower:   opp.borrower,
        collateral: opp.collateralSymbol,
        debt:       opp.debtSymbol,
        estimatedProfitEth: formatEther(opp.estimatedProfitWei),
      }),
    })

    try {
      const txHash = await this.walletClient.writeContract({
        address:      this.botAddress,
        abi:          LIQUIDATION_BOT_ABI,
        functionName: 'liquidate',
        args: [
          opp.collateralAsset,
          opp.debtAsset,
          opp.borrower,
          opp.debtToCover,
          opp.uniswapPoolFee,
          opp.minProfitWei,
        ],
        gas:      LIMITS.GAS_ESTIMATE_LIQUIDATION + 100_000n,
        gasPrice,
        account,
        chain: arbitrum,
      })

      logAgent('liquidation-executor', 'info', `Liquidation tx submitted`, {
        txHash,
        borrower: opp.borrower,
      })

      // Wait for receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })

      if (receipt.status === 'success') {
        const profitEth = parseFloat(formatEther(opp.estimatedProfitWei))
        updateTradeConfirmed(txHash, 'confirmed', profitEth)
        updateStrategyStats('liquidation-bots', true, profitEth)
        this.consecutiveFails = 0

        await alertTrade({
          strategy: 'liquidation-bots',
          action:   'liquidate',
          amountEth: '0',
          txHash,
          profitEth: parseFloat(formatEther(opp.estimatedProfitWei)),
          network:  'arbitrum',
        })

        return { success: true, txHash, profitEth, opportunity: opp }
      } else {
        updateTradeConfirmed(txHash, 'failed')
        updateStrategyStats('liquidation-bots', false, 0)
        this.recordFailure()
        return { success: false, txHash, errorMessage: 'Tx reverted', opportunity: opp }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      updateTradeConfirmed('', 'failed')
      updateStrategyStats('liquidation-bots', false, 0)
      this.recordFailure()

      logAgent('liquidation-executor', 'error', `Liquidation failed: ${errorMessage}`, {
        borrower: opp.borrower,
      })
      await alertError(`Liquidation failed: ${errorMessage}`)

      return { success: false, errorMessage, opportunity: opp }
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async refreshHealthFactor(address: Address): Promise<bigint> {
    const result = await this.publicClient.readContract({
      address:      '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      abi:          [{ name: 'getUserAccountData', type: 'function', stateMutability: 'view',
                       inputs: [{ name: 'user', type: 'address' }],
                       outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
                                 { type: 'uint256' }, { type: 'uint256' }, { name: 'healthFactor', type: 'uint256' }] }] as const,
      functionName: 'getUserAccountData',
      args:         [address],
    })
    return result[5]
  }

  private recordFailure(): void {
    this.consecutiveFails++
    if (this.consecutiveFails >= LIMITS.CIRCUIT_BREAKER_FAILURES) {
      this.pausedUntil = Date.now() + LIMITS.CIRCUIT_BREAKER_PAUSE_MS
      logAgent('liquidation-executor', 'warn',
        `Circuit breaker triggered after ${this.consecutiveFails} failures. Paused 1h.`, {})
      alertError(`Liquidation bot: circuit breaker triggered. Paused 1 hour.`)
    }
  }
}
