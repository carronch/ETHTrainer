/**
 * Deploy LiquidationBot to Base.
 *
 * Usage:
 *   npm run deploy:base
 *
 * Prerequisites:
 *   1. npm run compile           — compile the Solidity contract
 *   2. Fill in .dev.vars         — BASE_RPC_URL + wallet credentials
 *   3. Trading wallet needs ETH on Base for gas
 *
 * After deployment: set LIQUIDATION_BOT_ADDRESS_BASE=0x... in .dev.vars
 */
import { createPublicClient, createWalletClient, http, getAddress } from 'viem'
import { base } from 'viem/chains'
import { config as loadDotenv } from 'dotenv'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadTradingWallet, getTradingAccount } from '../src/wallet/keystore.js'

loadDotenv({ path: '.dev.vars' })

const AAVE_POOL_BASE = getAddress('0xA238Dd80C259a72e81d7e4664032E3C44F59Babb')
const UNISWAP_ROUTER_BASE = getAddress('0x2626664c2603336E57B271c5C0b26F421741e481')

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL
  if (!rpcUrl) {
    throw new Error('BASE_RPC_URL not set in .dev.vars')
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

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ chain: base, transport: http(rpcUrl), account })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Deployer: ${account.address}`)
  console.log(`Balance on Base: ${(Number(balance) / 1e18).toFixed(6)} ETH`)

  if (balance < 500_000n * 400_000n) { // rough gas estimate
    console.warn('⚠️  Low ETH balance on Base — may not cover deployment gas')
  }

  console.log('\nDeploying LiquidationBot to Base...')

  const hash = await walletClient.deployContract({
    abi:      artifact.abi,
    bytecode: artifact.bytecode,
    args:     [AAVE_POOL_BASE, UNISWAP_ROUTER_BASE],
    account,
    chain: base,
  })

  console.log(`Deploy tx: ${hash}`)
  console.log('Waiting for confirmation...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error('Deployment failed — no contract address in receipt')
  }

  const contractAddress = getAddress(receipt.contractAddress)
  console.log(`\n✅ LiquidationBot deployed at: ${contractAddress}`)
  console.log(`\nAdd to .dev.vars:\n  LIQUIDATION_BOT_ADDRESS_BASE=${contractAddress}`)

  // Optionally update .dev.vars automatically
  try {
    let devVars = readFileSync('.dev.vars', 'utf8')
    if (devVars.includes('LIQUIDATION_BOT_ADDRESS_BASE=')) {
      devVars = devVars.replace(/LIQUIDATION_BOT_ADDRESS_BASE=.*/, `LIQUIDATION_BOT_ADDRESS_BASE=${contractAddress}`)
    } else {
      devVars += `\nLIQUIDATION_BOT_ADDRESS_BASE=${contractAddress}\n`
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
