const express = require('express');
const router = express.Router();
const complaintsController = require('../controllers/complaints.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { attachmentUpload } = require('../middleware/upload');

router.get('/', authenticate, complaintsController.getComplaints);
router.get('/:id/timeline', authenticate, complaintsController.getTimeline);
router.get('/:id', authenticate, complaintsController.getComplaintById);
router.post('/', authenticate, authorize('CONTRACTOR', 'ENGINEER', 'STAFF', 'ADMIN', 'SUPERADMIN'), complaintsController.createComplaint);
router.put('/:id/assign', authenticate, authorize('ADMIN', 'SUPERADMIN'), complaintsController.assignComplaint);
router.put('/:id/status', authenticate, authorize('CONTRACTOR', 'ADMIN', 'SUPERADMIN'), complaintsController.updateComplaintStatus);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), complaintsController.deleteComplaint);
router.post('/:id/comments', authenticate, complaintsController.addComment);
router.post('/:id/attachments', authenticate, attachmentUpload.array('files', 10), complaintsController.addAttachments);
router.delete('/:id/attachments/:attachmentId', authenticate, complaintsController.deleteAttachment);

module.exports = router;
