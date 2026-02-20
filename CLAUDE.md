# ETHTrainer

> A hierarchical AI agent system that operates autonomously on Ethereum to accumulate 32 ETH and spin up a validator.

## What It Does

ETHTrainer deploys a master AI agent that spawns specialized sub-agents (researcher, strategist, executor, risk manager) to find and exploit profitable on-chain opportunities — MEV, Polymarket asymmetric bets, yield strategies, and more. All profits are split between a compounding trading account and a sacred treasury wallet. When the treasury reaches 32 ETH, an Ethereum validator is spun up. The system learns from every trade, backtests every strategy before deploying capital, and grows smarter over time.

## Workflow Orchestration

### Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Task Management

- Plan First: Write plan to tasks/todo.md with checkable items
- Verify Plan: Check in before starting implementation
- Track Progress: Mark items complete as you go
- Explain Changes: High-level summary at each step
- Document Results: Add review section to tasks/todo.md
- Capture Lessons: Update tasks/lessons.md after corrections

## Core Principles

- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.

## Stack

- **Language:** TypeScript
- **Runtime:** Node.js on always-on Mac Mini
- **Agent Framework:** Inspired by pi-mono (`@mariozechner/pi-agent-core`) — modular, skill-based, multi-LLM
- **Ethereum:** viem (chain interaction), own Ethereum node (MEV/Flashbots access)
- **Database:** SQLite (local, persistent — agent state, trade history, strategy performance)
- **Process Manager:** pm2 (always-on, auto-restart, log management)
- **AI Layer:** Multi-model — Claude (Anthropic) + OpenAI, model chosen per task
- **Alerts:** Telegram bot
- **Network:** Holesky testnet → Ethereum mainnet

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

## Agent Architecture

### Hierarchy
```
MasterAgent
├── MungerAgent          ← Strategic advisor, trained on Obsidian vault (Charlie Munger mental models)
├── ResearcherAgent      ← Finds on-chain opportunities, pulls data, backtests
├── StrategistAgent      ← Evaluates opportunities, builds playbooks
├── ExecutorAgent        ← Signs and submits transactions (trading wallet only)
└── RiskManagerAgent     ← Monitors positions, enforces hard limits, triggers alerts
```

### Agent Capabilities (pi-skills pattern)
Each agent has a set of skills (modular, self-contained). Skills are added as the system discovers new opportunities.

### MungerAgent — First Agent to Build
- Trained from user's Obsidian vault (Charlie Munger mental models)
- Consulted before any new strategy is approved
- Applies: inversion, circle of competence, margin of safety, lollapalooza effect
- Can veto strategies the other agents propose

## Wallet System

### Two-Wallet Architecture
- **Trading Wallet** (agent-controlled): Encrypted JSON keystore on Mac Mini. Password stored in macOS Keychain. Agent unlocks at runtime via Keychain CLI. Never in plaintext, never in Git.
- **Treasury Wallet** (cold, offline): Receive-only address known to the system. Key stored offline (hardware wallet). Agent can ONLY send TO this address, never read the key, never spend from it.

### Treasury Sweep Rules
- Sweep **25% of net profit** per winning cycle
- **Minimum sweep threshold**: 0.05 ETH (don't sweep tiny amounts — gas efficiency)
- **Trading wallet floor**: 0.5 ETH minimum — never sweep if balance would drop below this
- **Sweep cadence**: Weekly batch (minimize gas costs)
- **Goal**: Treasury reaches 32 ETH → validator activation

## Backtesting & Learning System

### Before Any Strategy Goes Live
1. ResearcherAgent pulls historical on-chain data for the strategy's target domain
2. Strategy is backtested against historical data — must show positive expected value
3. MungerAgent reviews backtest results with skepticism (survivorship bias, overfitting checks)
4. StrategistAgent writes a playbook entry in `tasks/playbooks/`
5. Strategy runs on Holesky testnet first
6. Only after testnet validation does ExecutorAgent get authorization for mainnet

### Learning Loop
- After every trade cycle: agent logs outcome to SQLite
- Weekly: system reviews win/loss patterns, updates strategy confidence scores
- Losing strategies are flagged, paused, and re-evaluated
- Winning strategies get increased allocation (Kelly Criterion-informed sizing)

## Commands

```bash
# Install dependencies
npm install

# Local development (testnet)
npm run dev

# Run master agent
npm run agent

# pm2 — keep agent alive
pm2 start npm --name ethtrainer -- run agent
pm2 save
pm2 startup   # auto-start on Mac Mini reboot

# Run tests
npm test

# Backtest a strategy
node scripts/backtest.js <strategy-name>

# Run specific scripts
node scripts/<script-name>.js
```

## Architecture

### Key Folders
```
src/
  agents/         ← agent implementations (master, munger, researcher, etc.)
  skills/         ← modular skill plugins (pi-skills pattern)
  executor/       ← transaction signing and submission via viem
  wallet/         ← keystore management, Keychain integration
  db/             ← SQLite schema, queries, migrations
  telegram/       ← alert bot
  backtester/     ← historical data fetching and strategy simulation
scripts/          ← one-off operational scripts
tasks/
  todo.md         ← active work
  lessons.md      ← AI self-improvement log
  playbooks/      ← validated strategy playbooks
docs/
  spec.md         ← feature spec template
```

## Key Files

- `wrangler.toml` — remove or repurpose (not deploying to Cloudflare)
- `src/agents/master.ts` — top-level orchestrator
- `src/agents/munger.ts` — strategic advisor (first agent to build)
- `src/wallet/keystore.ts` — encrypted key management
- `src/db/schema.ts` — SQLite schema
- `src/executor/index.ts` — viem transaction layer

## Secrets & Environment

All secrets live in `.dev.vars` locally (gitignored). Never in code, never committed.

```
# .dev.vars (never commit this)
KEYSTORE_PASSWORD=<unlocks encrypted JSON keystore>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ETH_RPC_URL=http://localhost:8545    # own node
ETH_RPC_URL_WS=ws://localhost:8546   # websocket for mempool
TREASURY_ADDRESS=<cold wallet receive address>
```

Keystore file: `~/.ethtrainer/keystore.json` (outside repo, password in macOS Keychain)

## Rules

- **NEVER** touch the treasury wallet private key — it is offline. Agent only knows the address.
- **NEVER** spend from the treasury wallet — only deposit into it.
- **NEVER** commit `.dev.vars`, `*.key`, `*.pem`, or keystore files.
- **NEVER** hardcode private keys, addresses, or API keys in source code.
- **NEVER** deploy a strategy to mainnet without: backtest → MungerAgent review → testnet run.
- Do not use localStorage — use SQLite.
- Keep dependencies minimal.
- All scripts go in `scripts/` — no external automation tools.
- Validate all Ethereum addresses using viem's `getAddress()` before any transaction.
- Human confirmation required before any mainnet transaction over 1 ETH.
- Trading wallet floor: never drop below 0.5 ETH in trading wallet.

## Coding Rules

### TypeScript
- Strict mode enabled
- No `any` types
- All async functions have explicit error handling
- Every transaction is logged to SQLite before and after submission

### Agent Skills (pi-skills pattern)
- Each skill is self-contained in `src/skills/<skill-name>/`
- Every skill has a `SKILL.md` describing what it does and when to use it
- Skills are composable — agents pick the skills they need

### Security
- Fetch `https://ethskills.com/security/SKILL.md` before writing any contract interaction code
- Validate all external data before acting on it
- Never trust mempool data blindly

## Current Focus / Active Work

**Phase 0 — Setup (current)**
- [ ] Rename package, initialize TypeScript project
- [ ] Set up SQLite schema
- [ ] Set up encrypted keystore + macOS Keychain integration
- [ ] Connect to own Ethereum node (Holesky)
- [ ] Set up pm2
- [ ] Set up Telegram alert bot
- [ ] Build MungerAgent (load Obsidian vault → train on Munger mental models)

**Phase 1 — First Strategy**
- [ ] ResearcherAgent: deep research on MEV and Polymarket opportunities
- [ ] Backtest top candidates
- [ ] MungerAgent review
- [ ] Testnet deployment

## Known Issues / Constraints

- Cloudflare Workers references in template (`wrangler.toml`) are irrelevant — this runs on Mac Mini Node.js. Remove or repurpose.
- Own Ethereum node must be synced before agents can operate.
- Holesky testnet ETH needed for testing (free from faucets).
