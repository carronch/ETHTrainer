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

## ✅ Phase 0 — Architecture Rebuild (COMPLETE)

### 0a. Teardown
- [x] Delete old agent framework (MasterAgent, strategies, backtester)
- [x] Simplify LLM layer to autoresearch-only

### 0b. Rust Executor (`liquidator/`)
- [x] Init Rust workspace with alloy, tokio, serde, rusqlite
- [x] `config.rs` — reads `heuristic_params.<chain>.json` + hot-reload watcher
- [x] `health_scanner.rs` — batch HF checks via Aave v3
- [x] `event_listener.rs` — seeds borrower watchlist from Borrow history + live WS
- [x] `opportunity_ranker.rs` — ranks liquidatable positions by net profit
- [x] `tx_submitter.rs` — pre-flight eth_call + submit flash loan tx
- [x] `missed_tracker.rs` — logs LiquidationCall events we didn't win
- [x] `db.rs` — SQLite writes (trades, missed_opportunities)
- [x] `main.rs` — `--shadow` / `--live` modes, multi-chain support
- [x] `chains.rs` — Arbitrum, Base, Optimism chain configs
- [x] `cargo build --release` clean

### 0c. DB Schema
- [x] SQLite schema with watchlist, trades, missed_opportunities tables

### 0d. TS Autoresearch (`src/autoresearch/`)
- [x] `loop.ts`, `collector.ts`, `anvil_simulator.ts`, `parameter_compiler.ts`, `shadow_evaluator.ts`

### 0e. TS Monitor (`src/monitor/`)
- [x] `index.ts` — pm2 watchdog
- [x] `metrics.ts` — daily P&L queries

### 0f. Initial backtest + param seed
- [x] `scripts/seed-params.ts` — pulls 6mo Aave v3 Arbitrum history → heuristic_params.json

### 0g. Contracts
- [x] `LiquidationBot.sol` — flash loan liquidation contract
- [x] `deploy-liquidation-bot.ts` — deployment script

---

## 🟡 Phase 1 — Hetzner Activation (IN PROGRESS)

### Server Setup (COMPLETE)
- [x] Bought Hetzner AX102-U (2×1.92TB NVMe Datacenter Edition, RAID 0)
- [x] OS setup: Ubuntu 24.04, SSH hardening, UFW (port 8545 blocked)
- [x] Eth-Docker: Nethermind + Lighthouse, mainnet, Grafana
- [x] Tailscale: connected server to Tailscale network
- [x] Clone ETHTrainer repo, `cargo build --release`, `npm install`
- [x] Configure `.dev.vars` (Arbitrum RPC, keystore password, Telegram, etc.)
- [x] Setup wallet keystore (`~/.ethtrainer/keystore.json`)
- [x] Liquidator running in shadow mode via **systemd** (auto-restart, survives SSH disconnect + reboot)

### Remaining Steps
- [x] Fund trading wallet — 0.1 ETH sent to Arbitrum (sufficient for Arbitrum gas; 0.5 ETH floor is sweep rule only, not operational minimum)
- [x] **72h Shadow mode** — started, running via systemd on Hetzner
- [x] Security audit complete — two bugs fixed in `LiquidationBot.sol` (allowance mismatch + underflow panic)
- [ ] **Compile contract**: `npm run compile` — must be clean after bug fixes
- [ ] **Deploy** `LiquidationBot.sol` to Arbitrum: `npm run deploy:liquidation`
- [ ] Set `LIQUIDATION_BOT_ADDRESS` in `.dev.vars` on Hetzner → `systemctl restart liquidator`
- [ ] Seed heuristic params: `npx tsx scripts/seed-params.ts`
- [ ] Monitor shadow logs: `journalctl -u liquidator -f` — look for "SHADOW Would have earned" lines
- [ ] Go live: remove `--shadow` from systemd unit, `systemctl restart liquidator`

> Anvil fork validation (original Phase 1 plan) skipped — shadow mode on real Arbitrum RPC provides equivalent signal.
> Telegram alerts during shadow: daily P&L at 9am UTC + critical alerts. No-win-in-48h alert will fire (expected in shadow — ignore it).

---

## 🟢 Phase 2 — Autoresearch Online

- [ ] Enable nightly autoresearch loop (2am UTC cron via pm2 or systemd timer)
- [ ] Verify first parameter update cycle runs correctly
- [ ] Monitor: did parameters improve capture rate after first week?

---

## 🔵 Phase 3 — Scale (after first profitable month)

- [ ] Add Radiant Capital (Arbitrum largest lender, Aave v2 fork, same Rust pattern)
- [ ] Add The Graph complete borrower coverage (all current borrowers, not just recent events)
- [ ] Aave v3 Base + Optimism (same contract addresses, different RPC)

---

## Parked Indefinitely

- Delta-neutral funding arb
- Zero-value shorts
- Whale copy-trading
- Polymarket
- Cascade detection
- Lido auto-staking
