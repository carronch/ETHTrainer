# Playbook: Polymarket Information Edge

**Status:** Research
**Munger verdict:** APPROVED (conditional — requires validated edge before capital deployment)
**Confidence:** 0.55

---

## What
Place binary prediction market bets on Polymarket (Polygon) where our AI agent has a measurable
information advantage over the crowd. Focus on markets where on-chain data signals the outcome
before the crowd reacts.

## Why It Works
Polymarket uses AMM pricing — odds are set by betting volume, not a bookmaker. Crowds are slow
and emotional. An AI agent monitoring Ethereum mempool, whale wallets, exchange flows, and
governance events in real-time can detect signals 5–60 minutes before the crowd updates its
probability estimate. That gap is the edge.

The Lollapalooza of AI advantages:
- Information speed (100ms vs 30–60 min for humans)
- No emotional bias (no revenge trading, no FOMO)
- 24/7 execution (never misses an event at 3 AM)
- Multi-market monitoring (100+ markets simultaneously)
- Systematic backtesting (validates edge before deploying capital)

## Entry Conditions
1. ResearcherAgent identifies a specific on-chain signal correlated with a Polymarket outcome
2. Signal has been backtested with >60% predictive accuracy over at least 30 historical events
3. Target market has >$500k TVL (sufficient liquidity, <3% slippage)
4. Expected edge > total friction (bridge + AMM spread + fees = ~5%)
5. Minimum implied edge per trade: 8% (double the friction cost as safety margin)

## Exit Conditions
- Hold to resolution (binary market — no active exit unless early exit is favorable)
- Early exit if: new information invalidates the original thesis before resolution
- Auto-exit if market odds move > 20% against position (thesis invalidated)

## Position Sizing — Kelly Criterion
- Per-position risk: 1.5% of Polygon trading capital (half-Kelly for safety)
- Maximum concurrent positions: 8 (total risk: 12% of Polygon capital at any time)
- Never exceed 2% on any single position regardless of confidence

## Capital Architecture
```
Ethereum trading wallet (ETH)
    ↓ weekly (Uniswap swap)
USDC on Ethereum
    ↓ bridge to Polygon (weekly batch)
USDC on Polygon (Polymarket capital)
    ↓ positions (Kelly-sized)
Winnings accumulate on Polygon
    ↓ weekly bridge back to Ethereum
ETH in trading wallet → treasury sweep
```

## Gas / Friction Budget
- Bridge cost: ~$5–10 per round trip (batch weekly to amortize)
- Polygon tx cost: ~$0.01–0.50 (negligible)
- AMM spread: 2–4% (included in edge calculation)
- Minimum net edge required after all friction: 3%

## Target Market Categories (in priority order)

### 1. Crypto price-correlated markets (highest AI edge)
- "Will ETH be above $X on date Y?"
- Signal: exchange inflows/outflows, whale movements, funding rates
- Typical edge window: 30–60 minutes ahead of price move

### 2. DeFi governance outcomes
- "Will Aave proposal X pass?"
- Signal: on-chain vote tally before market reprices
- Edge: vote counts are public but slow to be priced in

### 3. Protocol event markets
- "Will protocol X get exploited?" / "Will upgrade deploy by date X?"
- Signal: GitHub commits, governance forums, security researcher alerts
- Edge: technical signal detection before general market awareness

### 4. Long-tail markets (illiquid but high edge)
- Niche markets where crowd is essentially guessing
- Expected mispricing: 15–30%
- Risk: thin liquidity limits position size to $100–300

## Regulatory Risk — Munger Flag
Polymarket operates in a CFTC gray zone. A shutdown would freeze active positions.
**Hard rule:** Never have more than 15% of total trading capital on Polygon at any time.
Frequent weekly sweeps back to Ethereum reduce exposure window.

## Backtesting Requirements
- Pull Polymarket historical market data from The Graph (Polygon)
- For each signal type, backtest predictive accuracy over minimum 30 events
- Validate that edge survives friction costs in simulation
- Minimum bar: >60% win rate AND >8% expected edge before going live

## Munger Evaluation

### Verdict: APPROVED (conditional)

### Inversion Analysis
*What guarantees this fails?*
- CFTC shuts down Polymarket → hard 15% capital cap mitigates this
- Information edge evaporates (other agents find the same signals) → continuous backtesting and edge monitoring
- Overfit backtest (we fooled ourselves with data mining) → hold out test set, walk-forward validation
- Bridge fails during volatility → only bridge during calm periods, keep bridge amounts small
- Oracle resolves market incorrectly → only trade on Chainlink-settled markets with clean resolution history

### Circle of Competence
Partially inside. We understand on-chain data and can process it faster than humans.
We do NOT yet have validated edges — this is still research phase. The vault is clear:
*"What's my track record? Have I been right about similar things before?"*
Answer: Not yet. This is why the edge must be backtested before any capital is deployed.

### Margin of Safety
Current margin of safety is LOW — we don't have proven edges yet. The conditional approval
means: **research and backtest first. Zero capital until we have a validated, statistically
significant edge (>30 events, >60% win rate).**

### Key Risks (ranked)
1. Regulatory shutdown of Polymarket (non-zero, ~10% probability in next 2 years)
2. Edge decay (as AI trading becomes common, crowd becomes smarter)
3. Backtest overfitting — seeing pattern that doesn't exist in forward trading

### Recommendation
This is a **NEEDS MORE RESEARCH → APPROVED** situation. The theoretical case is strong.
The AI edge is real. But we must validate specific signals before deployment. Run the
ResearcherAgent on Polymarket historical data. Find 2–3 repeatable signal → outcome
correlations. Only deploy capital after those are validated.

---

## Phase Gate to Testnet
- [ ] At least 2 validated signal → outcome correlations (>30 events each, >60% accuracy)
- [ ] Bridge mechanics tested on Polygon Mumbai (testnet)
- [ ] Position sizing engine built (Kelly Criterion implementation)
- [ ] Regulatory risk acknowledged and 15% capital cap enforced in code
- [ ] Munger re-evaluates with actual backtest numbers
