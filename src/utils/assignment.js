const prisma = require('../lib/prisma');
const { isAssignableRole } = require('./roles');

// Shared assignee guard for both work orders and complaints. Returns a friendly
// error message if the user can't be assigned (missing, inactive, or a
// civilian/guest/pending role), or null if the assignment is allowed. Work and
// complaints may only go to an authenticated operational role — never to a
// civilian (PUBLIC / CIVILIAN_GUEST) or a not-yet-approved (PENDING) account.
// `entity` just tunes the wording ("work order" vs "complaint").
async function validateAssignee(assignedToId, entity = 'work order') {
  if (!assignedToId) return null; // unassigned is fine
  const user = await prisma.user.findUnique({
    where: { id: parseInt(assignedToId) },
    select: { id: true, role: true, isActive: true }
  });
  if (!user) return 'Selected assignee was not found.';
  if (!user.isActive) return `Cannot assign a ${entity} to an inactive account.`;
  if (!isAssignableRole(user.role)) {
    return `Cannot assign a ${entity} to a civilian. Choose an engineer, contractor, staff member, or admin.`;
  }
  return null;
}

module.exports = { validateAssignee };
