# Todo

> AI: at the start of every session, read CLAUDE.md + lessons.md, then read this file.
> Check in with the user before starting implementation.

---

## 🎯 Strategy: Liquidation Bots Only. 3-Layer Architecture. Autoresearch loop.

Goal 1: Pay for Hetzner server.
Goal 2: Accumulate 32 ETH in treasury → spin up validator.
Nothing else.

---

## Architecture v2 — Approved

```
Layer 1: Rust Executor      (always-on, no LLM, reads heuristic_params.json)
Layer 2: TS Autoresearch    (nightly, LLM-driven, writes heuristic_params.json)
Layer 3: TS Monitor         (lightweight, process watchdog + sparse Telegram alerts)
```

Communication: Rust ↔ TS via SQLite + `heuristic_params.json` file.

---

## 🔴 Phase 0 — Architecture Rebuild (do before buying Hetzner)

### 0a. Teardown
- [ ] Delete `src/agents/` (entire folder — Munger, Researcher, Strategist, ExecutorAgent, RiskManager, Base, Master)
- [ ] Delete `src/strategies/` (migrate liquidation to Rust; discard rest)
- [ ] Delete `src/backtester/` (rewrite as `src/autoresearch/`)
- [ ] Delete `src/llm/` (simplify to autoresearch-only, no agent orchestration)

### 0b. Rust Executor (`liquidator/`)
- [ ] Init Rust workspace (`liquidator/Cargo.toml`) with alloy, tokio, serde, rusqlite
- [ ] `config_loader.rs` — reads `heuristic_params.json` on startup + reload
- [ ] `health_scanner.rs` — batch multicall to AavePool.getUserAccountData on Arbitrum
- [ ] `mempool_observer.rs` — WS subscription for Aave LiquidationCall events
- [ ] `opportunity_ranker.rs` — ranks liquidatable positions by estimated net profit
- [ ] `gas_bidder.rs` — computes optimal gas bribe from compiled heuristics
- [ ] `tx_submitter.rs` — pre-flight eth_call → sign → submit flash loan tx
- [ ] `missed_tracker.rs` — listens for LiquidationCall events we didn't win, logs to SQLite
- [ ] `main.rs` — modes: `--shadow` (no submission), `--live`
- [ ] `cargo build --release` clean

### 0c. DB Schema update (`src/db/schema.ts`)
- [ ] Add `missed_opportunities` table (borrower, profit_missed_eth, winner_gas_gwei, reason, timestamp)
- [ ] Add `strategy_params` table (param_key, param_value, updated_at, rationale)
- [ ] Add `autoresearch_runs` table (run_id, proposed_params, shadow_score, applied, timestamp)

### 0d. TS Autoresearch (`src/autoresearch/`)
- [ ] `loop.ts` — main nightly cycle (runs at 2am UTC)
- [ ] `collector.ts` — pulls LiquidationCall events from The Graph (last 24h)
- [ ] `anvil_simulator.ts` — forks Arbitrum via Anvil, replays missed opps with param variants
- [ ] `parameter_compiler.ts` — Claude analysis of simulation batch → `heuristic_params.json`
- [ ] `shadow_evaluator.ts` — validates proposal against last 7 days, requires >0.5% consistent improvement

### 0e. TS Monitor (`src/monitor/`)
- [ ] `index.ts` — pm2 watchdog: checks Rust process alive, last successful liquidation timestamp
- [ ] `telegram.ts` — sparse alerts only (crash, circuit breaker, daily P&L, param update)
- [ ] `metrics.ts` — daily P&L summary query from SQLite

### 0f. Initial backtest + param seed
- [ ] Script to pull 6 months Aave v3 Arbitrum LiquidationCall events from The Graph
- [ ] Offline simulation: find params that maximized net profit historically
- [ ] Write result to `heuristic_params.json` (initial seed before autoresearch has live data)

### 0g. Rewrite entrypoint
- [ ] `src/index.ts` — start Rust process + autoresearch scheduler + monitor

---

## 🟡 Phase 1 — Hetzner Activation

- [ ] Buy Hetzner AX102-U (2×1.92TB NVMe Datacenter Edition, RAID 0)
- [ ] OS setup: Ubuntu 24.04, SSH hardening, UFW (port 8545 blocked)
- [ ] Eth-Docker: Nethermind + Lighthouse, mainnet, Grafana
- [ ] Wait for node sync (~2-3 days)
- [ ] Tailscale: connect server to Tailscale network
- [ ] Clone ETHTrainer repo, `cargo build --release`, `npm install`
- [ ] Configure `.dev.vars` (`ETH_RPC_URL=http://localhost:8545`, Arbitrum RPC, etc.)
- [ ] Setup wallet keystore (`node scripts/setup-wallet.ts`)
- [ ] Bridge ETH to Arbitrum trading wallet
- [ ] Deploy `LiquidationBot.sol` to Arbitrum
- [ ] **72h Anvil fork validation** — Telegram report every 6h
- [ ] **72h Shadow mode validation** — Telegram report every 6h; compare capture rate vs competitors
- [ ] Go live (`./target/release/liquidator --live`)
- [ ] pm2 production: `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`

---

## 🟢 Phase 2 — Autoresearch Online

- [ ] Enable nightly autoresearch loop (2am UTC cron via pm2)
- [ ] Verify first parameter update cycle runs correctly
- [ ] Monitor: did parameters improve capture rate after first week?

---

## 🔵 Phase 3 — Scale (after first profitable month)

- [ ] Add Radiant Capital (Arbitrum largest lender, Aave v2 fork, same Rust pattern)
- [ ] Add The Graph complete borrower coverage (all current borrowers, not just recent events)
- [ ] Pre-flight `eth_call` simulation added to `tx_submitter.rs` if not already
- [ ] Aave v3 Base + Optimism (same contract addresses, different RPC)

---

## ✅ Completed

- **MasterAgent integration** — LiquidationBot auto-starts. (v1 — will be deleted in Phase 0)
- **TypeScript errors fixed** — bigint literals, alertTrade shape, node:sqlite casts.
- **Liquidation bot build** — Solidity contract + TypeScript monitor/health-checker/executor.
- **Strategy research** — 6 strategies researched, playbooked. X trending rejected. Lido = savings only.
- **Full infrastructure** — DB, LLM, wallet, Telegram, Ethereum client, backtester, pm2. (v1)
- **v2 Architecture plan** — Approved. 3 layers: Rust executor + TS autoresearch + TS monitor.

---

## Parked Indefinitely

- Delta-neutral funding arb
- Zero-value shorts
- Whale copy-trading
- Polymarket
- Cascade detection
- Lido auto-staking
