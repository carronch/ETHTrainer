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

### Completed
- [x] Fund trading wallet — 0.1 ETH sent to Arbitrum
- [x] Security audit — two bugs fixed in `LiquidationBot.sol` (allowance mismatch + underflow panic)
- [x] Contract compiled + deployed to Arbitrum: `0xdd735eDAD018357825c164a5A81aFAeeC2f1Fd0D`
- [x] `LIQUIDATION_BOT_ADDRESS` written to `.dev.vars`, liquidator restarted
- [x] Heuristic params seeded (`heuristic_params.arbitrum.json` — conservative defaults, The Graph endpoint dead)
- [x] Bug fix: Aave oracle address in `chains.rs` was 39 hex chars (missing final `7`) → fixed to `0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7`
- [x] Bug fix: `db.rs` `open()` never created SQLite schema → added `CREATE TABLE IF NOT EXISTS` on open
- [x] TS monitor started via pm2 (`ethtrainer-ts` — health watchdog + autoresearch scheduler)
- [x] Telegram alerts working
- [x] **72h Shadow mode ran** — Arbitrum cycle 8700+ (watchlist=172), Base cycle running (watchlist=55,164)
- [x] **Go live** — 2026-03-16 ~15:56 UTC
  - `liquidator-arbitrum.service`: `--chain arbitrum` (no --shadow), live
  - `liquidator-base.service`: `--chain base` (no --shadow), live
  - Note: `--live` flag does not exist; removing `--shadow` = live mode

### Known Limitations (non-blocking)
- Alchemy PAYG: upgraded from free tier. Arbitrum watchlist builds via WS events (172 addresses) — grows organically over time.
- The Graph hosted endpoint dead: seed-params uses conservative defaults only.
- Base watchlist seeded historically (55,164 addresses) — higher liquidation opportunity density than Arbitrum.
- Kernel upgraded on Hetzner (6.8.0-106) — reboot complete 2026-03-16.

---

## 🟢 Phase 2 — Autoresearch Online

- [ ] Enable nightly autoresearch loop (2am UTC cron via pm2 or systemd timer)
- [ ] Verify first parameter update cycle runs correctly
- [ ] Monitor: did parameters improve capture rate after first week?

---

## 🔵 Phase 3 — Scale (after first profitable month)

- [ ] Add Radiant Capital (Parked — recent $50M exploit, TVL too low)
- [ ] Add The Graph complete borrower coverage (all current borrowers, not just recent events)
- [x] Aave v3 Base — live 2026-03-16
- [x] Aave v3 Optimism — shadow mode started 2026-03-16, contract: 0xE108aCF99820554f0A577d8aa164e84cf08f2125

---

## Parked Indefinitely

- Delta-neutral funding arb
- Zero-value shorts
- Whale copy-trading
- Polymarket
- Cascade detection
- Lido auto-staking
