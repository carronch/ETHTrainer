// pm2 ecosystem config — keep ETHTrainer alive on Mac Mini
// Start with: pm2 start ecosystem.config.cjs
// Save state: pm2 save
// Auto-start on reboot: pm2 startup

module.exports = {
  apps: [
    {
      name: 'ethtrainer',
      script: 'npx',
      args: 'tsx src/index.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      // Restart policy
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: '10s',

      // Logging
      out_file: './pm2-logs/out.log',
      error_file: './pm2-logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
