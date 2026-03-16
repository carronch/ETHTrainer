# Lessons Learned

Claude updates this after every correction from the user.
Purpose: prevent the same mistake from happening twice.

## How to use

- After any correction: add an entry below with the pattern + the rule
- Review this file at the start of each session
- These rules are project-specific and override defaults

## Format

### [short description of mistake]
**What happened:** brief description
**Root cause:** why it happened
**Rule:** the specific rule to follow next time

---

## Lessons

### Never sign commits with "Co-Authored-By: Claude"
**What happened:** Auto-signed commits with Claude co-author tag.
**Root cause:** Default commit template includes co-author.
**Rule:** Never add Co-Authored-By to commits in this project. User explicitly requested this.

### Don't treat Lido as a primary strategy
**What happened:** Initially listed Lido as strategy #1 in deployment order.
**Root cause:** Classified it alongside real alpha strategies.
**Rule:** Lido is background infrastructure (savings account), not a strategy. It runs silently on idle ETH. Never put it in the strategy pipeline table or deployment priority list.

### X/Twitter trending has negative expected value — never deploy
**What happened:** Research initially considered X trending as a viable signal.
**Root cause:** Theoretical case seemed plausible.
**Rule:** X/Twitter trending alone = -1% EV per trade. Permanently rejected. Do not reconsider without a major structural change (e.g., exclusive API access with <1s latency). Whale on-chain copy-trading (10-15 min lag) is the viable alternative.

### node:sqlite instead of better-sqlite3
**What happened:** better-sqlite3 failed to compile on Node.js 24 (C++20 issue).
**Root cause:** Native module compilation incompatibility.
**Rule:** Always use `node:sqlite` (built-in Node.js 22+). No native dependencies for SQLite.

### Use .cjs extension for hardhat config in ESM projects
**What happened:** Hardhat config needs to be CommonJS, but package.json has "type": "module".
**Root cause:** ESM projects treat all .js files as ESM.
**Rule:** Name the hardhat config `hardhat.config.cjs` in projects with `"type": "module"` in package.json.

### Read files before Write tool
**What happened:** Write tool failed on existing files that hadn't been Read first.
**Root cause:** Write tool requires prior Read of existing files.
**Rule:** Always Read a file before using Write or Edit on it. Use Edit for modifications, Write only for new files or full rewrites after Reading.

### Arbitrum is the primary liquidation bot target, not mainnet
**What happened:** N/A — learned from research phase.
**Root cause:** N/A.
**Rule:** Liquidation bot runs on Arbitrum (lower gas, less competition per playbook). Ethereum mainnet is secondary. Always use `ARBITRUM_RPC_URL` and `arbitrum` chain for liquidation strategy code.

### Fetch ethskills security module before writing contract interaction code
**What happened:** CLAUDE.md requires this; skipping it risks introducing vulnerabilities.
**Root cause:** Security module documents known Solidity attack patterns (reentrancy, oracle manipulation, etc.).
**Rule:** Before writing ANY Solidity or contract-interaction TypeScript, fetch https://ethskills.com/security/SKILL.md and apply its patterns:
  - Use SafeERC20 for all token operations
  - Verify msg.sender in flash loan callbacks
  - Only approve necessary amounts (not infinite)
  - Use amountOutMinimum in Uniswap swaps (slippage protection)
  - Follow Checks-Effects-Interactions pattern

### LiquidationBot contract key design decisions
**What happened:** N/A — captured for future reference.
**Root cause:** N/A.
**Rule:** When modifying LiquidationBot.sol:
  - `flashLoanSimple` (not `flashLoan`) — only one asset at a time, cleaner
  - Pass `amount` (the flash loan size) as `debtToCover` in `liquidationCall` — NEVER `type(uint256).max`. Using max causes `ERC20: insufficient allowance` because Aave tries to pull up to the close factor which can exceed the flash loan amount. The Rust executor calculates the correct amount before calling the contract.
  - `executeOperation` must verify `msg.sender == pool` AND `initiator == address(this)`
  - Use `forceApprove` (SafeERC20) not `approve` — handles non-standard tokens like USDT
  - No deadline in Uniswap SwapRouter02 (it was removed; use SwapRouter02 not SwapRouter)
  - Profit accumulates in contract; owner calls `withdraw()` separately
  - Profit check underflow guard: use `debtBalance > repayment ? debtBalance - repayment : 0` as the `got` arg in `InsufficientProfit` — prevents Solidity 0.8 arithmetic panic (0x11) from masking the real revert reason when debtBalance < repayment

### v2 architecture — no flash loan cap
**What happened:** N/A — captured from planning phase.
**Root cause:** N/A.
**Rule:** Do NOT add a flash loan size cap. Flash loans are atomic — if the tx reverts, only gas is lost, never principal. A cap limits upside with zero reduction in downside risk. Real protection comes from: pre-flight eth_call + profitability check in the contract + circuit breaker.

### v2 architecture — autoresearch improvement threshold is 0.5%, not 5%
**What happened:** N/A — deliberate design choice.
**Root cause:** Charlie Munger compounding principle.
**Rule:** The shadow_evaluator.ts `MIN_IMPROVEMENT_PCT` is 0.5%. Small consistent edges compound aggressively. Do not raise this threshold without strong evidence it's generating false positives.

### v2 architecture — Rust for hot path, TS only for autoresearch brain
**What happened:** v1 used TypeScript for everything including the execution layer.
**Root cause:** TS adds latency and LLM calls have no place in a liquidation hot path.
**Rule:** Layer 1 (Rust executor) is LLM-free. It reads heuristic_params.json and acts deterministically. Layer 2 (TS autoresearch) runs nightly and is the only layer that calls Claude. Never add LLM calls to the Rust executor.

### macOS Keychain does not exist on Linux (Hetzner)
**What happened:** Original CLAUDE.md described storing the keystore password in macOS Keychain.
**Root cause:** Development was on Mac Mini; Hetzner server runs Ubuntu.
**Rule:** On Hetzner (Linux), use `.dev.vars` with `chmod 600` for the `KEYSTORE_PASSWORD` env var. No macOS Keychain. The keystore file lives at `~/.ethtrainer/keystore.json` (outside the repo).

### HeuristicParams cast to Record<string,unknown> needs double-cast
**What happened:** TypeScript error: `Conversion of type 'HeuristicParams' to type 'Record<string, unknown>' may be a mistake`.
**Root cause:** TS won't directly cast a typed interface to an index signature type.
**Rule:** Use `as unknown as Record<string, unknown>` (double cast) when you need to iterate over a typed interface's keys. This is intentional and correct — don't suppress with `@ts-ignore`.

### Rust liquidator has no --live flag — absence of --shadow IS live mode
**What happened:** Instructed user to change `--shadow` to `--live` in systemd service. Binary rejected `--live` as unknown argument, causing a crash loop.
**Root cause:** Assumed symmetrical flags (`--shadow` / `--live`). The actual CLI only has `--shadow` (boolean flag). Without it, the binary runs in live mode by default.
**Rule:** To go live: remove `--shadow` from ExecStart. Do NOT add `--live`. Correct ExecStart: `liquidator --chain arbitrum` (no shadow flag). Always check `liquidator --help` before writing CLI args.
