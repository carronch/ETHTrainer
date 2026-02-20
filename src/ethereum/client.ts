import { createPublicClient, createWalletClient, http, webSocket, formatEther, parseEther } from 'viem'
import { holesky, mainnet } from 'viem/chains'
import { getTradingAccount } from '../wallet/keystore.js'

// ── Chain config ──────────────────────────────────────────────────────────────

export function getChain(network: string) {
  if (network === 'mainnet') return mainnet
  return holesky  // default to testnet
}

// ── Public client (read-only) ─────────────────────────────────────────────────

let _publicClient: ReturnType<typeof createPublicClient> | null = null

export function getPublicClient() {
  if (_publicClient) return _publicClient

  const network = process.env.NETWORK ?? 'holesky'
  const rpcUrl = process.env.ETH_RPC_URL ?? 'http://localhost:8545'

  _publicClient = createPublicClient({
    chain: getChain(network),
    transport: http(rpcUrl),
  })

  return _publicClient
}

// ── Wallet client (signing) ───────────────────────────────────────────────────

let _walletClient: ReturnType<typeof createWalletClient> | null = null

export function getWalletClient() {
  if (_walletClient) return _walletClient

  const network = process.env.NETWORK ?? 'holesky'
  const rpcUrl = process.env.ETH_RPC_URL ?? 'http://localhost:8545'
  const account = getTradingAccount()

  _walletClient = createWalletClient({
    chain: getChain(network),
    transport: http(rpcUrl),
    account,
  })

  return _walletClient
}

// ── Utility functions ─────────────────────────────────────────────────────────

export async function getEthBalance(address: `0x${string}`): Promise<{ wei: bigint; eth: string }> {
  const client = getPublicClient()
  const wei = await client.getBalance({ address })
  return { wei, eth: formatEther(wei) }
}

export async function getBlockNumber(): Promise<bigint> {
  const client = getPublicClient()
  return client.getBlockNumber()
}

export async function estimateGas(to: `0x${string}`, value: bigint): Promise<bigint> {
  const client = getPublicClient()
  const account = getTradingAccount()
  return client.estimateGas({ account: account.address, to, value })
}

export async function getGasPrice(): Promise<bigint> {
  const client = getPublicClient()
  return client.getGasPrice()
}

/**
 * Send ETH from the trading wallet to an address.
 * Logs the tx and returns the hash.
 * Will throw if the trading wallet balance would drop below the floor.
 */
export async function sendEth(
  to: `0x${string}`,
  amountEth: string,
  floorEth: number,
): Promise<`0x${string}`> {
  const walletClient = getWalletClient()
  const account = getTradingAccount()
  const publicClient = getPublicClient()

  const { eth: currentBalanceEth } = await getEthBalance(account.address)
  const currentBalance = parseFloat(currentBalanceEth)
  const amount = parseFloat(amountEth)

  if (currentBalance - amount < floorEth) {
    throw new Error(
      `Refusing to send ${amountEth} ETH — would drop below floor of ${floorEth} ETH. ` +
      `Current balance: ${currentBalanceEth} ETH`,
    )
  }

  // MAINNET SAFETY: require explicit override for large transfers
  const network = process.env.NETWORK ?? 'holesky'
  if (network === 'mainnet' && amount > 1) {
    throw new Error(
      `MAINNET: Transfers over 1 ETH require manual confirmation. ` +
      `Attempted: ${amountEth} ETH to ${to}`,
    )
  }

  const hash = await walletClient.sendTransaction({
    to,
    value: parseEther(amountEth),
    account,
    chain: getChain(network),
  })

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash })

  return hash
}

export async function checkNodeConnection(): Promise<{ connected: boolean; blockNumber?: bigint; error?: string }> {
  try {
    const blockNumber = await getBlockNumber()
    return { connected: true, blockNumber }
  } catch (err) {
    return { connected: false, error: String(err) }
  }
}
