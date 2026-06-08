// PM2 process configuration for the SAIL-MIOM backend.
//
//   Start:    pm2 start ecosystem.config.js
//   Reload:   pm2 reload ecosystem.config.js     # graceful, on deploy
//   Restart:  pm2 restart sail-miom-backend
//   Persist:  pm2 save                            # survive server reboots
//
// IMPORTANT — keep `instances: 1` (fork mode). The app runs an in-process
// node-cron SLA monitor (src/services/sla.service.js). Under cluster mode each
// worker would fire that cron independently, producing DUPLICATE SLA
// notifications/emails. Do not switch to cluster mode without first moving the
// cron to a single dedicated worker (e.g. NODE_APP_INSTANCE === '0' guard).
module.exports = {
  apps: [
    {
      name: 'sail-miom-backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',

      // ── Restart behaviour ──────────────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',          // dying before this counts as a crash loop
      max_memory_restart: '500M', // restart if RSS exceeds 500 MB
      // Graceful shutdown room: src/index.js force-exits at 10s, so give PM2 a
      // hair more before it SIGKILLs.
      kill_timeout: 11000,

      // ── Logs (logs/ is git-ignored; create once with `mkdir -p logs`) ──────
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,                 // timestamp every log line

      // PM2-set env wins over .env (dotenv does not override existing vars),
      // so this also guards against a misspelled NODE_ENV in .env.
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
