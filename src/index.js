require('dotenv').config();

// Fail fast on missing required config before binding the port.
const { validateEnv } = require('./config/validateEnv');
validateEnv();

const app = require('./app');
const prisma = require('./lib/prisma');
const { startSlaMonitor } = require('./services/sla.service');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);

  // Start background services
  startSlaMonitor();
});

server.on('error', (err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully…`);

  // Stop accepting new connections, then close the DB pool.
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error('Error during Prisma disconnect:', e.message);
    }
    console.log('✅ Clean shutdown complete.');
    process.exit(0);
  });

  // Safety net: force-exit if connections don't drain in time.
  setTimeout(() => {
    console.error('⏱️  Shutdown timed out — forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Promise Rejection:', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  shutdown('uncaughtException');
});
