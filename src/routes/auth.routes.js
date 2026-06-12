const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, authController.login);
router.post('/google', loginLimiter, authController.googleAuth);
// Civilian account creation has been removed — civilians file complaints as
// guests via POST /api/complaints/guest. (No /register endpoint.)
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, authController.resetPassword);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh', authController.refresh);
router.put('/change-password', authenticate, authController.changePassword);

module.exports = router;
