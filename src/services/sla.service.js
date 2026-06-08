const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { sendPushToUser, sendRoleNotification } = require('./notification.service');
const { sendEmail } = require('./email.service');
const prisma = new PrismaClient();

const calculateSlaDeadline = async (priority) => {
  const config = await prisma.slaConfig.findFirst();
  const hours = {
    CRITICAL: config?.criticalHours || 4,
    HIGH:     config?.highHours     || 8,
    MEDIUM:   config?.mediumHours   || 24,
    LOW:      config?.lowHours      || 72
  };
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + (hours[priority] || 24));
  return deadline;
};

const checkSlaBreaches = async () => {
  try {
    const now = new Date();

    // Mark breached complaints
    const breached = await prisma.complaint.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        isSlaBreached: false,
        slaDeadline: { lt: now }
      }
    });

    for (const c of breached) {
      await prisma.complaint.update({
        where: { id: c.id },
        data: { isSlaBreached: true, slaBreachedAt: now }
      });

      await prisma.notification.create({
        data: {
          userId: c.raisedById,
          type: 'SLA_BREACHED',
          title: '⚠️ SLA Breached',
          body: c.title,
          data: { complaintId: c.id }
        }
      });

      if (c.assignedToId) {
        await sendPushToUser(
          c.assignedToId,
          '⚠️ SLA Breached',
          c.title,
          { complaintId: String(c.id), type: 'SLA_BREACHED' }
        );
      }

      // ── Escalation layer (on top of the raiser/assignee notifications) ──
      // 1) Push to all admins/superadmins.
      await sendRoleNotification(
        ['ADMIN', 'SUPERADMIN'],
        '🚨 SLA Escalation',
        `Complaint #${c.complaintNumber} - ${c.title} has breached SLA and needs attention`,
        { complaintId: String(c.id), type: 'SLA_BREACHED' }
      );

      // 2) Escalation email to admins/superadmins. Wrapped so an email/SendGrid
      //    failure can never break the cron run.
      try {
        const admins = await prisma.user.findMany({
          where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, isActive: true },
          select: { email: true }
        });
        const adminEmails = admins.map((u) => u.email).filter(Boolean);
        if (adminEmails.length) {
          const subject = `🚨 SLA Escalation: ${c.complaintNumber}`;
          const text =
            `Complaint #${c.complaintNumber} - ${c.title} has breached its SLA and needs attention.\n` +
            `Priority: ${c.priority}\nSLA deadline: ${c.slaDeadline}\n\n` +
            `Please review it in the SAIL MIOM admin panel.`;
          const html =
            `<p>Complaint <strong>#${c.complaintNumber}</strong> &mdash; ${c.title} ` +
            `has <strong>breached its SLA</strong> and needs attention.</p>` +
            `<p>Priority: ${c.priority}<br/>SLA deadline: ${c.slaDeadline}</p>` +
            `<p>Please review it in the SAIL MIOM admin panel.</p>`;
          await sendEmail(adminEmails, subject, text, html);
        }
      } catch (e) {
        console.error('SLA escalation email error:', e.message);
      }
    }

    // Send 1-hour warnings
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const approaching = await prisma.complaint.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        isSlaBreached: false,
        slaDeadline: { gte: now, lte: oneHourLater }
      }
    });

    for (const c of approaching) {
      if (c.assignedToId) {
        await sendPushToUser(
          c.assignedToId,
          '⏰ SLA Approaching',
          `Due in 1 hour: ${c.title}`,
          { complaintId: String(c.id), type: 'SLA_WARNING' }
        );
      }
    }
  } catch (error) {
    console.error('SLA check error:', error.message);
  }
};

const checkMaintenanceDue = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    // Capture the rows about to transition (before the updateMany) so we can
    // notify per item afterwards. The status-update logic below is unchanged.
    const overdueWhere = { status: { in: ['UPCOMING', 'DUE'] }, dueDate: { lt: today } };
    const newlyOverdue = await prisma.maintenance.findMany({ where: overdueWhere });

    await prisma.maintenance.updateMany({
      where: { status: { in: ['UPCOMING', 'DUE'] }, dueDate: { lt: today } },
      data: { status: 'OVERDUE' }
    });

    const dueWhere = { status: 'UPCOMING', dueDate: { gte: today, lte: sevenDaysLater } };
    const newlyDue = await prisma.maintenance.findMany({ where: dueWhere });

    await prisma.maintenance.updateMany({
      where: {
        status: 'UPCOMING',
        dueDate: { gte: today, lte: sevenDaysLater }
      },
      data: { status: 'DUE' }
    });

    // --- Notify on DUE transition: engineers + staff ---
    if (newlyDue.length) {
      const dueRecipients = await prisma.user.findMany({
        where: { role: { in: ['ENGINEER', 'STAFF'] }, isActive: true },
        select: { id: true }
      });
      for (const item of newlyDue) {
        if (dueRecipients.length) {
          await prisma.notification.createMany({
            data: dueRecipients.map((u) => ({
              userId: u.id,
              type: 'MAINTENANCE_DUE',
              title: '🔧 Maintenance Due',
              body: `${item.title} is due today`,
              data: { maintenanceId: item.id }
            }))
          });
        }
        await sendRoleNotification(
          ['ENGINEER', 'STAFF'],
          '🔧 Maintenance Due',
          `${item.title} is due today`,
          { maintenanceId: String(item.id), type: 'MAINTENANCE_DUE' }
        );
      }
    }

    // --- Notify on OVERDUE transition: engineers + staff + admins ---
    if (newlyOverdue.length) {
      const overdueRecipients = await prisma.user.findMany({
        where: { role: { in: ['ENGINEER', 'STAFF', 'ADMIN', 'SUPERADMIN'] }, isActive: true },
        select: { id: true }
      });
      for (const item of newlyOverdue) {
        if (overdueRecipients.length) {
          await prisma.notification.createMany({
            data: overdueRecipients.map((u) => ({
              userId: u.id,
              type: 'MAINTENANCE_OVERDUE',
              title: '⚠️ Maintenance Overdue',
              body: `${item.title} is overdue`,
              data: { maintenanceId: item.id }
            }))
          });
        }
        await sendRoleNotification(
          ['ENGINEER', 'STAFF', 'ADMIN', 'SUPERADMIN'],
          '⚠️ Maintenance Overdue',
          `${item.title} is overdue`,
          { maintenanceId: String(item.id), type: 'MAINTENANCE_OVERDUE' }
        );
      }
    }
  } catch (error) {
    console.error('Maintenance check error:', error.message);
  }
};

const startSlaMonitor = () => {
  console.log('✅ SLA Monitor started (every 15 min)');
  cron.schedule('*/15 * * * *', checkSlaBreaches);
  cron.schedule('0 8 * * *', checkMaintenanceDue);
};

module.exports = { calculateSlaDeadline, startSlaMonitor };
