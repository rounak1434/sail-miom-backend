const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate, authorize } = require('../middleware/auth');

// Dashboard is available to all INTERNAL roles (not PUBLIC civilians).
const INTERNAL = ['SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'];
router.get('/stats', authenticate, authorize(...INTERNAL), dashboardController.getStats);
router.get('/complaints-chart', authenticate, authorize(...INTERNAL), dashboardController.getComplaintsChart);
router.get('/recent-activity', authenticate, authorize(...INTERNAL), dashboardController.getRecentActivity);
router.get('/location-stats', authenticate, authorize(...INTERNAL), dashboardController.getLocationStats);

module.exports = router;
