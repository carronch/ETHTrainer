import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv({ path: '.dev.vars' })

const ConfigSchema = z.object({
  // AI (autoresearch loop only — not in the hot path)
  ANTHROPIC_API_KEY: z.string().min(1),

  // Ethereum mainnet (for treasury sweeps, optional until needed)
  ETH_RPC_URL: z.string().url().optional(),
  NETWORK: z.enum(['holesky', 'mainnet', 'arbitrum']).default('arbitrum'),

  // Arbitrum — primary chain for the liquidation bot
  ARBITRUM_RPC_URL: z.string().url(),
  ARBITRUM_RPC_URL_WS: z.string().optional(),  // WebSocket for live event subscriptions

  // Wallet — ethers encrypted JSON keystore
  // Hetzner: KEYSTORE_PASSWORD in .dev.vars (chmod 600, outside repo)
  KEYSTORE_PATH: z.string().default('~/.ethtrainer/keystore.json'),
  KEYSTORE_PASSWORD: z.string().min(1),

  // Treasury
  TREASURY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid treasury address'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Deployed contracts
  LIQUIDATION_BOT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),

  // Treasury sweep rules
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
