require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const complaintsRoutes = require('./routes/complaints.routes');
const drawingsRoutes = require('./routes/drawings.routes');
const maintenanceRoutes = require('./routes/maintenance.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const usersRoutes = require('./routes/users.routes');
const reportsRoutes = require('./routes/reports.routes');
const settingsRoutes = require('./routes/settings.routes');
const workOrdersRoutes = require('./routes/workorders.routes');
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');
const prisma = require('./lib/prisma');

const app = express();

// Behind the Nginx reverse proxy — trust the first hop so req.ip and the rate
// limiter see the real client IP (via X-Forwarded-For) instead of 127.0.0.1.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api/', rateLimiter);

app.get('/health', async (req, res) => {
  try {
    // Cheap liveness probe against Postgres so /health reflects DB availability.
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      service: 'SAIL-MIOM Backend',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      service: 'SAIL-MIOM Backend',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/complaints', complaintsRoutes);
app.use('/api/drawings', drawingsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/work-orders', workOrdersRoutes);

app.use('*', (req, res) => res.status(404).json({
  success: false,
  message: 'Route not found'
}));

app.use(errorHandler);
module.exports = app;
