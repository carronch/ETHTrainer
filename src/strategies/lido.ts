/**
 * Lido savings account — background ETH staking on idle capital.
 *
 * NOT a strategy. This is infrastructure:
 *   - Any ETH above the 0.5 ETH floor earns 3.8% APY automatically
 *   - stETH balance grows daily without any action
 *   - Unstake via Curve when capital is needed for a real opportunity
 *
 * Operates on Ethereum mainnet only (Lido is not on Arbitrum).
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { getTradingAccount } from '../wallet/keystore.js'
import { logAgent } from '../db/queries.js'
import { alertInfo, alertError } from '../telegram/bot.js'
import { LIDO_ABI, CURVE_STETH_POOL_ABI } from './liquidation/abi.js'
import { LIDO_CONTRACT, LIDO_CURVE_POOL, STETH_TOKEN } from './liquidation/constants.js'

const FLOOR_ETH = parseFloat(process.env.TRADING_WALLET_FLOOR_ETH ?? '0.5')
const MIN_STAKE_ETH = 0.1 // don't stake amounts smaller than this (gas efficiency)
const STETH_INDEX = 1     // Curve pool: index 0 = ETH, index 1 = stETH

function getMainnetClients(rpcUrl: string) {
  const account = getTradingAccount()
  return {
    public: createPublicClient({ chain: mainnet, transport: http(rpcUrl) }),
    wallet: createWalletClient({ chain: mainnet, transport: http(rpcUrl), account }),
    account,
  }
}

/**
 * Stake idle ETH into Lido stETH.
 * Automatically stakes everything above FLOOR_ETH (in increments >= MIN_STAKE_ETH).
 */
export async function stakeLido(rpcUrl: string): Promise<`0x${string}` | null> {
  const { public: pub, wallet, account } = getMainnetClients(rpcUrl)

  const balanceWei = await pub.getBalance({ address: account.address })
  const balanceEth = parseFloat(formatEther(balanceWei))
  const stakeAmount = balanceEth - FLOOR_ETH

  if (stakeAmount < MIN_STAKE_ETH) {
    logAgent('lido', 'info', `Nothing to stake: idle ETH ${stakeAmount.toFixed(4)} < ${MIN_STAKE_ETH} ETH floor`)
    return null
  }

  logAgent('lido', 'info', `Staking ${stakeAmount.toFixed(4)} ETH into Lido`)

  try {
    const txHash = await wallet.writeContract({
      address:      LIDO_CONTRACT,
      abi:          LIDO_ABI,
      functionName: 'submit',
      args:         ['0x0000000000000000000000000000000000000000'], // no referral
      value:        parseEther(stakeAmount.toFixed(6)),
      account,
      chain: mainnet,
    })

    await pub.waitForTransactionReceipt({ hash: txHash })

    const stEthBalance = await getStEthBalance(rpcUrl)
    await alertInfo(
      `Staked ${stakeAmount.toFixed(4)} ETH into Lido\n` +
      `stETH balance: ${parseFloat(formatEther(stEthBalance)).toFixed(4)}\n` +
      `Tx: ${txHash}`,
    )

    logAgent('lido', 'info', `Stake successful`, { txHash, amountEth: stakeAmount })
    return txHash
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await alertError(`Lido stake failed: ${msg}`)
    logAgent('lido', 'error', `Stake failed: ${msg}`)
    return null
  }
}

/** Get current stETH balance (grows daily as rewards accrue). */
export async function getStEthBalance(rpcUrl: string): Promise<bigint> {
  const { public: pub, account } = getMainnetClients(rpcUrl)
  return pub.readContract({
    address:      STETH_TOKEN,
    abi:          LIDO_ABI,
    functionName: 'balanceOf',
    args:         [account.address],
  }) as Promise<bigint>
}

/**
 * Unstake stETH → ETH via Curve pool.
 * Use when capital is needed for a liquidation or other opportunity.
 * Accepts a minimum ETH out to protect against excessive slippage.
 */
export async function unstakeLidoViaCurve(
  rpcUrl: string,
  stEthAmount: bigint,
  minEthOut: bigint,
): Promise<`0x${string}` | null> {
  const { public: pub, wallet, account } = getMainnetClients(rpcUrl)

  // Check how much ETH the pool will give us
  const expectedEth = await pub.readContract({
    address:      LIDO_CURVE_POOL,
    abi:          CURVE_STETH_POOL_ABI,
    functionName: 'get_dy',
    args:         [1n, 0n, stEthAmount], // stETH → ETH
  }) as bigint

  if (expectedEth < minEthOut) {
    logAgent('lido', 'warn', `Curve slippage too high. Expected: ${formatEther(expectedEth)}, min: ${formatEther(minEthOut)}`)
    return null
  }

  logAgent('lido', 'info', `Unstaking ${formatEther(stEthAmount)} stETH via Curve`)

  try {
    // Approve Curve pool to spend stETH
    const approveTx = await wallet.writeContract({
      address:      STETH_TOKEN,
      abi:          [{ name: 'approve', type: 'function', stateMutability: 'nonpayable',
                       inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
                       outputs: [{ name: '', type: 'bool' }] }] as const,
      functionName: 'approve',
      args:         [LIDO_CURVE_POOL, stEthAmount],
      account,
      chain: mainnet,
    })
    await pub.waitForTransactionReceipt({ hash: approveTx })

    // Swap stETH → ETH
    const swapTx = await wallet.writeContract({
      address:      LIDO_CURVE_POOL,
      abi:          CURVE_STETH_POOL_ABI,
      functionName: 'exchange',
      args:         [1n, 0n, stEthAmount, minEthOut],
      account,
      chain: mainnet,
    })
    await pub.waitForTransactionReceipt({ hash: swapTx })

    logAgent('lido', 'info', `Unstake successful`, {
      swapTx,
      stEthAmount: formatEther(stEthAmount),
    })

    return swapTx
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await alertError(`Lido unstake failed: ${msg}`)
    logAgent('lido', 'error', `Unstake failed: ${msg}`)
    return null
  }
}

/**
 * Status report for RiskManagerAgent daily check.
 */
export async function getLidoStatus(rpcUrl: string): Promise<{
  stEthBalanceEth: number
  estimatedApy: number
}> {
  const balance = await getStEthBalance(rpcUrl)
  return {
    stEthBalanceEth: parseFloat(formatEther(balance)),
    estimatedApy:    3.8, // current Lido APY — update periodically from on-chain
  }
}
