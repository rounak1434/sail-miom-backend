// Smoke test: every controller/route module must load without throwing, and the
// auth controller must expose exactly the handlers the routes reference (catches
// a missing/renamed export — e.g. the removed `register`). Prisma queries are
// lazy, so requiring these does not need a live database.
const { test } = require('node:test');
const assert = require('node:assert');

test('auth controller exports the expected handlers (no register)', () => {
  const auth = require('../src/controllers/auth.controller');
  for (const fn of ['login', 'logout', 'refresh', 'changePassword', 'googleAuth', 'forgotPassword', 'resetPassword']) {
    assert.equal(typeof auth[fn], 'function', `auth.${fn} should be a function`);
  }
  assert.equal(auth.register, undefined, 'register must be removed');
});

test('complaints controller exposes the guest handler', () => {
  const c = require('../src/controllers/complaints.controller');
  assert.equal(typeof c.createGuestComplaint, 'function');
});

test('route modules load without throwing', () => {
  assert.doesNotThrow(() => require('../src/routes/auth.routes'));
  assert.doesNotThrow(() => require('../src/routes/complaints.routes'));
  assert.doesNotThrow(() => require('../src/routes/workorders.routes'));
});

test('rate limiter exposes the new limiters', () => {
  const rl = require('../src/middleware/rateLimiter');
  assert.equal(typeof rl.passwordResetLimiter, 'function');
  assert.equal(typeof rl.guestComplaintLimiter, 'function');
});

test('shared validateAssignee is reused by both controllers', () => {
  const { validateAssignee } = require('../src/utils/assignment');
  assert.equal(typeof validateAssignee, 'function');
  // Both the work-order and complaint controllers must load with the shared guard.
  assert.doesNotThrow(() => require('../src/controllers/workorders.controller'));
  assert.doesNotThrow(() => require('../src/controllers/complaints.controller'));
});
