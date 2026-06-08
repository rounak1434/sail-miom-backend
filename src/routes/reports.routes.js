const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/complaints', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.getComplaintsReport);
router.get('/sla', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.getSlaReport);
router.get('/maintenance', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.getMaintenanceReport);          // FIX #4a
router.get('/contractor-performance', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.getContractorPerformance); // FIX #4b
router.get('/department', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.getDepartmentReport);
router.get('/export/excel', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.exportComplaintsExcel);
router.get('/export/pdf', authenticate, authorize('ADMIN', 'SUPERADMIN'), reportsController.exportReportPdf);                // FIX #5

module.exports = router;
