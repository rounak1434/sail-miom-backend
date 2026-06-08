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

module.exports = { rateLimiter };
