// SQLite schema definitions — all CREATE TABLE statements
// Using node:sqlite (built-in Node.js 22+, no native dependencies)

export const SCHEMA_SQL = `
-- ── Trades ──────────────────────────────────────────────────────────────────
-- Every transaction the agent submits
CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash     TEXT UNIQUE,
  strategy    TEXT NOT NULL,
  action      TEXT NOT NULL,          -- 'buy', 'sell', 'swap', 'bet', 'sweep', etc.
  network     TEXT NOT NULL DEFAULT 'holesky',
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  value_wei   TEXT NOT NULL DEFAULT '0',   -- BigInt as string
  gas_used    TEXT,
  gas_price   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
  profit_eth  REAL,                    -- net profit/loss in ETH (null until confirmed)
  notes       TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  confirmed_at INTEGER
);

-- ── Strategies ───────────────────────────────────────────────────────────────
-- Strategy registry with performance tracking
CREATE TABLE IF NOT EXISTS strategies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT UNIQUE NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'research',  -- research | backtesting | testnet | live | paused
  confidence      REAL NOT NULL DEFAULT 0.0,          -- 0.0 – 1.0
  total_trades    INTEGER NOT NULL DEFAULT 0,
  winning_trades  INTEGER NOT NULL DEFAULT 0,
  total_profit_eth REAL NOT NULL DEFAULT 0.0,
  playbook_path   TEXT,               -- path to tasks/playbooks/<name>.md
  approved_by_munger INTEGER NOT NULL DEFAULT 0,  -- 0 | 1
  munger_notes    TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Agent Logs ───────────────────────────────────────────────────────────────
-- Every decision an agent makes
CREATE TABLE IF NOT EXISTS agent_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent       TEXT NOT NULL,          -- 'master' | 'munger' | 'researcher' | etc.
  level       TEXT NOT NULL DEFAULT 'info',  -- info | warn | error | decision
  message     TEXT NOT NULL,
  metadata    TEXT,                   -- JSON blob
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Treasury Sweeps ──────────────────────────────────────────────────────────
-- Every deposit into the cold treasury wallet
CREATE TABLE IF NOT EXISTS treasury_sweeps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash     TEXT UNIQUE,
  amount_eth  REAL NOT NULL,
  from_balance_eth REAL,              -- trading wallet balance before sweep
  treasury_total_eth REAL,           -- cumulative treasury total (tracked off-chain)
  notes       TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Backtest Results ─────────────────────────────────────────────────────────
-- Historical simulation results for each strategy
CREATE TABLE IF NOT EXISTS backtest_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_name   TEXT NOT NULL,
  date_from       INTEGER NOT NULL,    -- unix timestamp
  date_to         INTEGER NOT NULL,
  total_trades    INTEGER NOT NULL,
  winning_trades  INTEGER NOT NULL,
  win_rate        REAL NOT NULL,
  avg_profit_eth  REAL NOT NULL,
  max_drawdown_eth REAL NOT NULL,
  sharpe_ratio    REAL,
  notes           TEXT,
  raw_data        TEXT,               -- JSON blob of full results
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Strategy Learnings ───────────────────────────────────────────────────────
-- What the agent has learned from outcomes
CREATE TABLE IF NOT EXISTS learnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,          -- 'trade' | 'backtest' | 'munger' | 'manual'
  source_id   INTEGER,                -- references trades.id or backtest_results.id
  insight     TEXT NOT NULL,
  applied     INTEGER NOT NULL DEFAULT 0,  -- 0 | 1
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Liquidation Watchlist ─────────────────────────────────────────────────────
-- All Aave borrowers being monitored for liquidation opportunities
CREATE TABLE IF NOT EXISTS liquidation_watchlist (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  address               TEXT NOT NULL,            -- lowercase 0x address
  network               TEXT NOT NULL DEFAULT 'arbitrum',
  first_seen_block      TEXT,                     -- BigInt as string
  last_checked_block    TEXT,
  last_health_factor    TEXT,                     -- BigInt as string (1e18 = 1.0)
  total_collateral_usd  REAL,
  total_debt_usd        REAL,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(address, network)
);

-- ── Missed Opportunities ─────────────────────────────────────────────────────
-- Liquidations that happened on-chain that we DIDN'T execute.
-- This is the primary training signal for the autoresearch loop.
-- Written by: liquidator/src/missed_tracker.rs (Rust)
-- Read by:    src/autoresearch/collector.ts (TS)
CREATE TABLE IF NOT EXISTS missed_opportunities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower            TEXT NOT NULL,
  collateral_asset    TEXT NOT NULL,
  debt_asset          TEXT NOT NULL,
  profit_missed_eth   REAL,          -- estimated profit we missed (computed by autoresearch)
  winner_address      TEXT NOT NULL, -- who got the liquidation instead
  winner_gas_gwei     REAL,          -- gas price the winner paid
  block_number        INTEGER NOT NULL,
  timestamp           INTEGER NOT NULL DEFAULT (unixepoch()),
  chain               TEXT NOT NULL DEFAULT 'arbitrum',
  analyzed            INTEGER NOT NULL DEFAULT 0  -- 0 = not yet analyzed by autoresearch
);

-- ── Strategy Params ───────────────────────────────────────────────────────────
-- Runtime parameters for the Rust executor.
-- Written by: src/autoresearch/parameter_compiler.ts
-- The Rust executor reads heuristic_params.json (file-based), but this table
-- keeps a full history of parameter changes for the autoresearch loop to learn from.
CREATE TABLE IF NOT EXISTS strategy_params (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  param_key   TEXT NOT NULL,
  param_value TEXT NOT NULL,
  previous_value TEXT,
  rationale   TEXT,
  applied     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Autoresearch Runs ─────────────────────────────────────────────────────────
-- Log of every nightly autoresearch cycle.
-- Tracks: what was analyzed, what was proposed, what was applied.
CREATE TABLE IF NOT EXISTS autoresearch_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  missed_opps_analyzed INTEGER NOT NULL DEFAULT 0,
  simulations_run     INTEGER NOT NULL DEFAULT 0,
  proposed_params     TEXT,          -- JSON of proposed HeuristicParams
  current_score       REAL,          -- shadow score with current params
  proposed_score      REAL,          -- shadow score with proposed params
  improvement_pct     REAL,          -- (proposed - current) / current * 100
  applied             INTEGER NOT NULL DEFAULT 0,
  apply_reason        TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trades_strategy    ON trades (strategy);
CREATE INDEX IF NOT EXISTS idx_trades_status      ON trades (status);
CREATE INDEX IF NOT EXISTS idx_trades_created     ON trades (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent   ON agent_logs (agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bt_strategy        ON backtest_results (strategy_name);
CREATE INDEX IF NOT EXISTS idx_watchlist_network  ON liquidation_watchlist (network, is_active);
CREATE INDEX IF NOT EXISTS idx_watchlist_hf       ON liquidation_watchlist (last_health_factor);
CREATE INDEX IF NOT EXISTS idx_missed_opps_ts     ON missed_opportunities (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_missed_opps_chain  ON missed_opportunities (chain, analyzed);
CREATE INDEX IF NOT EXISTS idx_missed_opps_analyzed ON missed_opportunities (analyzed);
CREATE INDEX IF NOT EXISTS idx_autoresearch_runs  ON autoresearch_runs (created_at DESC);
`
