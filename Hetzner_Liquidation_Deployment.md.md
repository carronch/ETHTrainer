# ETHTrainer — Hetzner Deployment Guide

**Hardware:** Hetzner AX102-U (Ryzen 9 7950X3D, 128GB DDR5, 2×1.92TB NVMe Datacenter Edition, RAID 0)

Follow each phase in order. Confirm completion before moving to the next.

---

## Phase 1: Order & Initial Access

1. Order the **AX102-U** from Hetzner. Select the **2×1.92TB NVMe Datacenter Edition** drives.
2. Retrieve the server IP and temporary root password from the Hetzner order email.
3. Connect via SSH:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

---

## Phase 2: OS Installation + RAID 0 (Rescue Mode)

Boot into rescue mode via Hetzner's web console, then run:

```bash
installimage
```

In the menu:
- Select **Ubuntu 24.04 LTS**
- Scroll to `# RAID-configuration` and set `SWRAIDLEVEL 0` (max throughput — Ethereum node is IOPS-bound)
- Press **F10** to save → type **YES** to confirm → reboot

```bash
reboot
# Wait ~2 minutes, then SSH back in
```

---

## Phase 3: SSH Hardening

Run steps 1–2 on your **local machine**, the rest on the server.

```bash
# Local machine:
ssh-keygen -t ed25519 -C "hetzner_ethtrainer"
ssh-copy-id root@YOUR_SERVER_IP
```

```bash
# Server:
nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
systemctl restart ssh
# Verify you can still connect with your key before closing the current session
```

---

## Phase 4: Security Baseline

```bash
apt update && apt upgrade -y
apt install -y git curl ufw build-essential pkg-config libssl-dev
ufw allow OpenSSH
ufw enable

# Verify port 8545 is NOT open (it must never be)
ufw status
```

---

## Phase 5: Ethereum Node (Eth-Docker)

The mainnet node is needed for the eventual validator. The liquidation bot runs on Arbitrum (uses Alchemy RPC, not this node).

```bash
cd ~ && git clone https://github.com/ethstaker/eth-docker.git && cd eth-docker
./ethd install
# If prompted to log out: log out, log back in, cd ~/eth-docker

./ethd config
# Network:          Ethereum Mainnet
# Execution client: Nethermind
# Consensus client: Lighthouse
# MEV-Boost:        No
# Dashboards:       Grafana

./ethd up
# Sync time: ~2–3 days. Monitor with: ./ethd logs -f
```

---

## Phase 6: Tailscale (Secure Remote Access)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Authenticate via the printed link
```

After connecting your local machine to the same Tailscale network:
- Grafana: `http://100.x.x.x:3000` (Tailscale IP — NOT exposed to internet)
- SSH: use Tailscale IP for ongoing access

---

## Phase 7: Rust Toolchain + Node.js + pm2

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup update stable

# Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pm2
npm install -g pm2

# Foundry (for Anvil fork simulations during validation)
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup
```

---

## Phase 8: Clone + Build ETHTrainer

```bash
cd ~
git clone https://github.com/carronch/ETHTrainer.git ETHTrainer
cd ETHTrainer

# Build Rust executor
cargo build --release -p liquidator

# Install TS dependencies
npm install

# Type-check TS layer
npm run build
```

---

## Phase 9: Configure Environment

```bash
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
nano .dev.vars
```

Fill in:
```bash
KEYSTORE_PASSWORD=<strong random password>
ANTHROPIC_API_KEY=<your Anthropic API key>
TELEGRAM_BOT_TOKEN=<your Telegram bot token>
TELEGRAM_CHAT_ID=<your Telegram chat ID>
ARBITRUM_RPC_URL=<Alchemy or Infura Arbitrum HTTPS endpoint>
ARBITRUM_RPC_URL_WS=<Alchemy or Infura Arbitrum WSS endpoint>
ETH_RPC_URL=http://localhost:8545
ETH_RPC_URL_WS=ws://localhost:8546
TREASURY_ADDRESS=<your cold wallet receive address>
NETWORK=arbitrum
```

---

## Phase 10: Wallet Setup

```bash
node scripts/setup-wallet.ts
# This creates ~/.ethtrainer/keystore.json (outside the repo)
# Note the address printed — this is your Arbitrum trading wallet
```

Fund the trading wallet:
- Bridge at least **0.5 ETH** to Arbitrum (trading wallet floor)
- Additional ETH covers gas for liquidation attempts (~0.02 ETH per attempt)

---

## Phase 11: Deploy LiquidationBot Contract

```bash
# After Ethereum mainnet node is synced (only needed for Ethereum mainnet)
# The Arbitrum deploy uses your Arbitrum RPC URL

npm run deploy:liquidation
# Save the deployed contract address — add it to .dev.vars as LIQUIDATION_BOT_ADDRESS
```

---

## Phase 12: Seed Initial Parameters

Before the autoresearch loop has live data, seed `heuristic_params.json` from historical data:

```bash
npx tsx scripts/seed-params.ts
# Pulls 6 months of Aave v3 Arbitrum LiquidationCall events from The Graph
# Analyzes gas distribution → asks Claude for optimal initial params
# Writes: heuristic_params.json
```

---

## Phase 13: 72h Anvil Fork Validation

Run the liquidator against a local Anvil fork — never touches mainnet:

```bash
# Terminal 1: start Anvil fork
anvil --fork-url $ARBITRUM_RPC_URL --fork-block-number latest &

# Terminal 2: run liquidator in shadow mode against Anvil
ARBITRUM_RPC_URL=http://127.0.0.1:8545 \
ARBITRUM_RPC_URL_WS=ws://127.0.0.1:8545 \
./target/release/liquidator --shadow
```

**Success criteria:**
- [ ] Bot detects liquidatable positions
- [ ] Profit calculations are correct (check logs)
- [ ] No crashes over 72h
- [ ] Telegram reports arriving every 6h

---

## Phase 14: 72h Shadow Mode (Mainnet RPC, No Submission)

Point at real Arbitrum RPC — watches real mempool but never submits:

```bash
./target/release/liquidator --shadow
```

**Success criteria:**
- [ ] Shadow log shows captured liquidation opportunities
- [ ] Capture rate vs on-chain LiquidationCall events > 20% (room to improve)
- [ ] Gas bid estimates are competitive (within range of actual winners)
- [ ] Telegram reports arriving every 6h
- [ ] No crashes or circuit breaker triggers

---

## Phase 15: Go Live

```bash
./target/release/liquidator --live
```

The bot now submits real transactions. First successful liquidation triggers a Telegram alert.

---

## Phase 16: pm2 Production Setup

```bash
cd ~/ETHTrainer
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# Copy and run the printed command to enable auto-start on reboot
```

**Verify both processes are running:**
```bash
pm2 list
pm2 logs liquidator --lines 50
pm2 logs ethtrainer-ts --lines 50
```

---

## Phase 17: Autoresearch Online

The TS layer automatically schedules the nightly cycle at 2am UTC. After the first 24h of live operation:

```bash
# Manually trigger one cycle to verify it works end-to-end
npx tsx scripts/run-autoresearch.ts
```

**Success criteria:**
- [ ] Autoresearch completes without error
- [ ] Telegram report received
- [ ] `heuristic_params.json` updated (if missed opps found)
- [ ] Rust process picks up new params (check logs for "Reloading heuristic params")

---

## Security Checklist

Before going live, verify:

- [ ] `.dev.vars` has `chmod 600` — only root can read it
- [ ] `.dev.vars` is in `.gitignore` — never committed
- [ ] `heuristic_params.json` is in `.gitignore`
- [ ] Port 8545 is NOT in `ufw status` output
- [ ] Keystore file is at `~/.ethtrainer/keystore.json` (outside repo)
- [ ] Treasury wallet private key is **not** on this server
- [ ] Grafana is only accessible via Tailscale (not public internet)

---

## Monitoring

| Tool | Access | Purpose |
|------|--------|---------|
| Telegram | Your phone | CRITICAL alerts, daily P&L, param updates |
| Grafana | Tailscale `http://100.x.x.x:3000` | Ethereum node metrics, disk, sync status |
| pm2 logs | `pm2 logs` on server | Live bot logs |
| SQLite | `sqlite3 ~/.ethtrainer/db.sqlite` | Raw trade/miss data |

---

## Phase 3 Scale (After First Profitable Month)

1. **Radiant Capital** — Arbitrum's largest lender (Aave v2 fork). Same Rust pattern, new contract addresses.
2. **The Graph complete coverage** — Query all current borrowers, not just recent Borrow events.
3. **Aave v3 Base + Optimism** — Same contract addresses as Arbitrum, different RPC URL.
