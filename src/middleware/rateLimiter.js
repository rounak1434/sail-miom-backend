const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  // The admin dashboard fires ~10 queries per page and auto-refreshes on focus, so a
  // 100/15min cap throttled normal use (worse behind a proxy where users share an IP).
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter limiter for the login endpoint to blunt credential brute-forcing.
// Successful logins don't count (skipSuccessfulRequests), so a legitimate user
// fat-fingering their password a few times still gets in once correct.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 failed attempts per IP per window
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many login attempts, please try again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Password-reset request/complete: strict per-IP cap so the endpoints can't be
// used to spam reset emails or brute-force tokens. Every request counts.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 attempts per IP per window
  message: { success: false, message: 'Too many password reset attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Guest (civilian, no-account) complaint submission: per-IP cap so the open,
// unauthenticated endpoint can't be flooded.
const guestComplaintLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                  // 10 guest complaints per IP per hour
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { rateLimiter, loginLimiter, passwordResetLimiter, guestComplaintLimiter };
