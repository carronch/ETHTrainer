/**
 * Interactive wallet setup script.
 * Run once to create the encrypted keystore and store the password in macOS Keychain.
 *
 * Usage: npm run setup-wallet
 */

import 'dotenv/config'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { createKeystore } from '../src/wallet/keystore.js'
import { setKeychainPassword, getKeychainPassword } from '../src/wallet/keychain.js'

const rl = createInterface({ input: process.stdin, output: process.stdout })

function prompt(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

async function main() {
  console.log('\n=== ETHTrainer Wallet Setup ===\n')

  const keystorePath = process.env.KEYSTORE_PATH
  const keychainService = process.env.KEYCHAIN_SERVICE ?? 'ETHTrainer'
  const keychainAccount = process.env.KEYCHAIN_ACCOUNT ?? 'trading_wallet'

  if (!keystorePath) {
    console.error('KEYSTORE_PATH is not set in .dev.vars')
    process.exit(1)
  }

  if (existsSync(keystorePath)) {
    const overwrite = await prompt(`Keystore already exists at ${keystorePath}. Overwrite? (yes/no): `)
    if (overwrite.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.')
      rl.close()
      return
    }
  }

  console.log('⚠️  Your private key is used ONLY to encrypt the keystore locally.')
  console.log('   It is never stored or transmitted.\n')

  const privateKey = await prompt('Enter your trading wallet private key (0x...): ')
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error('Invalid private key format. Must be 0x followed by 64 hex characters.')
    process.exit(1)
  }

  const password = await prompt('Enter a strong password for the keystore: ')
  if (password.length < 12) {
    console.error('Password too short. Use at least 12 characters.')
    process.exit(1)
  }

  const confirm = await prompt('Confirm password: ')
  if (password !== confirm) {
    console.error('Passwords do not match.')
    process.exit(1)
  }

  // Create encrypted keystore
  const address = await createKeystore(privateKey, password, keystorePath)

  // Store password in macOS Keychain
  console.log('\n🔑 Storing password in macOS Keychain...')
  setKeychainPassword(keychainService, keychainAccount, password)
  console.log(`✅ Password stored in Keychain (service: ${keychainService}, account: ${keychainAccount})`)

  // Verify we can retrieve it
  const retrieved = getKeychainPassword(keychainService, keychainAccount)
  if (retrieved !== password) {
    console.error('❌ Keychain verification failed — password mismatch')
    process.exit(1)
  }

  console.log('\n✅ Setup complete!')
  console.log(`   Trading wallet: ${address}`)
  console.log(`   Keystore: ${keystorePath}`)
  console.log(`   Password: macOS Keychain (${keychainService}/${keychainAccount})`)
  console.log('\n   Fund this address with testnet ETH from a Holesky faucet.')
  console.log('   Then update TREASURY_ADDRESS in .dev.vars with your cold wallet address.\n')

  rl.close()
}

main().catch(err => {
  console.error('Setup failed:', err)
  process.exit(1)
})
