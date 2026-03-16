/**
 * Deploy LiquidationBot to Arbitrum, Base, or Optimism.
 *
 * Usage:
 *   npm run deploy:liquidation                    # deploys to arbitrum (default)
 *   NETWORK=optimism npm run deploy:liquidation   # deploys to optimism
 *   NETWORK=base     npm run deploy:liquidation   # deploys to base
 *
 * Prerequisites:
 *   1. npm run compile               — compile the Solidity contract
 *   2. Fill in .dev.vars             — <CHAIN>_RPC_URL + wallet credentials
 *   3. Trading wallet needs ETH on the target chain for gas
 *
 * After deployment: the script auto-updates .dev.vars with the contract address.
 */
import { createPublicClient, createWalletClient, http, getAddress } from 'viem'
import { arbitrum, optimism, base } from 'viem/chains'
import { config as loadDotenv } from 'dotenv'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadTradingWallet, getTradingAccount } from '../src/wallet/keystore.js'

loadDotenv({ path: '.dev.vars' })

// Aave v3 Pool and Uniswap SwapRouter02 share the same addresses on all three chains.
const AAVE_POOL    = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
const UNISWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

const CHAIN_CONFIGS = {
  arbitrum: {
    chain:       arbitrum,
    rpcEnvKey:   'ARBITRUM_RPC_URL',
    addressEnvKey: 'LIQUIDATION_BOT_ADDRESS',
  },
  optimism: {
    chain:       optimism,
    rpcEnvKey:   'OPTIMISM_RPC_URL',
    addressEnvKey: 'LIQUIDATION_BOT_ADDRESS_OPTIMISM',
  },
  base: {
    chain:       base,
    rpcEnvKey:   'BASE_RPC_URL',
    addressEnvKey: 'LIQUIDATION_BOT_ADDRESS_BASE',
  },
} as const

type SupportedNetwork = keyof typeof CHAIN_CONFIGS

async function main() {
  const network = (process.env['NETWORK'] ?? 'arbitrum') as SupportedNetwork
  const chainConfig = CHAIN_CONFIGS[network]
  if (!chainConfig) {
    throw new Error(`Unsupported NETWORK="${network}". Supported: arbitrum, optimism, base`)
  }

  const rpcUrl = process.env[chainConfig.rpcEnvKey]
  if (!rpcUrl) {
    throw new Error(`${chainConfig.rpcEnvKey} not set in .dev.vars`)
  }

  // Load compiled bytecode from hardhat artifacts
  const artifactPath = join(process.cwd(), 'artifacts/contracts/LiquidationBot.sol/LiquidationBot.json')
  let artifact: { abi: unknown[]; bytecode: `0x${string}` }
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  } catch {
    throw new Error(`Artifact not found at ${artifactPath}. Run 'npm run compile' first.`)
  }

  const keystorePath = (process.env['KEYSTORE_PATH'] ?? `${process.env['HOME']}/.ethtrainer/keystore.json`)
  await loadTradingWallet(keystorePath, 'ethtrainer', 'trading-wallet')
  const account = getTradingAccount()

  const { chain } = chainConfig
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Network:  ${network} (chain ID ${chain.id})`)
  console.log(`Deployer: ${account.address}`)
  console.log(`Balance:  ${(Number(balance) / 1e18).toFixed(6)} ETH`)

  if (balance < 500_000n * 400_000n) {
    console.warn('⚠️  Low ETH balance — may not cover deployment gas')
  }

  console.log('\nDeploying LiquidationBot...')

  const hash = await walletClient.deployContract({
    abi:      artifact.abi,
    bytecode: artifact.bytecode,
    args:     [AAVE_POOL, UNISWAP_ROUTER],
    account,
    chain,
  })

  console.log(`Deploy tx: ${hash}`)
  console.log('Waiting for confirmation...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error('Deployment failed — no contract address in receipt')
  }

  const contractAddress = getAddress(receipt.contractAddress)
  console.log(`\n✅ LiquidationBot deployed at: ${contractAddress}`)
  console.log(`\nAdd to .dev.vars:\n  ${chainConfig.addressEnvKey}=${contractAddress}`)

  // Auto-update .dev.vars
  try {
    let devVars = readFileSync('.dev.vars', 'utf8')
    const key = chainConfig.addressEnvKey
    if (devVars.includes(`${key}=`)) {
      devVars = devVars.replace(new RegExp(`${key}=.*`), `${key}=${contractAddress}`)
    } else {
      devVars += `\n${key}=${contractAddress}\n`
    }
    writeFileSync('.dev.vars', devVars)
    console.log('✅ .dev.vars updated automatically')
  } catch {
    console.log('Could not auto-update .dev.vars — update manually.')
  }
}

main().catch((err) => {
  console.error('Deploy failed:', err.message)
  process.exit(1)
})
