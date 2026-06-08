const prisma = require('../lib/prisma');
const ExcelJS = require('exceljs');

// ─── Complaints report ────────────────────────────────────────────
const getComplaintsReport = async (req, res) => {
  try {
    const { start_date, end_date, location_id } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }
    if (location_id) where.locationId = parseInt(location_id);

    const complaints = await prisma.complaint.findMany({
      where,
      include: { location: true, installation: true, raisedBy: true, assignedTo: true }
    });

    const total = complaints.length;
    const resolved = complaints.filter(c => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
    const breached = complaints.filter(c => c.isSlaBreached).length;

    // Average resolution time in hours
    const resolved_complaints = complaints.filter(c => c.status === 'RESOLVED' || c.status === 'CLOSED');
    let avgResolutionHours = 0;
    if (resolved_complaints.length > 0) {
      const totalMs = resolved_complaints.reduce((sum, c) => sum + (c.updatedAt - c.createdAt), 0);
      avgResolutionHours = parseFloat((totalMs / resolved_complaints.length / 3600000).toFixed(1));
    }

    res.json({
      success: true,
      data: complaints,
      summary: {
        total,
        resolved,
        avgResolutionTime: `${avgResolutionHours} hours`,
        breachRate: total > 0 ? `${parseFloat(((breached / total) * 100).toFixed(1))}%` : '0%'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── SLA report ───────────────────────────────────────────────────
const getSlaReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }

    const complaints = await prisma.complaint.findMany({
      where,
      include: { assignedTo: true, location: true }
    });

    const total = complaints.length;
    const breached = complaints.filter(c => c.isSlaBreached).length;
    const met = total - breached;
    const percentage = total > 0 ? parseFloat(((met / total) * 100).toFixed(1)) : 100;

    const contractorMap = {};
    for (const c of complaints) {
      const name = c.assignedTo?.name || 'Unassigned';
      if (!contractorMap[name]) contractorMap[name] = { name, assigned: 0, breached: 0 };
      contractorMap[name].assigned += 1;
      if (c.isSlaBreached) contractorMap[name].breached += 1;
    }
    const byContractor = Object.values(contractorMap).map(r => ({
      ...r,
      rate: r.assigned > 0 ? parseFloat((((r.assigned - r.breached) / r.assigned) * 100).toFixed(1)) : 100
    }));

    res.json({ success: true, data: { total, breached, met, percentage, byContractor } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── FIX #4a: Maintenance report ─────────────────────────────────
const getMaintenanceReport = async (req, res) => {
  try {
    const { start_date, end_date, location_id } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }
    if (location_id) where.locationId = parseInt(location_id);

    const items = await prisma.maintenance.findMany({
      where,
      include: { location: true, installation: true, completedBy: { select: { id: true, name: true } } }
    });

    const total = items.length;
    const completed = items.filter(m => m.status === 'COMPLETED').length;
    const overdue = items.filter(m => m.status === 'OVERDUE').length;
    const upcoming = items.filter(m => m.status === 'UPCOMING').length;
    const due = items.filter(m => m.status === 'DUE').length;

    // Group by location
    const locationMap = {};
    for (const m of items) {
      const name = m.location?.name || 'Unknown';
      if (!locationMap[name]) locationMap[name] = { location: name, total: 0, completed: 0, overdue: 0 };
      locationMap[name].total += 1;
      if (m.status === 'COMPLETED') locationMap[name].completed += 1;
      if (m.status === 'OVERDUE') locationMap[name].overdue += 1;
    }

    // Group by type
    const typeMap = {};
    for (const m of items) {
      if (!typeMap[m.type]) typeMap[m.type] = { type: m.type, total: 0, completed: 0 };
      typeMap[m.type].total += 1;
      if (m.status === 'COMPLETED') typeMap[m.type].completed += 1;
    }

    res.json({
      success: true,
      data: {
        summary: { total, completed, overdue, upcoming, due },
        byLocation: Object.values(locationMap),
        byType: Object.values(typeMap),
        items
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── FIX #4b: Contractor performance report ───────────────────────
const getContractorPerformance = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }

    const complaints = await prisma.complaint.findMany({
      where: { ...where, assignedToId: { not: null } },
      include: { assignedTo: true }
    });

    const workOrders = await prisma.workOrder.findMany({
      where: { ...where, assignedToId: { not: null } },
      include: { assignedTo: true }
    });

    const contractorMap = {};

    for (const c of complaints) {
      if (!c.assignedTo) continue;
      const id = c.assignedTo.id;
      if (!contractorMap[id]) {
        contractorMap[id] = {
          id,
          name: c.assignedTo.name,
          email: c.assignedTo.email,
          complaintsAssigned: 0,
          complaintsResolved: 0,
          slaBreached: 0,
          totalResolutionMs: 0,
          workOrdersAssigned: 0,
          workOrdersCompleted: 0
        };
      }
      contractorMap[id].complaintsAssigned += 1;
      if (c.status === 'RESOLVED' || c.status === 'CLOSED') {
        contractorMap[id].complaintsResolved += 1;
        contractorMap[id].totalResolutionMs += (c.updatedAt - c.createdAt);
      }
      if (c.isSlaBreached) contractorMap[id].slaBreached += 1;
    }

    for (const wo of workOrders) {
      if (!wo.assignedTo) continue;
      const id = wo.assignedTo.id;
      if (!contractorMap[id]) {
        contractorMap[id] = {
          id,
          name: wo.assignedTo.name,
          email: wo.assignedTo.email,
          complaintsAssigned: 0,
          complaintsResolved: 0,
          slaBreached: 0,
          totalResolutionMs: 0,
          workOrdersAssigned: 0,
          workOrdersCompleted: 0
        };
      }
      contractorMap[id].workOrdersAssigned += 1;
      if (wo.status === 'COMPLETED') contractorMap[id].workOrdersCompleted += 1;
    }

    const result = Object.values(contractorMap).map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      assigned: c.complaintsAssigned,
      resolved: c.complaintsResolved,
      slaBreached: c.slaBreached,
      slaRate: c.complaintsAssigned > 0
        ? parseFloat((((c.complaintsAssigned - c.slaBreached) / c.complaintsAssigned) * 100).toFixed(1))
        : 100,
      avgTime: c.complaintsResolved > 0
        ? `${parseFloat((c.totalResolutionMs / c.complaintsResolved / 3600000).toFixed(1))}h`
        : '—',
      workOrdersAssigned: c.workOrdersAssigned,
      workOrdersCompleted: c.workOrdersCompleted
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Department-wise report ───────────────────────────────────────
// Groups complaints by the raiser's department (User.department). Single
// "Electrical" department for this site, but sub-departments can be set per
// user and will each get a row here.
const getDepartmentReport = async (req, res) => {
  try {
    const { start_date, end_date, location_id } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }
    if (location_id) where.locationId = parseInt(location_id);

    const complaints = await prisma.complaint.findMany({
      where,
      include: { raisedBy: { select: { id: true, department: true } } }
    });

    const deptMap = {};
    for (const c of complaints) {
      const name = c.raisedBy?.department?.trim() || 'Unspecified';
      if (!deptMap[name]) {
        deptMap[name] = { department: name, total: 0, resolved: 0, breached: 0, totalResolutionMs: 0, resolvedCount: 0 };
      }
      const d = deptMap[name];
      d.total += 1;
      if (c.status === 'RESOLVED' || c.status === 'CLOSED') {
        d.resolved += 1;
        d.resolvedCount += 1;
        d.totalResolutionMs += (c.updatedAt - c.createdAt);
      }
      if (c.isSlaBreached) d.breached += 1;
    }

    const byDepartment = Object.values(deptMap).map(d => ({
      department: d.department,
      total: d.total,
      resolved: d.resolved,
      breached: d.breached,
      slaRate: d.total > 0 ? parseFloat((((d.total - d.breached) / d.total) * 100).toFixed(1)) : 100,
      avgTime: d.resolvedCount > 0
        ? `${parseFloat((d.totalResolutionMs / d.resolvedCount / 3600000).toFixed(1))}h`
        : '—'
    })).sort((a, b) => b.total - a.total);

    res.json({ success: true, data: byDepartment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Excel export (complaints) ────────────────────────────────────
const exportComplaintsExcel = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }

    const data = await prisma.complaint.findMany({
      where,
      include: { location: true, raisedBy: true, assignedTo: true }
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Complaints');

    worksheet.columns = [
      { header: 'Complaint No', key: 'complaintNumber', width: 20 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'SLA Breached', key: 'slaBreached', width: 14 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Raised By', key: 'raisedBy', width: 20 },
      { header: 'Assigned To', key: 'assignedTo', width: 20 },
      { header: 'SLA Deadline', key: 'slaDeadline', width: 25 },
      { header: 'Created At', key: 'createdAt', width: 25 }
    ];

    // Bold header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD62828' } };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    data.forEach(c => {
      const row = worksheet.addRow({
        complaintNumber: c.complaintNumber,
        title: c.title,
        status: c.status,
        priority: c.priority,
        slaBreached: c.isSlaBreached ? 'YES' : 'No',
        location: c.location.name,
        raisedBy: c.raisedBy.name,
        assignedTo: c.assignedTo?.name || 'Unassigned',
        slaDeadline: c.slaDeadline,
        createdAt: c.createdAt
      });
      if (c.isSlaBreached) {
        row.getCell('slaBreached').font = { color: { argb: 'FFD62828' }, bold: true };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=complaints_report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── FIX #5: PDF export of SLA summary ───────────────────────────
const exportReportPdf = async (req, res) => {
  try {
    const { type = 'sla', start_date, end_date } = req.query;
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

    const where = { isDeleted: false };
    if (start_date && end_date) {
      where.createdAt = { gte: new Date(start_date), lte: new Date(end_date) };
    }

    const complaints = await prisma.complaint.findMany({
      where,
      include: { assignedTo: true, raisedBy: { select: { department: true } } }
    });
    const total = complaints.length;
    const breached = complaints.filter(c => c.isSlaBreached).length;
    const met = total - breached;
    const pct = total > 0 ? ((met / total) * 100).toFixed(1) : '100';
    const dateLabel = start_date && end_date
      ? `${start_date} to ${end_date}`
      : 'All time';

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const sailRed = rgb(0.851, 0.157, 0.157);
    const dark = rgb(0.1, 0.1, 0.1);
    const mid = rgb(0.4, 0.4, 0.4);

    // Header bar
    page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: sailRed });
    page.drawText('SAIL MIOM — Electrical Department', { x: 40, y: height - 35, size: 16, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Management Report', { x: 40, y: height - 55, size: 11, font: regFont, color: rgb(0.9, 0.9, 0.9) });

    let y = height - 110;
    const line = (label, value, yPos) => {
      page.drawText(label, { x: 40, y: yPos, size: 11, font: regFont, color: mid });
      page.drawText(String(value), { x: 250, y: yPos, size: 11, font: boldFont, color: dark });
    };

    const isDept = type === 'department';
    page.drawText(isDept ? 'Department Report Summary' : 'SLA Report Summary',
      { x: 40, y, size: 14, font: boldFont, color: sailRed });
    y -= 24;
    line('Period:', dateLabel, y); y -= 20;
    line('Total Complaints:', total, y); y -= 20;
    line('SLA Met:', met, y); y -= 20;
    line('SLA Breached:', breached, y); y -= 20;
    line('Adherence Rate:', `${pct}%`, y); y -= 40;

    // Breakdown — by department or by contractor depending on the requested type.
    const groupMap = {};
    for (const c of complaints) {
      const name = isDept
        ? (c.raisedBy?.department?.trim() || 'Unspecified')
        : (c.assignedTo?.name || 'Unassigned');
      if (!groupMap[name]) groupMap[name] = { assigned: 0, breached: 0 };
      groupMap[name].assigned += 1;
      if (c.isSlaBreached) groupMap[name].breached += 1;
    }

    page.drawText(isDept ? 'Complaints by Department' : 'SLA by Contractor',
      { x: 40, y, size: 13, font: boldFont, color: sailRed });
    y -= 20;

    // Table header
    page.drawRectangle({ x: 40, y: y - 4, width: 515, height: 20, color: rgb(0.95, 0.95, 0.95) });
    page.drawText(isDept ? 'Department' : 'Contractor', { x: 46, y, size: 10, font: boldFont, color: dark });
    page.drawText(isDept ? 'Raised' : 'Assigned', { x: 260, y, size: 10, font: boldFont, color: dark });
    page.drawText('Breached', { x: 360, y, size: 10, font: boldFont, color: dark });
    page.drawText('Rate', { x: 460, y, size: 10, font: boldFont, color: dark });
    y -= 24;

    for (const [name, stats] of Object.entries(groupMap)) {
      if (y < 60) break;
      const rate = stats.assigned > 0 ? (((stats.assigned - stats.breached) / stats.assigned) * 100).toFixed(1) : '100';
      page.drawText(name, { x: 46, y, size: 10, font: regFont, color: dark });
      page.drawText(String(stats.assigned), { x: 260, y, size: 10, font: regFont, color: dark });
      page.drawText(String(stats.breached), { x: 360, y, size: 10, font: regFont, color: stats.breached > 0 ? sailRed : dark });
      page.drawText(`${rate}%`, { x: 460, y, size: 10, font: boldFont, color: parseFloat(rate) >= 90 ? rgb(0.18, 0.62, 0.37) : sailRed });
      y -= 18;
    }

    // Footer
    page.drawText(`Generated: ${new Date().toLocaleString('en-IN')}`, { x: 40, y: 30, size: 9, font: regFont, color: mid });
    page.drawText('SAIL MIOM Electrical Dept — Confidential', { x: 350, y: 30, size: 9, font: regFont, color: mid });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=sail_miom_${type}_report.pdf`);
    res.end(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getComplaintsReport,
  getSlaReport,
  getMaintenanceReport,
  getContractorPerformance,
  getDepartmentReport,
  exportComplaintsExcel,
  exportReportPdf
};
