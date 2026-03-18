// pm2 ecosystem config — keep ETHTrainer alive on Mac Mini
// Start with: pm2 start ecosystem.config.cjs
// Save state: pm2 save
// Auto-start on reboot: pm2 startup

module.exports = {
  apps: [
    // ── Layer 1: Rust Liquidation Executors (one per chain) ─────────────────
    // The hot path — always-on, no LLM, reads heuristic_params.<chain>.json
    // Start in shadow mode first (72h validation), then switch to --live
    {
      name: 'liquidator-arbitrum',
      script: './target/release/liquidator',
      args: '--chain arbitrum',
      interpreter: 'none',
      env: { RUST_LOG: 'liquidator=info' },
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 3000,
      min_uptime: '10s',
      out_file: './pm2-logs/liquidator-arbitrum-out.log',
      error_file: './pm2-logs/liquidator-arbitrum-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'liquidator-base',
      script: './target/release/liquidator',
      args: '--chain base',
      interpreter: 'none',
      env: { RUST_LOG: 'liquidator=info' },
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 3000,
      min_uptime: '10s',
      out_file: './pm2-logs/liquidator-base-out.log',
      error_file: './pm2-logs/liquidator-base-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'liquidator-optimism',
      script: './target/release/liquidator',
      args: '--chain optimism',
      interpreter: 'none',
      env: { RUST_LOG: 'liquidator=info' },
      autorestart: true,
      watch: false,
      max_restarts: 20,
      restart_delay: 3000,
      min_uptime: '10s',
      out_file: './pm2-logs/liquidator-optimism-out.log',
      error_file: './pm2-logs/liquidator-optimism-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ── Layer 2+3: TypeScript Monitor + Autoresearch ────────────────────────
    // Lightweight — watchdog, daily P&L, nightly autoresearch loop
    {
      name: 'ethtrainer-ts',
      script: 'npx',
      args: 'tsx src/index.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s',
      out_file: './pm2-logs/ts-out.log',
      error_file: './pm2-logs/ts-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
