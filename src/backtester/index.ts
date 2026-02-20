import { getPublicClient } from '../ethereum/client.js'
import { insertBacktestResult, type BacktestResult } from '../db/queries.js'

export interface Trade {
  timestamp: number
  action: 'buy' | 'sell' | 'bet' | 'arb'
  profitEth: number
  gasEth: number
  netProfitEth: number
}

export interface BacktestConfig {
  strategyName: string
  fromBlock: bigint
  toBlock: bigint
  simulate: (blockNumber: bigint) => Promise<Trade | null>
}

export interface BacktestSummary {
  totalTrades: number
  winningTrades: number
  winRate: number
  avgProfitEth: number
  totalProfitEth: number
  maxDrawdownEth: number
  sharpeRatio: number
  trades: Trade[]
}

/**
 * Run a backtest for a strategy over a block range.
 * The `simulate` function is called for each block and returns a trade if one would have occurred.
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestSummary> {
  const client = getPublicClient()
  const trades: Trade[] = []

  const fromBlock = config.fromBlock
  const toBlock = config.toBlock

  console.log(`[Backtester] Running ${config.strategyName} from block ${fromBlock} to ${toBlock}`)

  // Sample blocks — for large ranges, sample every Nth block to reduce RPC calls
  const range = Number(toBlock - fromBlock)
  const step = Math.max(1, Math.floor(range / 1000))  // max 1000 samples

  for (let b = Number(fromBlock); b <= Number(toBlock); b += step) {
    const trade = await config.simulate(BigInt(b))
    if (trade) trades.push(trade)
  }

  return summarize(config.strategyName, trades, fromBlock, toBlock)
}

function summarize(
  strategyName: string,
  trades: Trade[],
  fromBlock: bigint,
  toBlock: bigint,
): BacktestSummary {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winningTrades: 0, winRate: 0,
      avgProfitEth: 0, totalProfitEth: 0, maxDrawdownEth: 0, sharpeRatio: 0,
      trades: [],
    }
  }

  const profits = trades.map(t => t.netProfitEth)
  const totalProfit = profits.reduce((a, b) => a + b, 0)
  const winning = profits.filter(p => p > 0).length
  const avgProfit = totalProfit / trades.length

  // Max drawdown
  let peak = 0
  let maxDrawdown = 0
  let running = 0
  for (const p of profits) {
    running += p
    if (running > peak) peak = running
    const drawdown = peak - running
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }

  // Sharpe ratio (simplified — assumes 0 risk-free rate)
  const mean = avgProfit
  const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length
  const stdDev = Math.sqrt(variance)
  const sharpe = stdDev > 0 ? mean / stdDev : 0

  const summary: BacktestSummary = {
    totalTrades: trades.length,
    winningTrades: winning,
    winRate: winning / trades.length,
    avgProfitEth: avgProfit,
    totalProfitEth: totalProfit,
    maxDrawdownEth: maxDrawdown,
    sharpeRatio: sharpe,
    trades,
  }

  // Save to database
  insertBacktestResult({
    strategy_name: strategyName,
    date_from: Math.floor(Date.now() / 1000) - 86400 * 30,  // approximate
    date_to: Math.floor(Date.now() / 1000),
    total_trades: summary.totalTrades,
    winning_trades: summary.winningTrades,
    win_rate: summary.winRate,
    avg_profit_eth: summary.avgProfitEth,
    max_drawdown_eth: summary.maxDrawdownEth,
    sharpe_ratio: summary.sharpeRatio,
    raw_data: { trades: trades.slice(0, 100) },  // store first 100 trades
  })

  console.log(`[Backtester] ${strategyName} results:`)
  console.log(`  Trades: ${summary.totalTrades}, Win rate: ${(summary.winRate * 100).toFixed(1)}%`)
  console.log(`  Total profit: ${summary.totalProfitEth.toFixed(6)} ETH`)
  console.log(`  Max drawdown: ${summary.maxDrawdownEth.toFixed(6)} ETH`)
  console.log(`  Sharpe ratio: ${summary.sharpeRatio.toFixed(2)}`)

  return summary
}

/**
 * Format backtest results as a human-readable report for Munger review.
 */
export function formatBacktestReport(strategyName: string, summary: BacktestSummary): string {
  return `
## Backtest Report: ${strategyName}

| Metric | Value |
|--------|-------|
| Total trades | ${summary.totalTrades} |
| Win rate | ${(summary.winRate * 100).toFixed(1)}% |
| Avg profit/trade | ${summary.avgProfitEth.toFixed(6)} ETH |
| Total profit | ${summary.totalProfitEth.toFixed(4)} ETH |
| Max drawdown | ${summary.maxDrawdownEth.toFixed(4)} ETH |
| Sharpe ratio | ${summary.sharpeRatio.toFixed(2)} |

${summary.winRate < 0.4 ? '⚠️ Win rate below 40% — strategy needs more research.' : ''}
${summary.maxDrawdownEth > 0.5 ? '⚠️ Drawdown over 0.5 ETH — significant risk.' : ''}
${summary.sharpeRatio < 0.5 ? '⚠️ Sharpe ratio below 0.5 — poor risk-adjusted return.' : ''}
`.trim()
}
