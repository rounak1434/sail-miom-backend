const prisma = require('../lib/prisma');
const { v4: uuidv4 } = require('uuid');
const { uploadBuffer } = require('../services/s3.service');
// How many months to add per maintenance type
const TYPE_MONTHS = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12
};

const getMaintenance = async (req, res) => {
  try {
    const { status, location_id, month, page = 1, limit = 20 } = req.query;
    const where = { isDeleted: false };

    if (status) where.status = status.toUpperCase();
    if (location_id) where.locationId = parseInt(location_id);
    if (month) {
      const [year, m] = month.split('-');
      const start = new Date(year, parseInt(m) - 1, 1);
      const end = new Date(year, parseInt(m), 0);
      where.dueDate = { gte: start, lte: end };
    }

    const [data, total] = await Promise.all([
      prisma.maintenance.findMany({
        where,
        include: {
          location: true,
          installation: true,
          completedBy: { select: { id: true, name: true } }
        },
        orderBy: { dueDate: 'asc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.maintenance.count({ where })
    ]);

    const now = new Date();
    const enriched = data.map(m => ({
      ...m,
      daysOverdue: m.status === 'OVERDUE'
        ? Math.floor((now - new Date(m.dueDate)) / (1000 * 60 * 60 * 24))
        : 0
    }));

    res.json({ success: true, data: enriched, total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// FIX #10: Accept photo uploads + FIX #9: auto-schedule next cycle
const completeMaintenance = async (req, res) => {
  try {
    const { notes, parts_used, cost } = req.body;
    const id = parseInt(req.params.id);

    const existing = await prisma.maintenance.findUnique({
      where: { id },
      include: { installation: true }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Maintenance task not found' });
    }

    // FIX #10: Upload any attached photos to S3
    let photoUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const key = `maintenance-photos/${uuidv4()}-${file.originalname}`;
        await uploadBuffer(key, file.buffer, file.mimetype);
        // Store the S3 key as reference (signed URL will be generated on read)
        photoUrls.push(key);
      }
    }

    const maintenance = await prisma.maintenance.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedDate: new Date(),
        completedById: req.user.userId,
        notes,
        partsUsed: parts_used,
        cost: cost ? parseFloat(cost) : null,
        photoUrls
      }
    });

    // FIX #9: Auto-create the next maintenance cycle
    const monthsToAdd = TYPE_MONTHS[existing.type] || 3;
    const nextDue = new Date(existing.dueDate);
    nextDue.setMonth(nextDue.getMonth() + monthsToAdd);

    await prisma.maintenance.create({
      data: {
        title: existing.title,
        type: existing.type,
        locationId: existing.locationId,
        installationId: existing.installationId,
        dueDate: nextDue,
        checklist: existing.checklist,
        status: 'UPCOMING'
      }
    });

    res.json({ success: true, data: maintenance, nextCycleScheduled: nextDue });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createMaintenance = async (req, res) => {
  try {
    // Accept both snake_case and camelCase keys
    const b = req.body;
    const title = b.title;
    const type = b.type;
    const locationId = b.location_id ?? b.locationId;
    const installationId = b.installation_id ?? b.installationId;
    const dueDate = b.due_date ?? b.dueDate;
    const checklist = b.checklist;

    if (!title || !type || !locationId || !installationId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'title, type, location, installation and due date are all required'
      });
    }

    const maintenance = await prisma.maintenance.create({
      data: {
        title,
        type: String(type).toUpperCase(),
        locationId: parseInt(locationId),
        installationId: parseInt(installationId),
        dueDate: new Date(dueDate),
        checklist: Array.isArray(checklist) ? checklist : [],
        status: 'UPCOMING'
      }
    });

    res.status(201).json({ success: true, data: maintenance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateMaintenance = async (req, res) => {
  try {
    const b = req.body;
    const { status, completionNotes, notes, parts_used, cost } = b;
    const updateData = {};
    if (status) updateData.status = status.toUpperCase();
    if (status === 'completed' || status === 'COMPLETED') {
      updateData.completedDate = new Date();
      updateData.completedById = req.user.userId;
    }
    if (completionNotes || notes) updateData.notes = completionNotes || notes;
    if (parts_used) updateData.partsUsed = parts_used;
    if (cost) updateData.cost = parseFloat(cost);

    // Editable schedule fields (accept both snake_case and camelCase keys)
    if (b.title != null) updateData.title = b.title;
    if (b.type != null) updateData.type = String(b.type).toUpperCase();
    const locationId = b.location_id ?? b.locationId;
    if (locationId != null && locationId !== '') updateData.locationId = parseInt(locationId);
    const installationId = b.installation_id ?? b.installationId;
    if (installationId != null && installationId !== '') updateData.installationId = parseInt(installationId);
    const dueDate = b.due_date ?? b.dueDate;
    if (dueDate) updateData.dueDate = new Date(dueDate);
    if (Array.isArray(b.checklist)) updateData.checklist = b.checklist;

    const maintenance = await prisma.maintenance.update({
      where: { id: parseInt(req.params.id) },
      data: updateData
    });
    res.json({ success: true, data: maintenance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Soft-delete (getMaintenance filters isDeleted:false), consistent with the rest of the schema.
const deleteMaintenance = async (req, res) => {
  try {
    await prisma.maintenance.update({
      where: { id: parseInt(req.params.id) },
      data: { isDeleted: true }
    });
    res.json({ success: true, message: 'Maintenance schedule deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getMaintenance, completeMaintenance, createMaintenance, updateMaintenance, deleteMaintenance };
