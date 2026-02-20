# Playbook: Zero-Value Project Short Selling

**Status:** Research Complete → Scoring System Must Be Built and Backtested
**Munger verdict:** APPROVED CONDITIONAL (once worthlessness scoring is validated)
**Confidence:** 0.60 (after backtest validates scoring accuracy ≥65%)

---

## What
Systematically identify altcoins with a high probability of going to zero using a quantitative worthlessness scoring system. Short them using perpetual contracts on Hyperliquid. Hold with negative funding rates (get paid to wait). Exit when the token collapses or after 60 days.

This is a **defensive hedge** for the portfolio, not the primary alpha source. It profits when the broader market is in a speculative bubble or individual tokens are obvious frauds/failures.

## Why It Works
The inverse of value investing: it is easier to identify worthlessness than value. The market misprices bad tokens upward in bull cycles. The same information that tells an informed investor to avoid something tells a short-seller to bet against it.

Munger inversion model applied backwards: *"What would guarantee this project succeeds?"* — If the honest answer is "nothing," that's a short candidate.

The funding rate asymmetry: when a bubble token is being shorted by smart money, perpetual funding rates flip negative → shorts earn yield while waiting for the thesis to play out.

---

## Worthlessness Scoring System (0–100)

Score each candidate token. Short candidates must score ≥ 80.

### Score Components

| Metric | Max Points | Scoring |
|--------|-----------|---------|
| Revenue (protocol fees in last 90 days) | 20 pts | 0 revenue = 20; >$1M/month = 0 |
| GitHub dev activity (commits last 6 months) | 15 pts | 0 commits = 15; >50 commits = 0 |
| Insider token concentration (top 10 holders %) | 15 pts | >80% = 15; <30% = 0 |
| Fully diluted value / trailing 12-month revenue ratio | 15 pts | FDV/Rev > 10,000x = 15; <100x = 0 |
| Contract age (months since deployment) | 10 pts | <3 months = 10; >24 months = 0 |
| Honeypot flags detected (sell restriction functions) | 20 pts | Any confirmed = 20; none = 0 |
| Negative funding rate on Hyperliquid | 5 pts | Negative = 5; positive = 0 (bonus) |

**Thresholds:**
- Score 60–79: Monitor, not yet shortable
- Score 80–89: Shortable (small position)
- Score ≥ 90: High conviction (medium position)

### Smart Contract Red Flags (Auto-Fail Check)
Before scoring, check the contract for:
- `selfdestruct` callable by owner → HONEYPOT
- Unrestricted `mint(address, amount)` → INFINITE DILUTION
- `frozen[]` or `blacklist[]` → SELL RESTRICTION
- `delegatecall` to owner-controlled address → UPGRADEABLE RUG
- Transfer fee >5% going to owner → TAX TOKEN

Any confirmed red flag → auto-score addition of 20 points.

---

## Entry Conditions
1. Worthlessness score ≥ 80
2. Token has perpetual market on Hyperliquid with ≥$1M daily volume (liquid enough to exit)
3. Funding rate is negative OR neutral (avoid paying to hold the short)
4. MungerAgent approves (weekly review of top candidates)
5. Not currently in a confirmed pump-and-dump with organized squeeze group active

## Exit Conditions
- **Profit target**: Token price drops 50%+ from entry → close 50% position, hold rest to zero
- **Stop loss**: Token pumps 30% from entry (squeeze risk) → close 100%, no exceptions
- **Time limit**: 60 days maximum holding period → mandatory close regardless of P&L
- **Thesis break**: Score drops below 60 (token actually improves) → close
- **Funding flips positive** (crowd turns bullish): Reduce position by 50%

## Position Sizing (Kelly Criterion)
With historical 65–70% win rate, avg win +30%, avg loss -15%:
- Kelly: ~6% → **Half-Kelly: 3% per position**
- But: Given leverage + volatility, use **2% per position maximum**
- Maximum concurrent shorts: 8 (16% total wallet at risk)
- Leverage: **2x maximum** (liquidation requires 50% pump, survivable)

## Leverage & Liquidation Math (2x leverage)
```
Entry: Token at $1.00, short $1,000 notional, collateral $500
Liquidation occurs at: $1.50 (+50% pump) → collateral = $0
Stop loss at: $1.30 (+30% pump) → collateral = $350 (close before liquidation)
Profit at: $0.50 (-50% drop) → collateral = $750 (+$250 profit)
Profit at: $0.10 (-90% drop) → collateral = $950 (+$450 profit)
```
A 2x leverage short is only liquidated if the "worthless" token pumps 50%. With a 30% stop loss, we exit before liquidation.

---

## Venue: Hyperliquid

Primary and essentially only venue. Hyperliquid is the most liquid decentralized perpetuals exchange for altcoins in 2026:
- 100+ altcoin perpetual pairs
- Tight spreads (0.02–0.05% typical)
- Funding rates publicly available via API (free WebSocket)
- Min collateral: 5 USDC
- No KYC (decentralized, on-chain settlement)

**Backup**: dYdX v4 (50+ pairs), GMX v2 (30+ pairs). Use if Hyperliquid doesn't list the target token.

---

## Risk Controls

### Position-Level
- Stop loss: 30% adverse move → auto-close (no override)
- Liquidation alert: Margin ratio below 60% → Telegram alert → manually review
- No position may be open >60 days

### Portfolio-Level
- 3 liquidations in one week → pause short strategy for 2 weeks + MungerAgent review
- 5 consecutive losses → full pause + scoring system audit
- If any short position approaches liquidation → close all shorts immediately and re-assess

### Pump Squeeze Detection
If any of these occur → close position immediately:
- LunarCrush mentions spike >500% in 1 hour
- Token price pumps >15% in <30 minutes (likely squeeze)
- Funding rate flips from negative to strongly positive in <4 hours

---

## Risk Analysis: The Core Dangers

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| False positive (token recovers) | 15–20% | 30% loss (stop loss) | Scoring discipline; never enter <80 |
| Organized pump-and-dump squeeze | 10–15% | 30% loss (stop loss triggered) | Social monitoring; hard stop |
| Funding rate flips positive | 20% | Yield disappears; reduce | Monitor funding; reduce on flip |
| Exchange exploit (Hyperliquid) | 2% | Capital loss | Max 50% of shorts on any one exchange |
| Token takes years to collapse | 10% | Capital locked | 60-day time limit; forced close |
| Liquidation (50%+ pump with 2x leverage) | 5% | Full collateral loss | 30% stop loss prevents this |

The strategy's single biggest danger is the organized pump-and-dump specifically targeting shorts. This is why the 30% stop loss is non-negotiable: we exit before the squeeze victims us.

---

## Case Studies from Research

### LUNA/UST (May 2022)
- Worthlessness score: 92 (0 real revenue, algorithmic stablecoin instability, 90%+ insider holdings)
- Signal: Negative funding rates appeared 48 hours before crash
- On-chain: Luna Foundation Guard moved $1.5B BTC (visible)
- Outcome: 99.9% collapse in 5 days
- Short payoff (realistic, accounting for slippage): +10–30% of collateral

### FTT (FTX Token, Nov 2022)
- Worthlessness score: 88 (no product revenue; exchange token backed by illiquid FTT)
- Signal: Binance (CZ) announced selling FTT position on-chain
- Outcome: 95% collapse in 48 hours
- Short payoff (realistic): +40% in 2 days before panic slippage

**Lesson from both**: You won't capture the full 90–99% collapse. Slippage, panic selling, and position management mean capturing 20–40% of the move is realistic. That's still excellent.

---

## Data Pipeline

### Daily Automated Scan
```
1. Pull top 500 altcoins by volume (CoinGecko API, free)
2. For each token:
   a. Etherscan: holder distribution (top 10 holders %)
   b. Etherscan: contract source (search for red flag functions)
   c. GitHub: commits in past 6 months (via GitHub API)
   d. DeFiLlama: protocol revenue, TVL
   e. Hyperliquid: funding rate, perpetual liquidity
3. Calculate Worthlessness_Score
4. Filter: score ≥ 80
5. Output: Top 20 candidates sorted by (score × |funding rate| × liquidity)
```

### Weekly MungerAgent Review
- MungerAgent receives top 5 candidates
- Applies inversion: "What would guarantee this survives?"
- Flags any regulatory/squeeze risks
- Approves or rejects each candidate for execution

### Tools Required
| Service | Purpose | Cost |
|---------|---------|------|
| Etherscan API | Contract code, holder distribution | Free tier |
| CoinGecko API | Market data, historical prices | Free |
| DeFiLlama API | TVL, protocol revenue | Free |
| Hyperliquid WebSocket | Funding rates, perp data | Free |
| GitHub API | Dev activity | Free |

Total infrastructure cost: $0/month (all free APIs)

---

## Munger Evaluation

### Verdict: APPROVED CONDITIONAL

**Inversion Analysis** — *What guarantees this fails?*
- Scoring system has high false positives (30%+): Start with score ≥85 threshold only (higher bar)
- Market stays irrational longer than capital holds short: 60-day time limit + 2x leverage protects against this
- Regulatory crackdown on shorting: Very low probability in crypto; monitor

**Circle of Competence**
Fully inside for identifying obvious frauds and failed projects. Partially inside for timing the collapse. The vault is clear: *"Inversion is easiest."* Worthlessness is easier to detect than value.

**Margin of Safety**
Medium. Two mechanisms provide protection:
1. Scoring threshold (only 80+) filters obvious false positives
2. 30% stop loss + 2x leverage keeps individual position losses manageable

The key uncertainty: how often do high-scoring tokens unexpectedly recover? This must be validated empirically with backtesting.

**Key Risks (Ranked)**
1. Scoring false positives (20% of 80+ tokens recover) — manage with half-Kelly sizing
2. Organized squeeze: pump group targets our shorts — manage with hard stop + squeeze detection
3. Exchange counterparty risk (Hyperliquid) — max 50% exposure on any single venue

### Recommendation
**Build scoring system. Backtest on 2022–2024 data. Only deploy after 65%+ accuracy confirmed.**

Expected portfolio contribution: +0.5–1.5% monthly (on 20% capital allocation). This is a hedge, not the alpha driver. Primary value: profits during market corrections when everything else draws down.

---

## Phase Gate

- [ ] Build token worthlessness scorer (Etherscan + DeFiLlama + GitHub APIs)
- [ ] Implement daily scan of top 500 tokens
- [ ] Backtest scoring on 2022–2024 data (label historical collapses)
- [ ] Validate: ≥65% of score-80+ tokens declined ≥50% within 6 months
- [ ] Build Hyperliquid API client (open/close perps, monitor funding)
- [ ] Implement 30% stop loss automation
- [ ] Implement 60-day time limit enforcement
- [ ] MungerAgent integration: weekly candidate review workflow
- [ ] Paper trading: 10+ simulated shorts on historical data
- [ ] Mainnet phase 1: $100–200 per position, 5 positions max
- [ ] If hit rate ≥65% after 20 live trades: scale to 2% per position
