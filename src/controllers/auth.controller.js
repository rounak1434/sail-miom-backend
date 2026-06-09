const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../lib/prisma');

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
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { location: true }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
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
      // New self-signup → inactive PENDING account; admin must approve before any access.
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

module.exports = { login, logout, refresh, changePassword, googleAuth };
