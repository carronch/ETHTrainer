# Playbook: Derivatives / Delta-Neutral Funding Arbitrage + Cascade Detection

**Status:** Backtesting needed before capital deployment
**Munger verdict:** APPROVED (delta-neutral unconditional) / BACKTEST FIRST (cascade detection)
**Confidence:** 0.75 (delta-neutral) / 0.45 (cascade)

---

## Strategy Overview

Two complementary strategies using perpetual derivatives markets:

1. **Delta-Neutral Funding Arbitrage** — Buy spot ETH + short ETH perp simultaneously. Price-neutral (delta = 0). Collect funding rate as yield. 20–30% annual return with <1% liquidation risk.
2. **Liquidation Cascade Detection** — Detect when cascading liquidations are forming. Short at the top, cover at capitulation bottom. 50–100% return per successful cascade, but 30–40% false signal rate.

---

## Strategy 1: Delta-Neutral Funding Arbitrage

### What
Hold equal long spot ETH + short ETH perpetual. The two positions cancel out price risk. Net position is delta-zero. Funding rates (paid by longs to shorts when longs dominate) become pure yield.

### Why It Works
When ETH is in bull mode, longs outnumber shorts → funding rates go positive → shorts earn 0.03–0.08% per 8-hour period = 9–30% annualized. No prediction needed. Just collect the spread.

Historical funding rates on dYdX/Hyperliquid: positive 80%+ of days in 2024–2025.

### Entry Conditions
- Funding rate > 0.02% per 8 hours (>9% annualized, above gas cost threshold)
- Check: dYdX, GMX, Hyperliquid simultaneously — use the highest payer
- Minimum capital to make it worthwhile: $5k (gas amortization)

### Exit Conditions
- Funding rate flips negative (shorts now pay longs) → close immediately
- Liquidation margin ratio drops below 50% → reduce position
- Better opportunity requires the capital

### Position Sizing
- Spot ETH: Up to 30% of trading wallet above 0.5 ETH floor
- Perp short: Equal notional to spot position (leverage 5x, collateral = 20%)
- Liquidation price: 20% below entry (5x leverage) — spot offsets this loss

### Gas Budget
- Entry: spot swap + perp open = ~$10–20 total
- Exit: perp close + spot sell = ~$10–20 total
- Batch entries monthly; don't open/close small positions

### Risk Controls
- Hard max leverage: 5x (liquidation at -20% of entry price)
- Monitor funding every 4 hours — alert if funding goes negative
- Liquidation alert: if margin ratio drops below 60%, reduce position by 50%
- Max capital in any single exchange: 50% (counterparty risk)
- If funding goes negative for 48+ hours: close fully

### Execution Flow
```
1. Buy ETH on Uniswap (spot, trading wallet)
2. Open SHORT on dYdX/Hyperliquid (equal notional, 5x leverage)
3. Monitor every 4 hours: funding rate + liquidation distance
4. Collect funding automatically (credited per 8-hour epoch)
5. Exit when: funding negative, or capital needed for liquidation opportunity
```

### Expected Returns
| Capital | Leverage | Annual Yield | Monthly Cash Flow |
|---------|----------|--------------|------------------|
| $20k | 5x | 20–30% | $330–500 |
| $50k | 5x | 20–30% | $833–1250 |

### Venues (Priority Order)
1. **Hyperliquid** — best liquidity, 100+ pairs, tight spreads
2. **dYdX v4** — established, decentralized, 50+ pairs
3. **GMX v2** — Arbitrum, lower gas, real liquidity pools

---

## Strategy 2: Liquidation Cascade Detection

### What
Detect when a mass liquidation cascade is forming (large clusters of leveraged long positions near liquidation prices). Short into the cascade, cover at capitulation bottom.

### Why It Works
Cascading liquidations are mechanical: overleveraged positions get auto-liquidated, forcing more selling, liquidating more positions, cascading down 15–25% in 30–90 minutes. The pattern is visible on-chain before it happens.

### Pre-Cascade Signals (4–24 hours before)
1. **OI Clustering**: >200k notional in longs with liquidation prices within 3% band
2. **Funding spike**: >0.05% per 8h (longs getting desperate, paying premium)
3. **OI skew**: Longs >70% of total open interest
4. **Exchange inflows**: >$100M net inflow in one day (whale positioning to sell)

### Live Cascade Signals (Real-time)
1. **Liquidation velocity**: >5 liquidation events per minute on GMX (cascade confirmed)
2. **Order book collapse**: Bid-ask spread widens from 0.1% → 1–2%
3. **Price velocity**: >5% down in <5 minutes
4. **RSI**: 30-min RSI < 20 (extreme oversold)

### Bottom Formation Signals
1. **Liquidation velocity decays**: <1 liquidation per minute
2. **Bid depth recovering**: Order book refills, spread tightens back to <0.3%
3. **Price reversal**: 2%+ bounce after 15+ minutes of continuous decline

### Position Sizing
- Per cascade trade: 1–2% of trading wallet max (this is a speculative trade)
- Leverage: 5x maximum
- Stop loss: +5% move against you (hard auto-close)
- Max 1 cascade position open at any time

### Risk Controls
- False signal rate: ~40% — most pre-cascade signals don't cascade
- Only trade on 3+ confirming signals simultaneously
- Hard daily P&L limit: -2% of total capital → stop all cascade trading
- Maximum 3 cascade attempts per day

### Backtesting Requirements
- Pull 6 months of GMX liquidation events from The Graph
- Pull dYdX settlement events
- Label historical cascades (>10% down in <2 hours with liquidation velocity >5/min)
- Minimum success bar: >50% win rate, avg profit >0.3% per cascade trade
- If backtest fails: Do not deploy — this strategy gets shelved

### Phase Gate
- [ ] Backtest on 6 months of GMX/dYdX liquidation data
- [ ] Win rate >50% confirmed
- [ ] Average profit per cascade >0.3%
- [ ] Munger re-reviews backtest numbers before mainnet

---

## Munger Evaluation

### Delta-Neutral: Verdict: APPROVED (unconditional)

**Inversion Analysis** — *What guarantees this fails?*
- Funding rates stay negative for months: Close the trade. This would be unusual; historically 80%+ positive.
- Exchange exploit: Counterparty risk. Mitigated by max 50% on any one exchange.
- Smart contract bug in perp exchange: Use audited venues (dYdX, Hyperliquid).
- Liquidation during flash crash: Spot hedge covers principal. True loss limited to collateral on the perp side.

**Circle of Competence**: Fully inside. Funding rate arbitrage is mechanical, well-documented, and requires no predictions. The math is simple and auditable.

**Margin of Safety**: HIGH. Delta-neutral design means ETH price movement doesn't matter. Risk is funding rate going negative (rare, quickly detectable) and exchange counterparty risk (mitigated by diversification).

### Cascade Detection: Verdict: BACKTEST FIRST

**Inversion Analysis** — *What guarantees this fails?*
- False signals (40% rate): Trade, price recovers, you're stopped out. Small position sizing limits damage.
- Cascade starts but reverses before bottom: Stop loss triggered. Painful but survivable.
- High gas/slippage during cascade: Execution risk. Mitigate with limit orders near cascade zones.

**Circle of Competence**: Partially inside. On-chain signal detection is within competence. Timing the exact cascade bottom is genuinely hard. Risk: 2/10 if signals are real. Risk: 7/10 if signals are weak.

**Margin of Safety**: LOW until backtested. Must validate >50% win rate over real cascade data before capital touches this.

---

## Implementation Notes

### Delta-Neutral
- Spot purchase: Use Uniswap v3 or direct ETH (already in wallet)
- Perp short: `POST /order` on Hyperliquid API (market or limit)
- Funding monitoring: Poll `GET /meta` from Hyperliquid every 4 hours
- P&L tracking: Log to SQLite every epoch (8 hours)

### Cascade Detection
- GMX liquidation events: Subscribe to `LiquidationCall` events on GMX v2 (Arbitrum)
- Liquidation velocity calculator: Count events per rolling 60-second window
- OI clustering: Pull position data from GMX Reader contract or The Graph
- Alert threshold: 5+ liquidations/min → arm cascade bot

### Data Sources
- Hyperliquid API: Funding rates, position data (free WebSocket)
- GMX The Graph: Historical liquidations, OI data (free)
- dYdX Indexer: Position data, funding rates (free)

---

## Phase Gate to Mainnet

### Delta-Neutral (ready after infrastructure built):
- [x] Research validates funding rates are historically positive
- [ ] Implement dYdX/Hyperliquid REST client
- [ ] Backtest 90 days of historical funding rate data (expected: trivially positive)
- [ ] Testnet dry-run for 2 weeks
- [ ] Deploy mainnet with $20k initial capital

### Cascade Detection:
- [ ] Build GMX liquidation event listener
- [ ] Backtest 6 months of cascade events
- [ ] Win rate >50%, avg profit >0.3% confirmed
- [ ] Munger re-approves
- [ ] Testnet simulation for 4+ weeks
- [ ] Mainnet with $500 per trade max
