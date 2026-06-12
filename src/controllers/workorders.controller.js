const prisma = require('../lib/prisma');
const { validateAssignee } = require('../utils/assignment');

const getWorkOrders = async (req, res) => {
  try {
    const { status, assigned_to, page = 1, limit = 20 } = req.query;
    const where = { isDeleted: false };

    if (req.user.role === 'CONTRACTOR') {
      where.assignedToId = req.user.userId;
    }
    if (status) where.status = status.toUpperCase();
    if (assigned_to) where.assignedToId = parseInt(assigned_to);

    const [data, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: {
          location: true,
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.workOrder.count({ where }),
    ]);

    res.json({ success: true, data, total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getWorkOrderById = async (req, res) => {
  try {
    const wo = await prisma.workOrder.findFirst({
      where: { id: parseInt(req.params.id), isDeleted: false },
      include: {
        location: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, data: wo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createWorkOrder = async (req, res) => {
  try {
    const { title, description, priority, location_id, assigned_to_id, due_date, notes } = req.body;

    const assigneeError = await validateAssignee(assigned_to_id);
    if (assigneeError) {
      return res.status(422).json({ success: false, message: assigneeError });
    }

    const count = await prisma.workOrder.count();
    const workOrderNumber = `WO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber,
        title,
        description,
        priority: priority?.toUpperCase() || 'MEDIUM',
        locationId: location_id ? parseInt(location_id) : null,
        assignedToId: assigned_to_id ? parseInt(assigned_to_id) : null,
        createdById: req.user.userId,
        dueDate: due_date ? new Date(due_date) : null,
        notes,
      },
      include: {
        location: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: wo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateWorkOrder = async (req, res) => {
  try {
    const { title, description, priority, location_id, assigned_to_id, due_date, notes, status } = req.body;

    // Guard re-assignment too: a non-null assignee must be an operational role.
    if (assigned_to_id !== undefined && assigned_to_id !== null && assigned_to_id !== '') {
      const assigneeError = await validateAssignee(assigned_to_id);
      if (assigneeError) {
        return res.status(422).json({ success: false, message: assigneeError });
      }
    }

    const updateData = {};

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (priority) updateData.priority = priority.toUpperCase();
    if (location_id !== undefined) updateData.locationId = location_id ? parseInt(location_id) : null;
    if (assigned_to_id !== undefined) updateData.assignedToId = assigned_to_id ? parseInt(assigned_to_id) : null;
    if (due_date !== undefined) updateData.dueDate = due_date ? new Date(due_date) : null;
    if (notes !== undefined) updateData.notes = notes;
    if (status) {
      updateData.status = status.toUpperCase();
      if (status.toUpperCase() === 'COMPLETED') updateData.completedDate = new Date();
    }

    const wo = await prisma.workOrder.update({
      where: { id: parseInt(req.params.id) },
      data: updateData,
      include: {
        location: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: wo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteWorkOrder = async (req, res) => {
  try {
    await prisma.workOrder.update({
      where: { id: parseInt(req.params.id) },
      data: { isDeleted: true },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getWorkOrders, getWorkOrderById, createWorkOrder, updateWorkOrder, deleteWorkOrder };
