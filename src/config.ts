import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv({ path: '.dev.vars' })

const ConfigSchema = z.object({
  // AI
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),

  // Ethereum
  ETH_RPC_URL: z.string().url(),
  ETH_RPC_URL_WS: z.string().optional(),
  NETWORK: z.enum(['holesky', 'mainnet']).default('holesky'),

  // Wallet
  KEYSTORE_PATH: z.string().min(1),
  KEYCHAIN_SERVICE: z.string().default('ETHTrainer'),
  KEYCHAIN_ACCOUNT: z.string().default('trading_wallet'),

  // Treasury
  TREASURY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid treasury address'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Arbitrum (for liquidation bot)
  ARBITRUM_RPC_URL: z.string().url().optional(),

  // Deployed contracts
  LIQUIDATION_BOT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),

  // Agent config
  OBSIDIAN_VAULT_PATH: z.string().optional(),
  TRADING_WALLET_FLOOR_ETH: z.coerce.number().default(0.5),
  TREASURY_SWEEP_PCT: z.coerce.number().default(25),
  TREASURY_SWEEP_MIN_ETH: z.coerce.number().default(0.05),
})

export type Config = z.infer<typeof ConfigSchema>

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Config validation failed:\n${missing.join('\n')}\n\nCopy .dev.vars.example to .dev.vars and fill in your values.`)
  }
  return result.data
}

export const config = loadConfig()
