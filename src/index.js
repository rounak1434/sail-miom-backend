const app = require('./app');
const { startSlaMonitor } = require('./services/sla.service');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  
  // Start background services
  startSlaMonitor();
});
