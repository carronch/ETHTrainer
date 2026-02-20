# Playbook: Lido stETH — Idle Capital Yield

**Status:** SAVINGS ACCOUNT — always-on background yield, not a strategy
**Munger verdict:** APPROVED (unconditionally)
**Confidence:** 0.90 — irrelevant, this is infrastructure not alpha

---

## What
Any ETH in the trading wallet not actively deployed in a liquidation or Polymarket position
is staked in Lido stETH. stETH accrues Ethereum staking rewards automatically (~3.8% APY).
This is a pure "capital at rest" optimization — every idle ETH earns yield rather than sitting
dormant.

## Why It Works
This is not a strategy. It is a **system property**. Staked ETH earns the base Ethereum
staking rate automatically. No decisions required. No execution risk. No information edge
needed. The only question is: is 3.8% better than 0%? Yes.

Munger's Compound Interest model: "The most powerful force in the universe." Even 3.8%
compounded on idle capital materially accelerates treasury growth over time.

## Entry Conditions
- Any ETH above the 0.5 ETH floor in the trading wallet that is not committed to an active strategy
- Deposit when idle balance > 0.1 ETH (below this, gas cost not worth it)

## Exit Conditions
- Unstake when capital is needed for a liquidation or Polymarket opportunity
- Lido supports instant unstaking via stETH → ETH on Curve/Uniswap (minor slippage)
- RiskManagerAgent triggers exit if Lido protocol risk rises significantly

## Position Sizing
- 100% of idle trading capital above 0.5 ETH floor
- Always maintain 0.5 ETH unwrapped for gas and immediate liquidation opportunities

## Gas Budget
- Deposit gas: ~50k gas (~0.001 ETH at 20 gwei) — one-time cost per deposit batch
- Withdrawal gas: ~100k gas via Curve swap — only when needed
- Batch deposits weekly: don't stake/unstake for tiny amounts

## Risk Controls
- Hard cap: never stake >80% of trading wallet in Lido at once (liquidity buffer)
- Monitor Lido TVS and operator concentration monthly
- If any Lido security incident → exit to ETH within 24 hours
- Do NOT stake treasury wallet ETH — treasury cold wallet stays cold

## Munger Evaluation

### Verdict: APPROVED (unconditional)

### Inversion Analysis
*What guarantees this fails?*
- Lido smart contract exploit: Has never happened in 4+ years. Audited by Trail of Bits,
  ConsenSys, Quantstamp. Risk: 3/10.
- Lido validator slashing: Distributed across hundreds of operators. Would need majority slashing
  to materially affect stETH price. Risk: 2/10.
- stETH depeg from ETH: Happened briefly in 2022 (LUNA crash). Recovered fully. Instant
  liquidity via Curve. Risk: 2/10 for temporary depeg, near-0 for permanent.

### Circle of Competence
Fully inside. Lido is the simplest DeFi protocol — deposit ETH, receive stETH, rewards accrue.
No active management. No predictions. This is the definition of staying within the circle.

### Margin of Safety
Very high. The protocol has a 4-year track record, $30B+ TVL, multiple audits, and no exploits.
The yield is predictable (Ethereum base staking rate). This is as close to a riskless yield
as DeFi offers.

### Key Risks (ranked)
1. Lido smart contract exploit (low probability, mitigated by protocol track record)
2. Regulatory action against liquid staking (non-zero but Lido is compliant-oriented)
3. Ethereum staking yield drops significantly (reduces APY but doesn't threaten principal)

### Recommendation
**Deploy immediately** once trading wallet is funded. This is a background optimization,
not a strategy decision. No further research needed.

---

## Implementation Notes
- Use Lido's `submit(referral)` function (address: `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`)
- stETH balance auto-increases each day (no claim needed)
- To exit: swap stETH → ETH on Curve (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`)
- Monitor stETH/ETH peg daily via Curve pool price
- Add `lido_balance_eth` to RiskManagerAgent's daily status report

## Phase Gate
- [x] No additional backtesting required
- [x] Protocol is battle-tested
- [ ] Implement `stakeLido(amount)` and `unstakeLido(amount)` in ExecutorAgent
- [ ] Add stETH balance to wallet status tool
- [ ] RiskManagerAgent monitors stETH/ETH peg
