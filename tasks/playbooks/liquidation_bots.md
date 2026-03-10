# Playbook: Liquidation Bots (Aave v3 Arbitrum)

**Status:** Implementation complete — pending Hetzner deployment
**Munger verdict:** APPROVED
**Confidence:** 0.70
**Architecture:** Rust executor (Layer 1) + TS Autoresearch (Layer 2)

---

## What

Monitor Aave v3 health factors on Arbitrum. When a position drops below the liquidation threshold (health factor < 1), execute the liquidation using a flash loan: seize the collateral at a 5–15% discount, repay the debt, pocket the spread — all in one atomic transaction.

## Why It Works

The edge is **deterministic and calculable before execution**. Unlike MEV sandwich attacks where you race professionals in microseconds, liquidations trigger at a known on-chain condition (health factor < 1). You know the exact profit before submitting. This is the "fat pitch" — swing only when the math works.

Flash loans mean **zero principal at risk per trade**. If the tx reverts, only gas is lost. The only path to losing principal is a smart contract bug or Aave exploit.

## Architecture (v2)

```
Rust Executor (always-on, no LLM)
  event_listener.rs     — seeds borrower watchlist from Borrow events
  health_scanner.rs     — batch-polls health factors via multicall
  opportunity_ranker.rs — computes net profit, ranks opportunities
  tx_submitter.rs       — pre-flight eth_call → sign → submit
  missed_tracker.rs     — logs every liquidation we didn't win
    ↓ SQLite (missed_opportunities table)
TS Autoresearch (nightly 2am UTC)
  collector.ts          — reads unanalyzed missed opps
  anvil_simulator.ts    — forks Arbitrum, replays misses with param variants
  parameter_compiler.ts — Claude analyzes → proposes new heuristic_params.json
  shadow_evaluator.ts   — validates: ≥0.5% improvement required to apply
```

## Entry Conditions

1. Position health factor < 1.0 (via `AavePool.getUserAccountData`)
2. Liquidation bonus ≥ 5% on seized collateral (Aave default)
3. Estimated net profit (bonus × collateral − gas cost) > `min_profit_eth` (from heuristic_params.json)
4. Pre-flight `eth_call` simulation succeeds
5. Gas price ≤ `max_gas_gwei` (from heuristic_params.json)

## Exit Conditions

Single-block atomic operation — flash loan repaid in same tx. No open position to manage.

If tx reverts: log failure, circuit breaker counts toward limit.

## heuristic_params.json (runtime parameters)

Written by autoresearch, read by Rust executor. Hot-reloaded without restart.

```json
{
  "max_gas_gwei": 1.0,
  "min_profit_eth": 0.005,
  "hf_alert_threshold": 1.08,
  "scan_interval_ms": 15000,
  "max_flash_loan_eth": 50.0,
  "circuit_breaker_threshold": 5,
  "circuit_breaker_cooldown_secs": 3600,
  "version": 1,
  "rationale": "Initial seed from historical Aave v3 Arbitrum data"
}
```

Parameters improve automatically each night via the autoresearch loop. Small consistent improvements compound (Munger principle).

## Risk Controls

- **Pre-flight simulation**: `eth_call` before every tx — if it would revert, skip
- **Profitability re-check**: re-query HF just before submission (conditions change fast)
- **Gas cap**: skip if gas > `max_gas_gwei`
- **Min size**: skip positions < $500 collateral (gas eats profit)
- **Circuit breaker**: N consecutive failures → cooldown period, Telegram CRITICAL alert
- **No principal risk**: flash loans are atomic — revert = only gas lost

## Target Protocols (by deployment order)

1. **Aave v3 Arbitrum** — lower gas, growing TVL, less competition ← live first
2. **Radiant Capital (Arbitrum)** — same Rust pattern, different contract addresses ← Phase 3
3. **Aave v3 Base + Optimism** — same contract addresses, different RPC ← Phase 3

## Autoresearch — What It Learns

Every missed liquidation is a training data point. For each miss:

```
Missed because gas too low?
  → Raise max_gas_gwei toward winner's gas price

Missed because we weren't watching?
  → Lower hf_alert_threshold (detect earlier)

Missed because scan too slow?
  → Lower scan_interval_ms

Win rate good, but missing small positions?
  → Lower min_profit_eth threshold
```

The nightly Anvil fork simulations replay each miss with param variants to find what would have won. Claude compiles findings into a new params proposal. Shadow evaluation against 7-day history decides if it's applied.

## Gas Budget

```
Estimated gas per liquidation: 600k–1.2M gas units
At 1 gwei base fee (Arbitrum typical): ~0.0006–0.0012 ETH per attempt
At 5 gwei: ~0.003–0.006 ETH per attempt
```

Only attempt if `estimated_profit > min_profit_eth`. The autoresearch loop tunes this threshold.

## Deployment Gate (v2)

- [x] Rust executor built + unit-tested
- [x] TS autoresearch layer built
- [x] LiquidationBot.sol written
- [ ] 72h Anvil fork validation (no crashes, detects positions, correct math)
- [ ] 72h shadow mode (competitive capture rate vs on-chain events)
- [ ] Go live on Arbitrum

## Munger Evaluation

### Verdict: APPROVED

### Inversion
*What guarantees this fails?*
- Gas spikes during high volatility eat all profit → gas cap enforced; autoresearch tunes it
- Faster bots outcompete us on every event → focus on smaller positions (<$10k) where large bots ignore
- Smart contract bug in LiquidationBot.sol → pre-flight eth_call + contract audit before mainnet
- Aave protocol exploit → risk is real but historically has never happened at protocol level; diversify later

### Circle of Competence
Aave liquidation mechanics are fully documented and well-understood. Health factor is a deterministic on-chain variable — no prediction needed. Math is simple and verifiable.

### Margin of Safety
Flash loan design = zero principal at risk per trade. Trading wallet floor = 0.5 ETH minimum always maintained. Circuit breaker = automatic cooldown after consecutive failures.

### Key Risks (ranked)
1. Competition density — professional bots exist and are fast (mitigated by smaller positions)
2. Gas spikes during volatility spikes (exact moment we need to liquidate)
3. Aave smart contract exploit (historically never happened)
