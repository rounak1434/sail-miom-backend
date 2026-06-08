const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/locations', authenticate, settingsController.getLocations);
router.post('/locations', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.createLocation);
router.put('/locations/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.updateLocation);
router.delete('/locations/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.deleteLocation);
router.get('/installation-types', authenticate, settingsController.getInstallationTypes);
router.post('/installation-types', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.createInstallationType);
router.put('/installation-types/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.updateInstallationType);
router.delete('/installation-types/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.deleteInstallationType);
router.get('/installations', authenticate, settingsController.getInstallations);
router.post('/installations', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.createInstallation);
router.put('/installations/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.updateInstallation);
router.delete('/installations/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.deleteInstallation);
router.get('/sla-config', authenticate, settingsController.getSlaConfig);
router.put('/sla-config', authenticate, authorize('ADMIN', 'SUPERADMIN'), settingsController.updateSlaConfig);

module.exports = router;
