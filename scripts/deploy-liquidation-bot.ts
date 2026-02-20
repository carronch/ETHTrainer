/**
 * Deploy LiquidationBot to Arbitrum.
 *
 * Usage:
 *   npm run deploy:liquidation
 *
 * Prerequisites:
 *   1. npm run compile           — compile the Solidity contract
 *   2. Fill in .dev.vars         — ARBITRUM_RPC_URL + wallet credentials
 *   3. Trading wallet needs ETH on Arbitrum for gas
 *
 * After deployment: set LIQUIDATION_BOT_ADDRESS=0x... in .dev.vars
 */
import { createPublicClient, createWalletClient, http, getAddress } from 'viem'
import { arbitrum } from 'viem/chains'
import { config as loadDotenv } from 'dotenv'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getTradingAccount } from '../src/wallet/keystore.js'

loadDotenv({ path: '.dev.vars' })

const AAVE_POOL_ARBITRUM    = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
const UNISWAP_ROUTER_ARBITRUM = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

async function main() {
  const rpcUrl = process.env.ARBITRUM_RPC_URL
  if (!rpcUrl) {
    throw new Error('ARBITRUM_RPC_URL not set in .dev.vars')
  }

  // Load compiled bytecode from hardhat artifacts
  const artifactPath = join(process.cwd(), 'artifacts/contracts/LiquidationBot.sol/LiquidationBot.json')
  let artifact: { abi: unknown[]; bytecode: `0x${string}` }
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  } catch {
    throw new Error(`Artifact not found at ${artifactPath}. Run 'npm run compile' first.`)
  }

  const account = getTradingAccount()

  const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ chain: arbitrum, transport: http(rpcUrl), account })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Deployer: ${account.address}`)
  console.log(`Balance on Arbitrum: ${(Number(balance) / 1e18).toFixed(6)} ETH`)

  if (balance < 500_000n * 400_000n) { // rough gas estimate
    console.warn('⚠️  Low ETH balance on Arbitrum — may not cover deployment gas')
  }

  console.log('\nDeploying LiquidationBot...')

  const hash = await walletClient.deployContract({
    abi:      artifact.abi,
    bytecode: artifact.bytecode,
    args:     [AAVE_POOL_ARBITRUM, UNISWAP_ROUTER_ARBITRUM],
    account,
    chain: arbitrum,
  })

  console.log(`Deploy tx: ${hash}`)
  console.log('Waiting for confirmation...')

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  if (!receipt.contractAddress) {
    throw new Error('Deployment failed — no contract address in receipt')
  }

  const contractAddress = getAddress(receipt.contractAddress)
  console.log(`\n✅ LiquidationBot deployed at: ${contractAddress}`)
  console.log(`\nAdd to .dev.vars:\n  LIQUIDATION_BOT_ADDRESS=${contractAddress}`)

  // Optionally update .dev.vars automatically
  try {
    let devVars = readFileSync('.dev.vars', 'utf8')
    if (devVars.includes('LIQUIDATION_BOT_ADDRESS=')) {
      devVars = devVars.replace(/LIQUIDATION_BOT_ADDRESS=.*/, `LIQUIDATION_BOT_ADDRESS=${contractAddress}`)
    } else {
      devVars += `\nLIQUIDATION_BOT_ADDRESS=${contractAddress}\n`
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
