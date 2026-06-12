const { test } = require('node:test');
const assert = require('node:assert');
const { isAssignableRole, ASSIGNABLE_ROLES, CIVILIAN_ROLES } = require('../src/utils/roles');

test('operational roles are assignable to work orders', () => {
  for (const role of ['SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF']) {
    assert.equal(isAssignableRole(role), true, `${role} should be assignable`);
  }
});

test('civilian / guest / pending roles are NOT assignable', () => {
  for (const role of ['PUBLIC', 'CIVILIAN_GUEST', 'PENDING']) {
    assert.equal(isAssignableRole(role), false, `${role} must not be assignable`);
  }
});

test('isAssignableRole is case-insensitive and null-safe', () => {
  assert.equal(isAssignableRole('engineer'), true);
  assert.equal(isAssignableRole('Contractor'), true);
  assert.equal(isAssignableRole(null), false);
  assert.equal(isAssignableRole(undefined), false);
  assert.equal(isAssignableRole(''), false);
});

test('CIVILIAN_ROLES are disjoint from ASSIGNABLE_ROLES', () => {
  for (const r of CIVILIAN_ROLES) {
    assert.equal(ASSIGNABLE_ROLES.includes(r), false, `${r} must not be in ASSIGNABLE_ROLES`);
  }
});
