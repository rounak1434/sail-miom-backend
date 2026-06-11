const express = require('express');
const router = express.Router();
const drawingsController = require('../controllers/drawings.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { drawingUpload } = require('../middleware/upload');

// Drawings are restricted to ENGINEERs (plus ADMIN/SUPERADMIN who manage them).
// Contractors, staff and public civilians have no drawing access.
const DRAWING_VIEWERS = ['SUPERADMIN', 'ADMIN', 'ENGINEER'];
router.get('/', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getDrawings);
router.get('/categories', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getCategories);
router.get('/:id', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getDrawingById);
router.get('/:id/download', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getDownloadUrl);
router.get('/:id/versions', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getDrawingVersions);
// On-PDF markup (shared across users/devices) — drawing viewers may read/add;
// delete is limited to the author or an admin (enforced in the controller).
router.get('/:id/annotations', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.getAnnotations);
router.post('/:id/annotations', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.createAnnotation);
router.delete('/:id/annotations/:annotationId', authenticate, authorize(...DRAWING_VIEWERS), drawingsController.deleteAnnotation);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.single('file'), drawingsController.uploadDrawing);
router.post('/bulk-upload', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.array('files', 50), drawingsController.bulkUploadDrawings);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingUpload.single('file'), drawingsController.updateDrawing);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), drawingsController.deleteDrawing);

module.exports = router;
