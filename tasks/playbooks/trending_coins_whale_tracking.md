# Playbook: Trending Coins & Whale Copy-Trading

**Status:** Research Complete — Whale copy-trading APPROVED CONDITIONAL / X trending REJECTED
**Munger verdict:** APPROVED CONDITIONAL (whale tracking only)
**Confidence:** 0.55 (whale copy-trading with validated watchlist)

---

## Research Finding: X Trending Alone Does Not Work

Pure X/Twitter sentiment trading was **evaluated and REJECTED** by this research:

| Signal Type | Win Rate | Expected Value | Verdict |
|-------------|----------|----------------|---------|
| X trending alone | 35–40% | -1% per trade | REJECTED |
| LunarCrush as primary signal | 35–45% | Negative | REJECTED |
| High-leverage derivatives on social signals | <40% | Highly negative | REJECTED |

**Why X trending fails**: The market prices social signals in seconds. Bot farms and organized pump groups front-run any detectable signal. An agent polling LunarCrush every 5 minutes is always buying the top.

Munger inversion: *What guarantees X-trend trading fails?* The crowd already knows. Crowds are fast on social media. Profits require information BEFORE the crowd — not the same information 5 minutes later.

---

## Viable Strategy: On-Chain Whale Copy-Trading

### What
Monitor a curated set of wallets with documented track records of high Sharpe ratio positions. When these wallets accumulate a token, enter a small lagged position 10–15 minutes later. Exit after the move or when the whale exits.

### Why It Works
Smart money moves before public information. They accumulate quietly before the social narrative fires. By tracking on-chain behavior instead of X, an agent captures the real signal 30–60 minutes ahead of LunarCrush, with a 55–65% win rate from historical data.

The Lollapalooza advantage: speed (real-time wallet monitoring) + no emotional bias + systematic execution + 24/7 coverage.

### Whale Watchlist (Starting Set to Validate)
These wallets are starting candidates. All must be backtested for ≥30 historical trades and >55% win rate before copy-trading them with real capital:
- **0xSifu** (0x06920c9fc643de77b99cb6524d30e51b41d6db3f) — DeFi insider, Curve ecosystem
- **Paradigm trading wallets** — discoverable via Etherscan label search + ENS
- High-performing MEV wallet clusters — discoverable via performance analysis

Watchlist is dynamic: wallets below 55% win rate over 30 trades get removed. New wallets added as they're identified via performance analysis.

### Entry Conditions
1. Tracked whale buys a token with >$50M market cap AND >$1M daily DEX volume
2. Position size is ≥ whale's median historical position (not a test/dust trade)
3. Not adding to an existing position — this is new accumulation
4. Signal NOT yet visible in LunarCrush trending (if it's already trending, skip)
5. Enter 12 minutes after whale tx confirmation

### Exit Conditions
- Take profit: +15–20% from entry
- Stop loss: -12% from entry
- Time stop: Close after 24 hours regardless
- Whale exit: If tracked wallet reduces position >30% → exit immediately

### Position Sizing (Kelly Criterion)
With 55% win rate, +18% avg win, -12% avg loss:
- Full Kelly: ~6% of wallet
- **Use Half-Kelly: 3% per trade** (crypto volatility demands conservatism)
- Maximum 5 concurrent positions (15% total exposure)

### Signal Scoring (Gate Before Entry)

| Factor | Weight | Green | Yellow | Red |
|--------|--------|-------|--------|-----|
| Whale 90-day win rate | 30% | >65% | 55–65% | <55% |
| Token liquidity (daily DEX volume) | 25% | >$2M | $1M–$2M | <$1M |
| Position size vs whale typical | 20% | >150% typical | 100–150% | <100% |
| Time since whale last traded this token | 15% | First buy | <30 days ago | >90 days ago |
| Corroborating DEX volume spike | 10% | 3x+ normal | 2x normal | <2x |

**Only enter if combined score ≥ 65%.**

### Execution Flow
```
1. Alchemy Notify WebSocket → detect whale wallet transfer
2. Parse tx: which token, how much, which DEX
3. Calculate signal score (5-factor model)
4. If score ≥ 65%: set 12-minute timer
5. At 12 minutes: execute market buy on Uniswap v3 (3% of wallet)
6. Set stop loss + take profit orders
7. Monitor whale wallet every 5 minutes
8. Exit per rules; log outcome to SQLite
```

### Illiquid Token Rules (Hard Stops)
- **<$1M daily DEX volume**: Skip always, no exceptions
- **Top 10 wallets own >70% of supply**: Skip (rug risk)
- **Token age <30 days**: Skip (no track record)
- **Not on Uniswap v3 or SushiSwap**: Skip (execution risk)

### Gas Budget
- Entry swap: ~100–200k gas (~0.003–0.005 ETH at 20 gwei)
- Exit swap: same
- Monthly estimate: 20 trades × 0.004 ETH = 0.08 ETH
- Minimum expected profit to enter: 5× gas cost

### Risk Controls
- 5 consecutive losses → pause whale trading, audit the watchlist
- If any whale's win rate drops below 55% over 20 trades → remove from watchlist
- Never enter if whale's buy amount >5% of token's total float (P&D risk)
- Hard limit: never more than 5% of wallet on any single whale trade

---

## Multi-Signal Fusion (Phase 2 — Not Before Phase 1 Works)

Once whale copy-trading is validated with real wins, add corroborating signals:
- DEX volume spike >300% on Uniswap v3 (The Graph subgraph)
- Exchange net outflows >$50M (tokens leaving CEX = accumulation)
- X trending mention velocity (secondary confirmation only, not primary)

The fusion model requires its own backtest (≥30 events per signal type, >55% win rate) before being incorporated into position sizing.

---

## What to NEVER Do (Permanent Rules)

Based on the research:

1. **Never trade purely on X/Twitter trending** — negative expected value, always
2. **Never use LunarCrush as a primary signal** — too delayed, too noisy
3. **Never leverage-trade on social signals** — funding decay + false signal = capital destruction
4. **Never touch tokens with <$1M daily DEX volume** — slippage kills the trade
5. **Never follow a whale into a token where they own >10% of float** — they're dumping on you

---

## Munger Evaluation

### Verdict: APPROVED CONDITIONAL (Whale Copy-Trading Only)

**Inversion Analysis** — *What guarantees this fails?*
- Whale wallets start performing randomly: Performance database catches this. Remove underperformers automatically.
- Enough bots copy the same whales, alpha disappears: Diversify watchlist. If many bots are copying, the lag time needs to increase to 20+ min, reducing win rate.
- Whale deliberately front-runs copiers: Only copy whales with 2+ years of consistent history. If they wanted to manipulate copiers they'd show in the loss stats.
- Token pumps too fast before 12-min lag: This captures the pre-pump, not the pump. Sometimes the price barely moves in 12 min.

**Circle of Competence**: Partially inside. On-chain data processing is inside our competence. Identifying which wallets to trust is NOT yet validated. That's why backtesting is required before any capital.

**Margin of Safety**: Low until validated. Half-Kelly sizing + 24-hour time stop + 12% stop loss provides capital protection.

**Verdict for X Trending**: REJECTED permanently. No amount of signal refinement makes negative-EV trading work. The research is clear.

---

## Phase Gate

- [ ] Build whale performance database using Etherscan historical tx data (6 months)
- [ ] Identify ≥5 wallets with >55% win rate over ≥30 historical trades each
- [ ] Implement 5-factor signal scoring model
- [ ] Backtest copy-trading with 12-minute lag on all validated wallets
- [ ] Validate positive EV after gas + slippage
- [ ] MungerAgent reviews backtest numbers (with survivorship bias check)
- [ ] Paper trade: 20+ simulated positions using live whale data
- [ ] Mainnet phase 1: 1% position size for first 20 live trades
- [ ] If ≥55% win rate at 1%: Scale to 3% (Half-Kelly)
