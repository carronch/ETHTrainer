import 'dotenv/config'
import { config } from './config.js'
import { getDb, closeDb } from './db/index.js'
import { loadTradingWallet } from './wallet/keystore.js'
import { checkNodeConnection, getEthBalance } from './ethereum/client.js'
import { getTradingAccount } from './wallet/keystore.js'
import { alertStartup, alertError } from './telegram/bot.js'
import { MasterAgent } from './agents/master.js'
import { logAgent } from './db/queries.js'

// ── Startup ───────────────────────────────────────────────────────────────────

async function startup(): Promise<void> {
  console.log('🚀 ETHTrainer starting...')
  console.log(`   Network: ${config.NETWORK}`)

  // Initialize database
  getDb()
  console.log('✅ Database initialized')

  // Load and decrypt trading wallet
  await loadTradingWallet(
    config.KEYSTORE_PATH,
    config.KEYCHAIN_SERVICE,
    config.KEYCHAIN_ACCOUNT,
  )
  console.log('✅ Trading wallet loaded')

  // Check Ethereum node connection
  const nodeStatus = await checkNodeConnection()
  if (!nodeStatus.connected) {
    throw new Error(`Cannot connect to Ethereum node at ${config.ETH_RPC_URL}: ${nodeStatus.error}`)
  }
  console.log(`✅ Ethereum node connected (block ${nodeStatus.blockNumber})`)

  // Get initial balance
  const account = getTradingAccount()
  const { eth } = await getEthBalance(account.address)
  console.log(`✅ Trading wallet: ${account.address}`)
  console.log(`   Balance: ${eth} ETH`)

  await alertStartup(config.NETWORK, account.address, eth)

  logAgent('master', 'info', 'ETHTrainer started', {
    network: config.NETWORK,
    address: account.address,
    balanceEth: eth,
  })
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const CYCLE_INTERVAL_MS = 60 * 60 * 1000  // Run every hour

async function main(): Promise<void> {
  await startup()

  const master = new MasterAgent(config.OBSIDIAN_VAULT_PATH)

  console.log('✅ MasterAgent initialized — starting first cycle')

  // Run immediately, then on interval
  const runCycleSafe = async () => {
    try {
      await master.runCycle()
    } catch (err) {
      const msg = `Cycle error: ${String(err)}`
      console.error(msg)
      logAgent('master', 'error', msg)
      await alertError(msg)
    }
  }

  await runCycleSafe()
  const interval = setInterval(runCycleSafe, CYCLE_INTERVAL_MS)

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n👋 ETHTrainer shutting down...')
    clearInterval(interval)
    closeDb()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
