# Todo

> AI: at the start of every session, read CLAUDE.md + lessons.md, then read this file.
> Check in with the user before starting implementation.

---

## 🎯 Strategy: Liquidation Bots Only (Year 1)

Compound liquidation profits for at least 1 year. No other strategies until ~5 ETH accumulated.
Then deploy delta-neutral on idle capital only. Everything else is parked.

---

## 🔴 Phase A — Activation (USER ACTION REQUIRED)

These require the user to act before any code runs:

- [ ] **Get Arbitrum RPC URL** — Alchemy or Infura, Arbitrum mainnet. Add to `.dev.vars` as `ARBITRUM_RPC_URL`
- [ ] **Bridge ETH to Arbitrum** — 0.05 ETH minimum on Arbitrum for gas (trading wallet address)
- [ ] **Install + compile** — `npm install && npm run compile`
- [ ] **Deploy contract** — `npm run deploy:liquidation` → copies `LIQUIDATION_BOT_ADDRESS` into `.dev.vars`
- [ ] **Fork test** — `npx hardhat node --fork <arbitrum-rpc>` then run bot locally against the fork
- [ ] **Go live** — `npm run agent` or `pm2 start npm --name ethtrainer -- run agent`

---

## 🟡 Phase B — Maximize Bot Yield (build after live)

Ranked by expected ETH/day impact. Build in this order:

- [ ] **1. Radiant Capital** — Arbitrum's largest lender by TVL. Aave v2 fork, same pattern. New monitor + health checker. Adds a fully independent opportunity pool.
- [ ] **2. Complete borrower coverage** — The Graph API gives ALL current borrowers, not just last 3 days of events. Older underwater positions are easiest wins — no one is watching them.
- [ ] **3. Pre-flight simulation** — `eth_call` before every submission. If tx would revert (position already gone), skip silently. No wasted gas, no circuit breaker false fires.
- [ ] **4. Aave v3 Base + Optimism** — Same contract addresses, different RPC. Two more independent chains with their own borrower pools.
- [ ] **5. HF pre-alert queue** — Watch positions at HF 1.0–1.05. Pre-calculate the opportunity. Submit the instant they cross 1.0 — no scan-cycle lag.

---

## 🟢 Phase C — Delta-Neutral (after ~5 ETH accumulated)

- [ ] Build Hyperliquid REST + WebSocket client
- [ ] Deploy idle ETH (above 0.5 floor) into delta-neutral hedge
- [ ] Auto-reinvest liquidation profits into growing the position

---

## ✅ Completed

- **MasterAgent integration** — LiquidationBot auto-starts in `runCycle()`. Tools: `get_liquidation_bot_status`, `run_liquidation_check`. `npm run build` clean.
- **TypeScript errors fixed** — bigint literals, alertTrade shape, alertStartup → alertInfo, node:sqlite casts.
- **Liquidation bot build** — Solidity contract + TypeScript monitor/health-checker/opportunity-finder/executor/orchestrator.
- **Strategy research** — 6 strategies researched, playbooked. X trending rejected. Lido = savings account only.
- **Full infrastructure** — Agents, DB, LLM, wallet, Telegram, Ethereum client, backtester, pm2.
