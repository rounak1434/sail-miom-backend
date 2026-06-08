const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notifications.controller');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, notificationsController.getNotifications);
router.put('/:id/read', authenticate, notificationsController.markRead);
router.put('/read-all', authenticate, notificationsController.markAllRead);
router.post('/push-token', authenticate, notificationsController.registerPushToken);
router.post('/test-notification', authenticate, notificationsController.testNotification);

module.exports = router;
