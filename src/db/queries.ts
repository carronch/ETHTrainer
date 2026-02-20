import { getDb } from './index.js'

// ── Trades ────────────────────────────────────────────────────────────────────

export interface Trade {
  id?: number
  tx_hash?: string
  strategy: string
  action: string
  network: string
  from_addr: string
  to_addr: string
  value_wei: string
  gas_used?: string
  gas_price?: string
  status: 'pending' | 'confirmed' | 'failed'
  profit_eth?: number
  notes?: string
  created_at?: number
  confirmed_at?: number
}

export function insertTrade(trade: Omit<Trade, 'id' | 'created_at'>): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO trades (tx_hash, strategy, action, network, from_addr, to_addr, value_wei, status, notes)
    VALUES (:tx_hash, :strategy, :action, :network, :from_addr, :to_addr, :value_wei, :status, :notes)
  `)
  const result = stmt.run({
    tx_hash: trade.tx_hash ?? null,
    strategy: trade.strategy,
    action: trade.action,
    network: trade.network,
    from_addr: trade.from_addr,
    to_addr: trade.to_addr,
    value_wei: trade.value_wei,
    status: trade.status,
    notes: trade.notes ?? null,
  })
  return Number(result.lastInsertRowid)
}

export function updateTradeConfirmed(txHash: string, status: 'confirmed' | 'failed', profitEth?: number): void {
  const db = getDb()
  db.prepare(`
    UPDATE trades
    SET status = :status, profit_eth = :profit_eth, confirmed_at = unixepoch()
    WHERE tx_hash = :tx_hash
  `).run({ status, profit_eth: profitEth ?? null, tx_hash: txHash })
}

export function getTradesByStrategy(strategy: string, limit = 100): Trade[] {
  const db = getDb()
  return db.prepare(`SELECT * FROM trades WHERE strategy = ? ORDER BY created_at DESC LIMIT ?`)
    .all(strategy, limit) as Trade[]
}

// ── Strategies ────────────────────────────────────────────────────────────────

export interface Strategy {
  id?: number
  name: string
  description?: string
  status: 'research' | 'backtesting' | 'testnet' | 'live' | 'paused'
  confidence: number
  total_trades?: number
  winning_trades?: number
  total_profit_eth?: number
  playbook_path?: string
  approved_by_munger?: number
  munger_notes?: string
}

export function upsertStrategy(strategy: Strategy): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO strategies (name, description, status, confidence, playbook_path, approved_by_munger, munger_notes)
    VALUES (:name, :description, :status, :confidence, :playbook_path, :approved_by_munger, :munger_notes)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      status = excluded.status,
      confidence = excluded.confidence,
      playbook_path = excluded.playbook_path,
      approved_by_munger = excluded.approved_by_munger,
      munger_notes = excluded.munger_notes,
      updated_at = unixepoch()
  `).run({
    name: strategy.name,
    description: strategy.description ?? null,
    status: strategy.status,
    confidence: strategy.confidence,
    playbook_path: strategy.playbook_path ?? null,
    approved_by_munger: strategy.approved_by_munger ?? 0,
    munger_notes: strategy.munger_notes ?? null,
  })
}

export function getStrategy(name: string): Strategy | null {
  const db = getDb()
  return db.prepare(`SELECT * FROM strategies WHERE name = ?`).get(name) as Strategy | null
}

export function getAllStrategies(): Strategy[] {
  const db = getDb()
  return db.prepare(`SELECT * FROM strategies ORDER BY total_profit_eth DESC`).all() as Strategy[]
}

export function updateStrategyStats(name: string, won: boolean, profitEth: number): void {
  const db = getDb()
  db.prepare(`
    UPDATE strategies SET
      total_trades = total_trades + 1,
      winning_trades = winning_trades + :won,
      total_profit_eth = total_profit_eth + :profit,
      updated_at = unixepoch()
    WHERE name = :name
  `).run({ won: won ? 1 : 0, profit: profitEth, name })
}

// ── Agent Logs ────────────────────────────────────────────────────────────────

export function logAgent(agent: string, level: 'info' | 'warn' | 'error' | 'decision', message: string, metadata?: unknown): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO agent_logs (agent, level, message, metadata)
    VALUES (?, ?, ?, ?)
  `).run(agent, level, message, metadata ? JSON.stringify(metadata) : null)
}

export function getAgentLogs(agent?: string, limit = 100): unknown[] {
  const db = getDb()
  if (agent) {
    return db.prepare(`SELECT * FROM agent_logs WHERE agent = ? ORDER BY created_at DESC LIMIT ?`).all(agent, limit)
  }
  return db.prepare(`SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?`).all(limit)
}

// ── Treasury Sweeps ───────────────────────────────────────────────────────────

export function insertSweep(txHash: string, amountEth: number, fromBalanceEth: number, notes?: string): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO treasury_sweeps (tx_hash, amount_eth, from_balance_eth, notes)
    VALUES (?, ?, ?, ?)
  `).run(txHash, amountEth, fromBalanceEth, notes ?? null)
}

export function getTotalSwept(): number {
  const db = getDb()
  const row = db.prepare(`SELECT COALESCE(SUM(amount_eth), 0) as total FROM treasury_sweeps WHERE tx_hash IS NOT NULL`).get() as { total: number }
  return row.total
}

// ── Backtest Results ──────────────────────────────────────────────────────────

export interface BacktestResult {
  strategy_name: string
  date_from: number
  date_to: number
  total_trades: number
  winning_trades: number
  win_rate: number
  avg_profit_eth: number
  max_drawdown_eth: number
  sharpe_ratio?: number
  notes?: string
  raw_data?: unknown
}

export function insertBacktestResult(result: BacktestResult): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO backtest_results
      (strategy_name, date_from, date_to, total_trades, winning_trades, win_rate, avg_profit_eth, max_drawdown_eth, sharpe_ratio, notes, raw_data)
    VALUES
      (:strategy_name, :date_from, :date_to, :total_trades, :winning_trades, :win_rate, :avg_profit_eth, :max_drawdown_eth, :sharpe_ratio, :notes, :raw_data)
  `).run({
    ...result,
    sharpe_ratio: result.sharpe_ratio ?? null,
    notes: result.notes ?? null,
    raw_data: result.raw_data ? JSON.stringify(result.raw_data) : null,
  })
}

// ── Learnings ─────────────────────────────────────────────────────────────────

export function insertLearning(source: string, insight: string, sourceId?: number): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO learnings (source, source_id, insight)
    VALUES (?, ?, ?)
  `).run(source, sourceId ?? null, insight)
}
