// One-time data correction: recompute Complaint.isSlaBreached for existing rows
// using the corrected rule (breach = resolved/closed AFTER deadline, OR still
// open past deadline). Fixes stale latched flags from the old cron-only logic.
// Run: node scripts/recompute-sla.js   (safe to re-run; idempotent)
require('dotenv').config();
const prisma = require('../src/lib/prisma');

(async () => {
  const now = new Date();
  const rows = await prisma.complaint.findMany({
    where: { isDeleted: false },
    select: { id: true, status: true, slaDeadline: true, updatedAt: true, isSlaBreached: true, slaBreachedAt: true }
  });

  let changed = 0;
  for (const c of rows) {
    const resolved = c.status === 'RESOLVED' || c.status === 'CLOSED';
    // resolved → compare resolution time (updatedAt) to deadline; else compare now.
    const ref = resolved ? c.updatedAt : now;
    const breached = !!c.slaDeadline && ref > c.slaDeadline;
    const slaBreachedAt = breached ? (c.slaBreachedAt ?? ref) : null;

    if (breached !== c.isSlaBreached) {
      await prisma.complaint.update({ where: { id: c.id }, data: { isSlaBreached: breached, slaBreachedAt } });
      changed++;
    }
  }

  const [total, resolved, breached, met] = await Promise.all([
    prisma.complaint.count({ where: { isDeleted: false } }),
    prisma.complaint.count({ where: { status: 'RESOLVED', isDeleted: false } }),
    prisma.complaint.count({ where: { isSlaBreached: true, isDeleted: false } }),
    prisma.complaint.count({ where: { isSlaBreached: false, isDeleted: false } })
  ]);
  const adherence = total > 0 ? ((met / total) * 100).toFixed(1) : '100';
  console.log(`recomputed ${rows.length} complaints, changed ${changed}`);
  console.log(`total=${total} resolved=${resolved} open(!=resolved)=${total - resolved} breached=${breached} met=${met} adherence=${adherence}%`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
