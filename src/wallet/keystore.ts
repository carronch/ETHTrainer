import { Wallet } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PrivateKeyAccount } from 'viem'
import { getKeychainPassword } from './keychain.js'

let _account: PrivateKeyAccount | null = null

/**
 * Load the encrypted JSON keystore from disk, decrypt it using the password
 * stored in macOS Keychain, and return a viem PrivateKeyAccount.
 *
 * The keystore is kept outside the repo (e.g. ~/.ethtrainer/keystore.json).
 * The password is stored in macOS Keychain — never in any file or env var.
 */
export async function loadTradingWallet(
  keystorePath: string,
  keychainService: string,
  keychainAccount: string,
): Promise<PrivateKeyAccount> {
  if (_account) return _account

  if (!existsSync(keystorePath)) {
    throw new Error(
      `Keystore not found at: ${keystorePath}\n` +
      `Run: npm run setup-wallet  to create it.`,
    )
  }

  const keystoreJson = readFileSync(keystorePath, 'utf8')
  const password = getKeychainPassword(keychainService, keychainAccount)

  console.log('🔓 Decrypting keystore...')
  const ethersWallet = await Wallet.fromEncryptedJson(keystoreJson, password)
  console.log('✅ Wallet unlocked:', ethersWallet.address)

  _account = privateKeyToAccount(ethersWallet.privateKey as `0x${string}`)
  return _account
}

/**
 * Create and save a new encrypted keystore from a private key.
 * Used by the setup-wallet script.
 */
export async function createKeystore(
  privateKey: string,
  password: string,
  keystorePath: string,
): Promise<string> {
  const wallet = new Wallet(privateKey)
  console.log('🔐 Encrypting keystore (this may take a moment)...')
  const encrypted = await wallet.encrypt(password)

  const dir = dirname(keystorePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(keystorePath, encrypted, { mode: 0o600 })
  console.log(`✅ Keystore saved to: ${keystorePath}`)
  console.log(`   Address: ${wallet.address}`)
  return wallet.address
}

export function getTradingAccount(): PrivateKeyAccount {
  if (!_account) throw new Error('Trading wallet not loaded. Call loadTradingWallet() first.')
  return _account
}
