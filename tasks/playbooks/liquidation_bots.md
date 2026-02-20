# Playbook: Liquidation Bots

**Status:** Research → Backtesting
**Munger verdict:** APPROVED
**Confidence:** 0.70

---

## What
Monitor lending protocol health factors (Aave v3 on Ethereum and L2s). When a position drops below
the liquidation threshold (health factor < 1), execute the liquidation using a flash loan, seize
the collateral discount (5–15%), repay the debt, pocket the spread.

## Why It Works
The edge is **deterministic and calculable before execution**. Unlike MEV sandwich attacks where
you race against professionals in microseconds, liquidations trigger at a known on-chain condition
(health factor < 1). You know the exact profit before submitting the transaction. This is the
"fat pitch" — you only swing when the math works.

## Entry Conditions
1. Target position health factor drops below 1.0 (monitored via Aave's `getUserAccountData`)
2. Liquidation bonus ≥ 5% (Aave default) on the seized collateral
3. Estimated profit (bonus × collateral) MINUS gas cost > 0.005 ETH minimum
4. No competing liquidation tx already in mempool for same position

## Exit Conditions (single-block operation)
- Flash loan repaid in same tx → no open position to exit
- If tx reverts: log failure, update gas estimate, skip for 2 blocks

## Position Sizing
- Flash loan covers 100% of debt repayment → zero capital at risk for the bet
- Gas buffer: maintain 0.1 ETH minimum in trading wallet for gas
- Max gas per liquidation attempt: 0.02 ETH (reject if estimated cost higher)

## Gas Budget
- Estimated gas per liquidation: 600k–1.2M gas
- At 20 gwei: 0.012–0.024 ETH per attempt
- Only attempt if bonus > gas × 3 (3× buffer for safety)

## Risk Controls
- Never attempt on positions < $500 collateral (gas eats all profit)
- Skip if mempool shows competing liquidation tx for same position
- Skip if gas price > 50 gwei (wait for lower)
- Circuit breaker: if 3 consecutive failed tx → pause 1 hour, alert Telegram

## Target Protocols (by priority)
1. **Aave v3 Ethereum mainnet** — largest TVL, most liquidations
2. **Aave v3 Arbitrum** — lower gas, growing TVL, less competition
3. **Aave v3 Optimism** — same as Arbitrum
4. **Compound v3** — secondary target

## Backtesting Requirements
- Pull Aave liquidation events for last 90 days from The Graph
- Calculate: profit per event, gas cost, net profit
- Key metrics to validate: win rate, avg net profit/trade, max drawdown
- Minimum bar to proceed: >70% win rate, avg net > 0.005 ETH after gas

## Munger Evaluation

### Verdict: APPROVED

### Inversion Analysis
*What guarantees this fails?*
- Gas spike during high volatility eats all profit → gas limit enforced
- Protocol exploit drains Aave → diversify across protocols, monitor TVS
- Faster bots outcompete on every event → focus on smaller positions (<$10k) where big bots don't bother
- Smart contract bug in our liquidation contract → audit before mainnet

### Circle of Competence
We understand this well enough. Aave liquidation mechanics are fully documented. The math is
simple and verifiable. Health factor is a deterministic on-chain variable — no prediction needed.
This is adjacent to our competence and can be expanded carefully.

### Margin of Safety
Flash loan design means we put zero principal at risk per trade. We only pay gas if we attempt.
The only way to lose principal is through a smart contract bug or Aave exploit. Both are
mitigated by using audited protocols and keeping trading wallet at minimum floor.

### Key Risks (ranked)
1. Competition density — professional liquidation bots exist and are fast
2. Gas spikes during exact moments we need to liquidate (high volatility = expensive blocks)
3. Aave smart contract exploit (historically never happened at protocol level)

### Recommendation
Start on Arbitrum (lower gas, growing TVL, less competition than mainnet). Build and backtest
for 2 weeks. Deploy to testnet. Only go mainnet after 30+ successful simulated liquidations.

---

## Implementation Notes
- Use `viem` to call `getUserAccountData(address)` across a watchlist of positions
- Build position watchlist by monitoring Aave `Borrow` events (new borrowers)
- Flash loan provider: Aave itself (`flashLoan` on the Pool contract)
- Liquidation call: `liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)`
- Keep a local SQLite cache of monitored positions (avoid re-fetching all borrow events each block)

## Phase Gate to Testnet
- [ ] Backtest shows >70% win rate over 90 days of Aave data
- [ ] Positive expected value after gas (avg net > 0.005 ETH)
- [ ] Smart contract written and audited (even lightweight internal review)
- [ ] Munger re-approves after seeing backtest numbers
