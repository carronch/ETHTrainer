import { Telegraf } from 'telegraf'

let _bot: Telegraf | null = null

function getBot(): Telegraf {
  if (_bot) return _bot
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')
  _bot = new Telegraf(token)
  return _bot
}

function getChatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID
  if (!id) throw new Error('TELEGRAM_CHAT_ID not set')
  return id
}

async function send(message: string): Promise<void> {
  try {
    await getBot().telegram.sendMessage(getChatId(), message, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[Telegram] Failed to send alert:', err)
  }
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

export async function alertInfo(message: string): Promise<void> {
  await send(`ℹ️ *ETHTrainer*\n${message}`)
}

export async function alertSuccess(message: string): Promise<void> {
  await send(`✅ *ETHTrainer*\n${message}`)
}

export async function alertWarning(message: string): Promise<void> {
  await send(`⚠️ *ETHTrainer*\n${message}`)
}

export async function alertError(message: string): Promise<void> {
  await send(`🚨 *ETHTrainer ERROR*\n${message}`)
}

export async function alertTrade(opts: {
  strategy: string
  action: string
  amountEth: string
  txHash: string
  profitEth?: number
  network: string
}): Promise<void> {
  const profit = opts.profitEth !== undefined
    ? `\nProfit: *${opts.profitEth >= 0 ? '+' : ''}${opts.profitEth.toFixed(6)} ETH*`
    : ''
  await send(
    `📊 *Trade Executed*\n` +
    `Strategy: ${opts.strategy}\n` +
    `Action: ${opts.action}\n` +
    `Amount: ${opts.amountEth} ETH\n` +
    `Network: ${opts.network}${profit}\n` +
    `Tx: \`${opts.txHash}\``
  )
}

export async function alertTreasurySweep(amountEth: number, totalEth: number): Promise<void> {
  const pct = ((totalEth / 32) * 100).toFixed(1)
  await send(
    `💰 *Treasury Sweep*\n` +
    `Swept: *+${amountEth.toFixed(6)} ETH*\n` +
    `Treasury total: *${totalEth.toFixed(4)} ETH*\n` +
    `Validator progress: *${pct}%* of 32 ETH`
  )
}

export async function alertStartup(network: string, address: string, balanceEth: string): Promise<void> {
  await send(
    `🚀 *ETHTrainer Started*\n` +
    `Network: ${network}\n` +
    `Trading wallet: \`${address}\`\n` +
    `Balance: ${balanceEth} ETH`
  )
}
