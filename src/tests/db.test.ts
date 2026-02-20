import { describe, it, expect, vi, beforeAll } from 'vitest'
import { SCHEMA_SQL } from '../db/schema.js'

// node:sqlite is a Node.js 24 built-in — Vitest's bundler (Vite) can't resolve it.
// We mock it here and verify our schema + query logic at the SQL string level.
vi.mock('node:sqlite', () => {
  // Simple in-memory store for testing
  const tables: Record<string, unknown[]> = {}
  const insertedIds: number[] = [1]

  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => ({
      run: vi.fn(() => ({ lastInsertRowid: insertedIds[0]++ })),
      get: vi.fn(() => {
        if (sql.includes('sqlite_master')) {
          return { total: 0 }
        }
        return { name: 'test', status: 'pending', action: 'buy', confidence: 0.6, approved_by_munger: 0, message: 'Test log', total: 0.5 }
      }),
      all: vi.fn(() => {
        if (sql.includes('sqlite_master')) {
          return [
            { name: 'trades' },
            { name: 'strategies' },
            { name: 'agent_logs' },
            { name: 'treasury_sweeps' },
            { name: 'backtest_results' },
            { name: 'learnings' },
          ]
        }
        return []
      }),
    })),
    close: vi.fn(),
  }

  return {
    DatabaseSync: vi.fn(() => mockDb),
  }
})

// Also mock node:fs to prevent actual file creation
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}))

describe('Database schema SQL', () => {
  it('contains all required CREATE TABLE statements', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS trades')
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS strategies')
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS agent_logs')
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS treasury_sweeps')
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS backtest_results')
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS learnings')
  })

  it('has indexes on key columns', () => {
    expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_trades_strategy')
    expect(SCHEMA_SQL).toContain('CREATE INDEX IF NOT EXISTS idx_agent_logs_agent')
  })

  it('uses TEXT for BigInt fields (wei values)', () => {
    // Wei values must be stored as TEXT to avoid JS number precision loss
    expect(SCHEMA_SQL).toMatch(/value_wei\s+TEXT/)
    expect(SCHEMA_SQL).toMatch(/gas_used\s+TEXT/)
  })

  it('uses REAL for ETH amounts', () => {
    expect(SCHEMA_SQL).toMatch(/amount_eth\s+REAL/)
    expect(SCHEMA_SQL).toMatch(/profit_eth\s+REAL/)
    expect(SCHEMA_SQL).toMatch(/confidence\s+REAL/)
  })
})

describe('Database module (mocked)', () => {
  beforeAll(async () => {
    // Initialize db module (will use mocked DatabaseSync)
    const { getDb } = await import('../db/index.js')
    getDb()
  })

  it('returns tables when queried', async () => {
    const { getDb } = await import('../db/index.js')
    const db = getDb()
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('trades')
    expect(names).toContain('strategies')
    expect(names).toContain('agent_logs')
  })
})

describe('Query functions (mocked db)', () => {
  it('insertTrade returns a number id', async () => {
    const { insertTrade } = await import('../db/queries.js')
    const id = insertTrade({
      strategy: 'test',
      action: 'buy',
      network: 'holesky',
      from_addr: '0xabc',
      to_addr: '0xdef',
      value_wei: '1000000000000000000',
      status: 'pending',
    })
    expect(typeof id).toBe('number')
  })

  it('logAgent does not throw', async () => {
    const { logAgent } = await import('../db/queries.js')
    expect(() => logAgent('master', 'info', 'test message')).not.toThrow()
  })

  it('getTotalSwept returns a number', async () => {
    const { getTotalSwept } = await import('../db/queries.js')
    const total = getTotalSwept()
    expect(typeof total).toBe('number')
  })
})
