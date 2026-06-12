const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../lib/prisma');
const { sendEmail } = require('../services/email.service');

const googleClient = new OAuth2Client();
const generateTokens = (userId, role) => ({
  token: jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  }),
  refreshToken: jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN
  })
});

const login = async (req, res) => {
  try {
    const { password } = req.body;
    // Accept an email OR a phone number under any of these keys.
    const identifier = String(
      req.body.identifier ?? req.body.email ?? req.body.phoneNumber ?? req.body.phone ?? ''
    ).trim();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Identifier and password are required' });
    }

    // An "@" means email; otherwise treat it as a phone number.
    const isEmail = identifier.includes('@');
    const where = isEmail ? { email: identifier.toLowerCase() } : { phoneNumber: identifier };
    const user = await prisma.user.findUnique({ where, include: { location: true } });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Google-only accounts have no local password — guide them to Google sign-in
    // instead of letting bcrypt.compare throw on a null hash.
    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: 'This account uses Google sign-in. Please continue with Google.'
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const { token, refreshToken } = generateTokens(user.id, user.role);
    const { password: _, ...userWithoutPassword } = user;

    res.json({ success: true, token, refreshToken, user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const logout = async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (deviceId) {
      await prisma.pushToken.deleteMany({
        where: { userId: req.user.userId, deviceId }
      });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const tokens = generateTokens(user.id, user.role);
    res.json({ success: true, ...tokens });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashed }
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Google Sign-In: the app sends a Google ID token; we verify it, then either
// log the user in (existing + active account) or create an inactive PENDING
// account that an admin must approve. Self-signup never yields a token.
const googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken is required' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID).' });
    }

    // Verify signature + audience against the configured OAuth client id(s).
    const audience = process.env.GOOGLE_CLIENT_ID.split(',').map((s) => s.trim()).filter(Boolean);
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
    }

    if (!payload || !payload.email || payload.email_verified === false) {
      return res.status(401).json({ success: false, message: 'Google account email is not verified' });
    }

    const googleId = payload.sub;
    const email = String(payload.email).toLowerCase();
    const name = payload.name || email.split('@')[0];

    // Match by googleId first, then by email (links an admin-created account).
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
      include: { location: true }
    });

    if (!user) {
      // Civilian account creation has been removed — civilians now file
      // complaints as guests (no account). A brand-new Google user is therefore
      // always an internal signup → inactive PENDING; an admin must approve it.
      await prisma.user.create({
        data: { name, email, googleId, authProvider: 'google', role: 'PENDING', isActive: false }
      });
      return res.status(403).json({
        success: false, pending: true,
        message: 'Account created. An administrator must approve it before you can sign in.'
      });
    }

    // First Google login on an existing account → store the googleId for future logins.
    if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId },
        include: { location: true }
      });
    }

    if (!user.isActive || user.role === 'PENDING') {
      return res.status(403).json({
        success: false, pending: true,
        message: 'Your account is awaiting administrator approval.'
      });
    }

    const { token, refreshToken } = generateTokens(user.id, user.role);
    const { password: _pw, ...safeUser } = user;
    res.json({ success: true, token, refreshToken, user: safeUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Email-based password reset ──────────────────────────────────────────
// Base URL of the web portal's reset page (the email links here). Falls back to
// the deployed admin site so a missing env var still produces a usable link.
const RESET_BASE_URL = (process.env.FRONTEND_URL || 'https://sail-miom-admin.vercel.app').replace(/\/+$/, '');
const RESET_TOKEN_TTL_MIN = 30;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Step 1: request a reset link. ALWAYS responds 200 with the same message
// whether or not the email exists, so the endpoint can't be used to enumerate
// accounts. The actual email is only sent when a matching local account exists.
const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }

    const generic = {
      success: true,
      message: 'If an account exists for that email, a password reset link has been sent.'
    };

    const user = await prisma.user.findUnique({ where: { email } });
    // Only local (password) accounts can reset a password. Google-only accounts
    // have no password to reset — respond generically all the same.
    if (!user || !user.isActive || user.authProvider === 'google') {
      return res.json(generic);
    }

    // One active token per user: clear any earlier unused ones first.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt }
    });

    const link = `${RESET_BASE_URL}/reset-password?token=${rawToken}`;
    const text = `Hello ${user.name},\n\nWe received a request to reset your SAIL-MIOM password. ` +
      `Use the link below within ${RESET_TOKEN_TTL_MIN} minutes:\n\n${link}\n\n` +
      `If you did not request this, you can safely ignore this email.`;
    const html = `<p>Hello ${user.name},</p>` +
      `<p>We received a request to reset your <strong>SAIL-MIOM</strong> password. ` +
      `This link expires in ${RESET_TOKEN_TTL_MIN} minutes:</p>` +
      `<p><a href="${link}">Reset your password</a></p>` +
      `<p>If you did not request this, you can safely ignore this email.</p>`;
    // Fail-soft: if SMTP is unconfigured/down, sendEmail logs and returns; we
    // still respond generically so the flow never leaks delivery state.
    await sendEmail(user.email, 'Reset your SAIL-MIOM password', text, html);

    return res.json(generic);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Step 2: complete the reset with the emailed token + a new password.
const resetPassword = async (req, res) => {
  try {
    const token = String(req.body.token ?? '').trim();
    const newPassword = String(req.body.newPassword ?? req.body.password ?? '');
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'token and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) }
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { password: hashed } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Burn any other outstanding tokens for this user.
      prisma.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } })
    ]);

    res.json({ success: true, message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { login, logout, refresh, changePassword, googleAuth, forgotPassword, resetPassword };
