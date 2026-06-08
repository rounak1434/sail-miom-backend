const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.getUsers);
router.get('/me', authenticate, usersController.getMe);
router.put('/me', authenticate, usersController.updateMe);
router.get('/me/stats', authenticate, usersController.getMeStats);
router.post('/', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.createUser);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.updateUser);
router.put('/:id/deactivate', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.deactivateUser);
router.put('/:id/activate', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.activateUser);
router.put('/:id/reset-password', authenticate, authorize('ADMIN', 'SUPERADMIN'), usersController.resetPassword);

module.exports = router;
