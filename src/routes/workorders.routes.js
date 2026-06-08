const express = require('express');
const router = express.Router();
const workOrdersController = require('../controllers/workorders.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, workOrdersController.getWorkOrders);
router.get('/:id', authenticate, workOrdersController.getWorkOrderById);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.createWorkOrder);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.updateWorkOrder);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), workOrdersController.deleteWorkOrder);

module.exports = router;
