import { describe, it, expect, vi, beforeAll } from 'vitest'
import { formatBacktestReport } from '../backtester/index.js'

// Mock the DB insert so backtest tests don't need a real database
vi.mock('../db/queries.js', () => ({
  insertBacktestResult: vi.fn(),
  logAgent: vi.fn(),
}))

// Mock the ethereum client — no real node needed for unit tests
vi.mock('../ethereum/client.js', () => ({
  getPublicClient: vi.fn(() => ({
    getBlockNumber: vi.fn(async () => BigInt(100)),
    getGasPrice: vi.fn(async () => BigInt(1_000_000_000)),
  })),
}))

describe('Backtester', () => {
  it('formats a backtest report correctly', () => {
    const summary = {
      totalTrades: 100,
      winningTrades: 55,
      winRate: 0.55,
      avgProfitEth: 0.002,
      totalProfitEth: 0.2,
      maxDrawdownEth: 0.05,
      sharpeRatio: 1.2,
      trades: [],
    }

    const report = formatBacktestReport('test_strategy', summary)

    expect(report).toContain('test_strategy')
    expect(report).toContain('55.0%')
    expect(report).toContain('0.2000')
    expect(report).toContain('1.20')
  })

  it('flags low win rate in report', () => {
    const summary = {
      totalTrades: 50,
      winningTrades: 15,
      winRate: 0.30,
      avgProfitEth: -0.001,
      totalProfitEth: -0.05,
      maxDrawdownEth: 0.1,
      sharpeRatio: -0.5,
      trades: [],
    }

    const report = formatBacktestReport('bad_strategy', summary)
    expect(report).toContain('Win rate below 40%')
  })

  it('flags high drawdown in report', () => {
    const summary = {
      totalTrades: 50,
      winningTrades: 30,
      winRate: 0.6,
      avgProfitEth: 0.001,
      totalProfitEth: 0.05,
      maxDrawdownEth: 1.0,
      sharpeRatio: 0.3,
      trades: [],
    }

    const report = formatBacktestReport('risky_strategy', summary)
    expect(report).toContain('Drawdown over 0.5 ETH')
  })
})
