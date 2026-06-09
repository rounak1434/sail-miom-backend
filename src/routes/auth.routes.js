const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, authController.login);
router.post('/google', loginLimiter, authController.googleAuth);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh', authController.refresh);
router.put('/change-password', authenticate, authController.changePassword);

module.exports = router;
