const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/stats', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER'), dashboardController.getStats);
router.get('/complaints-chart', authenticate, authorize('SUPERADMIN', 'ADMIN'), dashboardController.getComplaintsChart);
router.get('/recent-activity', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER'), dashboardController.getRecentActivity);
router.get('/location-stats', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER'), dashboardController.getLocationStats);

module.exports = router;
