const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalComplaints,
      openComplaints,
      inProgressComplaints,
      resolvedComplaints,
      closedComplaints,
      resolvedToday,
      slaBreached,
      pendingMaintenance,
      totalDrawings,
      activeUsers,
      totalMet,
      mntOverdue,
      mntDueToday,
      mntDueThisWeek,
      mntCompletedThisMonth
    ] = await Promise.all([
      prisma.complaint.count({ where: { isDeleted: false } }),
      prisma.complaint.count({ where: { status: 'OPEN', isDeleted: false } }),
      prisma.complaint.count({ where: { status: 'IN_PROGRESS', isDeleted: false } }),
      prisma.complaint.count({ where: { status: 'RESOLVED', isDeleted: false } }),
      prisma.complaint.count({ where: { status: 'CLOSED', isDeleted: false } }),
      prisma.complaint.count({
        where: { status: 'RESOLVED', updatedAt: { gte: today } }
      }),
      prisma.complaint.count({
        where: { isSlaBreached: true, isDeleted: false }
      }),
      prisma.maintenance.count({
        where: { status: { in: ['DUE', 'OVERDUE'] }, isDeleted: false }
      }),
      prisma.drawing.count({ where: { isDeleted: false } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.complaint.count({
        where: { isSlaBreached: false, isDeleted: false }
      }),
      prisma.maintenance.count({ where: { status: 'OVERDUE', isDeleted: false } }),
      prisma.maintenance.count({ where: { status: 'DUE', dueDate: { gte: today, lt: tomorrow }, isDeleted: false } }),
      prisma.maintenance.count({ where: { status: { in: ['DUE', 'UPCOMING'] }, dueDate: { gte: today, lt: weekEnd }, isDeleted: false } }),
      prisma.maintenance.count({ where: { status: 'COMPLETED', completedDate: { gte: monthStart }, isDeleted: false } })
    ]);

    const slaAdherence = totalComplaints > 0
      ? ((totalMet / totalComplaints) * 100).toFixed(1)
      : 100;

    res.json({
      success: true,
      data: {
        totalComplaints,
        openComplaints,
        resolvedToday,
        slaBreached,
        slaMet: totalMet,
        pendingMaintenance,
        totalDrawings,
        activeUsers,
        slaAdherence: parseFloat(slaAdherence),
        statusBreakdown: {
          open: openComplaints,
          inProgress: inProgressComplaints,
          resolved: resolvedComplaints,
          closed: closedComplaints
        },
        maintenanceStats: {
          overdue: mntOverdue,
          dueToday: mntDueToday,
          dueThisWeek: mntDueThisWeek,
          completedThisMonth: mntCompletedThisMonth
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getComplaintsChart = async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const days = period === 'year' ? 365 : period === 'month' ? 30 : 7;

    // Build start date for the window
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    // 3 queries for the whole window instead of N×3 — massive perf improvement
    const [newComplaints, resolvedComplaints, breachedComplaints] = await Promise.all([
      prisma.complaint.findMany({
        where: { createdAt: { gte: startDate }, isDeleted: false },
        select: { createdAt: true }
      }),
      prisma.complaint.findMany({
        where: { status: 'RESOLVED', updatedAt: { gte: startDate } },
        select: { updatedAt: true }
      }),
      prisma.complaint.findMany({
        where: { isSlaBreached: true, slaBreachedAt: { gte: startDate } },
        select: { slaBreachedAt: true }
      })
    ]);

    const toDay = (d) => new Date(d).toISOString().split('T')[0];

    // Group in memory
    const results = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      results.push({
        date: dateStr,
        open:     newComplaints.filter(c => toDay(c.createdAt) === dateStr).length,
        resolved: resolvedComplaints.filter(c => toDay(c.updatedAt) === dateStr).length,
        breached: breachedComplaints.filter(c => c.slaBreachedAt && toDay(c.slaBreachedAt) === dateStr).length,
      });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRecentActivity = async (req, res) => {
  try {
    const updates = await prisma.complaintUpdate.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        complaint: { select: { complaintNumber: true, title: true } },
        user: { select: { name: true } }
      }
    });

    const activity = updates.map(u => ({
      type: 'complaint_update',
      message: `${u.user?.name ?? 'System'} - ${u.action} on ${u.complaint?.complaintNumber ?? '—'}`,
      timestamp: u.createdAt
    }));

    res.json({ success: true, data: activity });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLocationStats = async (req, res) => {
  try {
    const locations = await prisma.location.findMany({ select: { id: true, name: true } });
    const stats = await Promise.all(locations.map(async (loc) => {
      const [total, open, resolved] = await Promise.all([
        prisma.complaint.count({ where: { locationId: loc.id, isDeleted: false } }),
        prisma.complaint.count({ where: { locationId: loc.id, status: 'OPEN', isDeleted: false } }),
        prisma.complaint.count({ where: { locationId: loc.id, status: 'RESOLVED', isDeleted: false } }),
      ]);
      return { location: loc.name, total, open, resolved };
    }));
    res.json({ success: true, data: stats.filter(s => s.total > 0) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getStats, getComplaintsChart, getRecentActivity, getLocationStats };
