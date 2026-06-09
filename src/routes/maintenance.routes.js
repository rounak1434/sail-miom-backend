const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenance.controller');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');

// Memory storage for maintenance completion photos (FIX #10)
const photoUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed for maintenance photos'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 5 } // max 5 photos, 10MB each
});

router.get('/', authenticate, maintenanceController.getMaintenance);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), maintenanceController.createMaintenance);
router.put('/:id', authenticate, authorize('ENGINEER', 'CONTRACTOR', 'STAFF', 'ADMIN', 'SUPERADMIN'), maintenanceController.updateMaintenance);
router.put('/:id/complete', authenticate, authorize('ENGINEER', 'CONTRACTOR', 'STAFF', 'ADMIN', 'SUPERADMIN'), photoUpload.array('photos', 5), maintenanceController.completeMaintenance);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), maintenanceController.deleteMaintenance);

module.exports = router;
