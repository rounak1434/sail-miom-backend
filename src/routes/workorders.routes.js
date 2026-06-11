const express = require('express');
const router = express.Router();
const workOrdersController = require('../controllers/workorders.controller');
const { authenticate, authorize } = require('../middleware/auth');

// Work orders are internal — viewable by all SAIL roles, not PUBLIC civilians.
const INTERNAL = ['SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'];
router.get('/', authenticate, authorize(...INTERNAL), workOrdersController.getWorkOrders);
router.get('/:id', authenticate, authorize(...INTERNAL), workOrdersController.getWorkOrderById);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.createWorkOrder);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.updateWorkOrder);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.deleteWorkOrder);

module.exports = router;
