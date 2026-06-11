const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/complaints', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.getComplaintsReport);
router.get('/sla', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.getSlaReport);
router.get('/maintenance', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.getMaintenanceReport);          // FIX #4a
router.get('/contractor-performance', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.getContractorPerformance); // FIX #4b
router.get('/department', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.getDepartmentReport);
router.get('/export/excel', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.exportComplaintsExcel);
router.get('/export/pdf', authenticate, authorize('SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'), reportsController.exportReportPdf);                // FIX #5

module.exports = router;
