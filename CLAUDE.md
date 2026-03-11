# ETHTrainer

> Autonomous ETH accumulation system. Liquidation bots on Arbitrum → accumulate 32 ETH → spin up Ethereum validator.

## Goals

1. Pay for the Hetzner server (self-funding)
2. Accumulate 32 ETH in treasury → activate Ethereum validator
3. Nothing else

Everything in this codebase serves these two goals. No scope creep.

---

## Architecture — 3 Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Rust Executor  (always-on, no LLM)        │
│  liquidator/src/                                     │
│    config.rs           — reads heuristic_params.json │
│    health_scanner.rs   — batch HF checks (Aave v3)   │
│    event_listener.rs   — seeds borrower watchlist    │
│    opportunity_ranker.rs — ranks by net profit       │
│    tx_submitter.rs     — pre-flight + submit flash   │
│    missed_tracker.rs   — logs liquidations we lost   │
│    db.rs               — SQLite writes               │
│    main.rs             — --shadow / --live modes     │
│                                                      │
│  Reads:  heuristic_params.json (written by Layer 2)  │
│  Writes: SQLite (trades, missed_opportunities)       │
└─────────────────────────────────────────────────────┘
                   ↕ SQLite + heuristic_params.json
┌─────────────────────────────────────────────────────┐
│  Layer 2: TS Autoresearch  (nightly 2am UTC)         │
│  src/autoresearch/                                   │
│    loop.ts             — main nightly cycle          │
│    collector.ts        — pulls missed opps from DB   │
│    anvil_simulator.ts  — forks chain, replays misses │
│    parameter_compiler.ts — Claude analysis → JSON    │
│    shadow_evaluator.ts — 0.5% improvement threshold  │
│                                                      │
│  Reads:  SQLite (missed_opps, trade stats)           │
│  Writes: heuristic_params.json → Rust hot-reloads   │
└─────────────────────────────────────────────────────┘
                        ↕ SQLite
┌─────────────────────────────────────────────────────┐
│  Layer 3: TS Monitor  (always-on, lightweight)       │
│  src/monitor/                                        │
│    index.ts            — pm2 health watchdog         │
│    metrics.ts          — daily P&L queries           │
└─────────────────────────────────────────────────────┘
```

**Communication:** Rust ↔ TS via two channels only:
- `heuristic_params.json` — TS writes, Rust hot-reloads on next heartbeat
- SQLite — Rust writes trade/missed data, TS reads for analysis

---

## Karpathy Autoresearch Loop

The learning engine. Runs every night at 2am UTC:

```
1. Pull missed LiquidationCall events from last 24h (SQLite + The Graph)
2. Fork Arbitrum via Anvil at the block of each miss
3. Replay with param variants (gas +10%, +20%, +50%) → would we have won?
4. Claude (claude-haiku-4-5-20251001) analyzes simulation batch → proposes new params
5. Shadow-validate against 7 days of live history
6. Apply if composite score improves ≥ 0.5% (small edges compound)
7. Telegram report: wins/losses/param changes
```

The "verifiable reward" is net profit. The system observes every miss, simulates it locally, learns the optimal gas/timing parameters, and compiles them to heuristic JSON that the Rust layer reads without an LLM in the hot path.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Rust executor | Rust + Alloy 0.9 + Tokio + rusqlite |
| TS autoresearch | TypeScript + Node.js 22 + tsx |
| TS monitor | TypeScript + Node.js 22 |
| Database | SQLite via `node:sqlite` (TS) + rusqlite (Rust) |
| Process manager | pm2 |
| LLM | Claude claude-haiku-4-5-20251001 (autoresearch only — fast, cheap) |
| Alerts | Telegram bot |
| Chain | Arbitrum (primary) |
| Contracts | Aave v3 Pool (flash loans + liquidations) |

---

## Folder Structure

```
ETHTrainer/
├── liquidator/              ← Rust executor crate
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── types.rs
│       ├── config.rs
│       ├── db.rs
│       ├── health_scanner.rs
│       ├── event_listener.rs
│       ├── opportunity_ranker.rs
│       ├── tx_submitter.rs
│       └── missed_tracker.rs
├── src/
│   ├── index.ts             ← TS entrypoint (monitor + autoresearch scheduler)
│   ├── config.ts            ← env var validation
│   ├── autoresearch/        ← nightly learning loop
│   │   ├── loop.ts
│   │   ├── collector.ts
│   │   ├── anvil_simulator.ts
│   │   ├── parameter_compiler.ts
│   │   ├── shadow_evaluator.ts
│   │   └── types.ts
│   ├── monitor/             ← process watchdog + daily P&L
│   │   ├── index.ts
│   │   └── metrics.ts
│   ├── db/                  ← SQLite schema + queries
│   ├── telegram/            ← alert bot
│   └── wallet/              ← keystore management
├── contracts/               ← LiquidationBot.sol
├── scripts/
│   ├── seed-params.ts       ← one-time: fetch 6mo history → heuristic_params.json
│   └── run-autoresearch.ts  ← manual trigger for autoresearch cycle
├── tasks/
│   ├── todo.md              ← active work + phase tracker
│   ├── lessons.md           ← AI self-improvement log
│   └── playbooks/           ← strategy playbooks
├── heuristic_params.json    ← gitignored, written at runtime by autoresearch
├── ecosystem.config.cjs     ← pm2 config (2 processes: liquidator + ethtrainer-ts)
└── Cargo.toml               ← Rust workspace root
```

---

## Wallet System

### Two-Wallet Architecture
- **Trading Wallet** (bot-controlled): Encrypted JSON keystore. Stored at `~/.ethtrainer/keystore.json` outside the repo. Password passed via `KEYSTORE_PASSWORD` env var in `.dev.vars` (gitignored, chmod 600). Never in plaintext, never in git.
- **Treasury Wallet** (cold, offline): Receive-only address known to the system. Key stored offline (hardware wallet). Bot can ONLY send TO this address. Never reads the key, never spends from it.

### Treasury Sweep Rules
- Sweep **25% of net profit** per winning cycle
- **Minimum sweep threshold**: 0.05 ETH (don't sweep tiny amounts — gas efficiency)
- **Trading wallet floor**: 0.5 ETH minimum — never sweep if balance would drop below this
- **Sweep cadence**: Weekly batch (minimize gas costs)
- **Goal**: Treasury reaches 32 ETH → validator activation

### Fund Flow
```
Liquidation profits (ETH, Arbitrum)
         │
         ▼
Trading wallet (Arbitrum, 0.5 ETH floor)
         │  Bridge weekly (when balance > 1 ETH)
         ▼
Trading wallet (Mainnet)
         │  25% of net profit, weekly sweep, min 0.05 ETH
         ▼
Treasury cold wallet (accumulates to 32 ETH)
         │  When 32 ETH reached
         ▼
Ethereum validator activated
```

---

## Environment Variables

All secrets in `.dev.vars` (gitignored, never committed):

```bash
# .dev.vars
KEYSTORE_PASSWORD=<unlocks encrypted JSON keystore>
ANTHROPIC_API_KEY=<Claude API — autoresearch only>
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ARBITRUM_RPC_URL=<Alchemy/Infura Arbitrum HTTPS>
ARBITRUM_RPC_URL_WS=<Alchemy/Infura Arbitrum WSS>
ETH_RPC_URL=http://localhost:8545    # own Ethereum mainnet node (for validator)
ETH_RPC_URL_WS=ws://localhost:8546
TREASURY_ADDRESS=<cold wallet receive address>
NETWORK=arbitrum
```

---

## Commands

```bash
# TypeScript
npm install
npm run build           # tsc --noEmit (type check)
npm run dev             # tsx src/index.ts (local dev)

# Rust
cargo build --release -p liquidator
./target/release/liquidator --shadow   # shadow mode (no tx submission)
./target/release/liquidator --live     # live mode

# Scripts
npx tsx scripts/seed-params.ts        # one-time: seed heuristic_params.json
npx tsx scripts/run-autoresearch.ts   # manual autoresearch cycle trigger

# systemd (production — Rust liquidator)
systemctl status liquidator           # check status
journalctl -u liquidator -f           # live logs
systemctl restart liquidator          # restart

# pm2 (production — TS monitor + autoresearch)
pm2 start ecosystem.config.cjs        # starts ethtrainer-ts
pm2 save && pm2 startup               # persist across reboots
pm2 logs ethtrainer-ts                # TS monitor + autoresearch logs
```

---

## Telegram Alerting (Sparse = High Signal)

Only send alerts for events that require attention:

| Event | Alert? |
|-------|--------|
| Bot crash or pm2 restart | YES — CRITICAL |
| Circuit breaker triggered | YES — CRITICAL |
| No successful liquidation in 48h | YES — CRITICAL |
| Daily P&L summary (9am UTC) | YES — one message |
| Parameter update by autoresearch | YES — what changed + rationale |
| Validation phases (every 6h) | YES — during 72h Anvil + 72h shadow |
| Every scan cycle | NO |
| Every opportunity considered | NO |
| Routine heartbeats | NO |

Detailed metrics → Grafana via Tailscale (not Telegram).

---

## Validation Strategy (Before Real ETH)

### Phase 1: 72h Anvil Fork
- Fork Arbitrum mainnet locally, run liquidator pointing at `http://localhost:8545`
- Never submits — validates detection, profit math, no crashes
- Telegram report every 6h

### Phase 2: 72h Shadow Mode (mainnet RPC, no submission)
- Point at real Arbitrum RPC
- Pre-flight `eth_call` on every tx — if profitable, log it but don't submit
- Compare shadow log vs on-chain LiquidationCall events → capture rate
- Telegram report every 6h

### Phase 3: Go Live
- Enable real tx submission (`--live`)
- No flash loan cap — flash loans are atomic (only gas at risk if tx reverts)
- Circuit breaker protects against consecutive failures

---

## Deployment Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Architecture rebuild (3-layer, Rust + TS) | ✅ Complete |
| 1 | Hetzner activation + 72h Anvil + 72h shadow + go live | 🟡 In Progress — server running, shadow mode via systemd, contract not yet deployed |
| 2 | Autoresearch online (first nightly cycle) | After Phase 1 |
| 3 | Scale: Radiant Capital + The Graph complete coverage + multi-chain | After profitable month |

### Phase 3 Scale Targets (when ready)
- Radiant Capital (Arbitrum largest lender, Aave v2 fork — same Rust pattern)
- The Graph complete borrower coverage (all current borrowers, not just recent events)
- Aave v3 Base + Optimism (same contract addresses, different RPC)

### Parked Indefinitely
- Delta-neutral funding arb
- Zero-value project shorts
- Whale copy-trading
- Polymarket
- Cascade detection
- Lido auto-staking

---

## Workflow Rules (AI)

### Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One focused task per subagent

### Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake next time
- Review lessons at session start

### Verification Before Done
- Never mark a task complete without proving it works
- Run `npm run build` after any TS changes — must be clean
- Run `cargo build --release -p liquidator` after any Rust changes — must be clean

### Autonomous Bug Fixing
- When given a bug report: just fix it, don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them

## Task Management

- Plan First: Write plan to `tasks/todo.md` with checkable items
- Check In: Verify plan with user before implementation
- Track Progress: Mark items complete immediately when done
- Capture Lessons: Update `tasks/lessons.md` after any correction

---

## Core Coding Rules

### TypeScript
- Strict mode enabled — no `any` types
- All async functions have explicit error handling
- Use `node:sqlite` (built-in Node.js 22+) — NOT better-sqlite3
- Every transaction logged to SQLite before and after submission

### Rust
- Use `alloy` (not ethers-rs — deprecated)
- Use `sol!` macro for type-safe contract bindings
- Keep hot path LLM-free: Rust reads `heuristic_params.json`, never calls Claude

### Security
- Fetch `https://ethskills.com/security/SKILL.md` before writing any contract interaction code
- Validate all Ethereum addresses before any transaction
- Never trust mempool data blindly
- Circuit breaker: N consecutive tx failures → cooldown period

### Hard Rules — NEVER Violate
- **NEVER** touch the treasury wallet private key — it is offline
- **NEVER** spend from the treasury wallet — only deposit into it
- **NEVER** commit `.dev.vars`, `*.key`, `*.pem`, or keystore files
- **NEVER** hardcode private keys, addresses, or API keys in source code
- **NEVER** open port 8545 to the internet on the Hetzner server
- **NEVER** call OpenAI — Claude (Anthropic) only
- Keep dependencies minimal

---

## Ethereum Knowledge Base

Before writing any Ethereum code, fetch the relevant ethskills module:

| Topic | URL |
|-------|-----|
| Orientation | https://ethskills.com/ship/SKILL.md |
| Core concepts | https://ethskills.com/concepts/SKILL.md |
| Wallets & key mgmt | https://ethskills.com/wallets/SKILL.md |
| Gas & costs | https://ethskills.com/gas/SKILL.md |
| Security | https://ethskills.com/security/SKILL.md |
| Standards (ERC-20 etc) | https://ethskills.com/standards/SKILL.md |
| DeFi building blocks | https://ethskills.com/building-blocks/SKILL.md |
| Addresses | https://ethskills.com/addresses/SKILL.md |
| Testing | https://ethskills.com/testing/SKILL.md |
| Orchestration | https://ethskills.com/orchestration/SKILL.md |
| Tools | https://ethskills.com/tools/SKILL.md |
| Indexing | https://ethskills.com/indexing/SKILL.md |
| L2s | https://ethskills.com/l2s/SKILL.md |
