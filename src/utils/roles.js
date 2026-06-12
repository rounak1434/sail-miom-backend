// Single source of truth for role groupings used across authorization checks.

// Internal SAIL staff roles (everything that is NOT a civilian/guest/pending).
const INTERNAL_ROLES = ['SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'];

// Roles a work order may be assigned to: any authenticated operational role.
// Civilians (PUBLIC / CIVILIAN_GUEST) and not-yet-approved (PENDING) accounts
// must NEVER receive a work order.
const ASSIGNABLE_ROLES = ['SUPERADMIN', 'ADMIN', 'ENGINEER', 'CONTRACTOR', 'STAFF'];

// Civilian roles — used for guards and friendly error messages.
const CIVILIAN_ROLES = ['PUBLIC', 'CIVILIAN_GUEST'];

const isAssignableRole = (role) => ASSIGNABLE_ROLES.includes(String(role || '').toUpperCase());

module.exports = { INTERNAL_ROLES, ASSIGNABLE_ROLES, CIVILIAN_ROLES, isAssignableRole };
