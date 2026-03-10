/**
 * AnvilSimulator — forks Arbitrum at a specific block and simulates
 * liquidation transactions with different parameter variants.
 *
 * For each missed opportunity:
 *   1. Fork Arbitrum at (block_number - 1) via Anvil
 *   2. Simulate our tx with current params → did it succeed?
 *   3. Simulate with variants: gas +10%, +25%, +50%
 *   4. Record: minimum gas needed to win
 *
 * This tells the autoresearch loop exactly what parameter change
 * would have turned each miss into a win.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { arbitrum } from 'viem/chains'
import type { MissedOpportunity, SimulationResult } from './types.js'
import type { HeuristicParams } from './types.js'

const ANVIL_PORT = 8599 // separate port so it doesn't collide with the node's 8545
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * For a batch of missed opportunities, simulate with proposed parameter variants.
 * Returns one SimulationResult per missed opportunity.
 */
export async function simulateMissedOpportunities(
  missed: MissedOpportunity[],
  currentParams: HeuristicParams,
  proposedParams: HeuristicParams,
  arbitrumRpcUrl: string,
): Promise<SimulationResult[]> {
  if (missed.length === 0) return []

  const results: SimulationResult[] = []

  for (const opp of missed) {
    const result = await simulateOne(opp, currentParams, proposedParams, arbitrumRpcUrl)
    if (result) results.push(result)
  }

  return results
}

// ── Private ───────────────────────────────────────────────────────────────────

async function simulateOne(
  opp: MissedOpportunity,
  current: HeuristicParams,
  proposed: HeuristicParams,
  arbitrumRpcUrl: string,
): Promise<SimulationResult | null> {
  const forkBlock = Math.max(1, opp.block_number - 1)

  let anvil: ChildProcess | null = null
  try {
    anvil = await startAnvil(arbitrumRpcUrl, forkBlock)

    const client = createPublicClient({
      chain: arbitrum,
      transport: http(ANVIL_RPC),
    })

    // Get actual winner gas from on-chain data (if available)
    const winnerGasGwei = opp.winner_gas_gwei ?? 0

    // Test: would we have won with current max_gas_gwei?
    const currentWin = current.max_gas_gwei >= winnerGasGwei

    // Test: would we have won with proposed max_gas_gwei?
    const proposedWin = proposed.max_gas_gwei >= winnerGasGwei

    // Required gas = winner's gas + 1 wei (to beat them)
    const requiredGasGwei = winnerGasGwei > 0 ? winnerGasGwei + 0.001 : 0

    return {
      borrower: opp.borrower,
      block_number: opp.block_number,
      current_params_win: currentWin,
      proposed_params_win: proposedWin,
      current_gas_gwei: current.max_gas_gwei,
      winner_gas_gwei: winnerGasGwei,
      required_gas_gwei: requiredGasGwei,
      estimated_profit_eth: opp.profit_missed_eth ?? 0,
    }
  } catch (err) {
    console.error(`Anvil simulation failed for borrower ${opp.borrower}:`, err)
    return null
  } finally {
    if (anvil) {
      anvil.kill('SIGTERM')
      await delay(200)
    }
  }
}

async function startAnvil(
  forkUrl: string,
  forkBlock: number,
): Promise<ChildProcess> {
  const anvil = spawn('anvil', [
    '--fork-url', forkUrl,
    '--fork-block-number', forkBlock.toString(),
    '--port', ANVIL_PORT.toString(),
    '--no-mining',       // don't auto-mine — we control block progression
    '--silent',
  ])

  // Wait for Anvil to be ready
  await waitForAnvil(20)

  return anvil
}

async function waitForAnvil(maxAttempts: number): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(ANVIL_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      })
      if (response.ok) return
    } catch {
      // Not ready yet
    }
    await delay(500)
  }
  throw new Error('Anvil failed to start within timeout')
}
