const express = require('express');
const router = express.Router();
const drawingsController = require('../controllers/drawings.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { drawingUpload } = require('../middleware/upload');

router.get('/', authenticate, drawingsController.getDrawings);
router.get('/categories', authenticate, drawingsController.getCategories);
router.get('/:id', authenticate, drawingsController.getDrawingById);
router.get('/:id/download', authenticate, drawingsController.getDownloadUrl);
router.get('/:id/versions', authenticate, drawingsController.getDrawingVersions);
// On-PDF markup (shared across users/devices) — any authenticated user may read/add;
// delete is limited to the author or an admin (enforced in the controller).
router.get('/:id/annotations', authenticate, drawingsController.getAnnotations);
router.post('/:id/annotations', authenticate, drawingsController.createAnnotation);
router.delete('/:id/annotations/:annotationId', authenticate, drawingsController.deleteAnnotation);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.single('file'), drawingsController.uploadDrawing);
router.post('/bulk-upload', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.array('files', 50), drawingsController.bulkUploadDrawings);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.single('file'), drawingsController.updateDrawing);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingsController.deleteDrawing);

module.exports = router;
