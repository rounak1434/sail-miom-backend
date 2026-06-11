const prisma = require('../lib/prisma');
const { calculateSlaDeadline } = require('../services/sla.service');
const { sendPushToUser } = require('../services/notification.service');
const { getSignedDownloadUrl, deleteFromS3 } = require('../services/s3.service');
// Replace each attachment's fileUrl with a short-lived signed URL so private
// S3 objects can be viewed. Falls back to the stored url if signing fails.
async function signAttachments(attachments) {
  if (!attachments || attachments.length === 0) return attachments || [];
  return Promise.all(
    attachments.map(async (a) => {
      try {
        return { ...a, fileUrl: await getSignedDownloadUrl(a.s3Key) };
      } catch (_) {
        return a;
      }
    })
  );
}

const VALID_SORT_FIELDS = ['createdAt', 'updatedAt', 'priority', 'status', 'slaDeadline'];

const getComplaints = async (req, res) => {
  try {
    const {
      status, priority, location_id, assigned_to,
      search, page = 1, limit = 20,
      sort = 'createdAt', order = 'desc'
    } = req.query;

    const where = { isDeleted: false };
    if (status) where.status = status.toUpperCase();
    if (priority) where.priority = priority.toUpperCase();
    if (location_id) where.locationId = parseInt(location_id);
    if (assigned_to) where.assignedToId = parseInt(assigned_to);
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { complaintNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Role-based filtering
    if (req.user.role === 'ENGINEER') where.raisedById = req.user.userId;
    if (req.user.role === 'CONTRACTOR') where.assignedToId = req.user.userId;
    // PUBLIC civilians only ever see their OWN HOUSE-maintenance complaints —
    // never internal SAIL complaints, and never anyone else's.
    if (req.user.role === 'PUBLIC') {
      where.raisedById = req.user.userId;
      where.source = 'HOUSE';
    }
    // Optional source filter for internal staff (e.g. only show HOUSE complaints).
    if (req.user.role !== 'PUBLIC' && (req.query.source === 'HOUSE' || req.query.source === 'INTERNAL')) {
      where.source = req.query.source;
    }

    const [data, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        include: {
          location: true,
          installationType: true,
          installation: true,
          raisedBy: { select: { id: true, name: true, employeeId: true } },
          assignedTo: { select: { id: true, name: true, employeeId: true } },
          attachments: true,
          _count: { select: { comments: true, updates: true } }
        },
        orderBy: { [VALID_SORT_FIELDS.includes(sort) ? sort : 'createdAt']: order === 'asc' ? 'asc' : 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.complaint.count({ where })
    ]);

    res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getComplaintById = async (req, res) => {
  try {
    const complaint = await prisma.complaint.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        location: true,
        installationType: true,
        installation: true,
        raisedBy: { select: { id: true, name: true, employeeId: true, phone: true } },
        assignedTo: { select: { id: true, name: true, employeeId: true, phone: true } },
        attachments: true,
        updates: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' }
        },
        comments: {
          include: { user: { select: { id: true, name: true, profilePicUrl: true } } },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!complaint || complaint.isDeleted) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    // PUBLIC civilians may only view their own complaints.
    if (req.user.role === 'PUBLIC' && complaint.raisedById !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    complaint.attachments = await signAttachments(complaint.attachments);
    res.json({ success: true, data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createComplaint = async (req, res) => {
  try {
    // Accept both snake_case (web admin) and camelCase (mobile app) keys.
    const b = req.body;
    const title = b.title;
    // description is non-nullable in the schema; coerce a missing value to ''
    // so a client that omits it gets a clean response instead of a raw 500
    // (which would also leak the server file path / record shape).
    const description = b.description ?? '';
    const priority = b.priority;
    const location_id = b.location_id ?? b.locationId;
    const installation_type_id = b.installation_type_id ?? b.installationTypeId;
    const installation_id = b.installation_id ?? b.installationId;
    const safety_concern = b.safety_concern ?? b.safetyConcern;
    const safety_description = b.safety_description ?? b.safetyDescription;
    const estimated_downtime = b.estimated_downtime ?? b.estimatedDowntime;
    const address = b.address;
    const house_owner_name = b.house_owner_name ?? b.houseOwnerName;
    const house_owner_phone = b.house_owner_phone ?? b.houseOwnerPhone;
    const landmark = b.landmark;

    // PUBLIC (civilian house-maintenance) complaints have no SAIL plant
    // location/installation — they carry an address instead. The backend, not
    // the client, decides the source from the authenticated role.
    const isPublic = req.user.role === 'PUBLIC';

    if (isPublic) {
      if (!title || !priority || !address) {
        return res.status(400).json({
          success: false,
          message: 'title, priority and address are required'
        });
      }
    } else if (!title || !priority || !location_id || !installation_type_id) {
      return res.status(400).json({
        success: false,
        message: 'title, priority, location and installation type are required'
      });
    }

    const year = new Date().getFullYear();
    const suffix = Date.now().toString(36).slice(-4).toUpperCase() +
                   Math.random().toString(36).slice(-2).toUpperCase();
    const complaintNumber = `MIOM-${year}-${suffix}`;
    const slaDeadline = await calculateSlaDeadline(priority.toUpperCase());

    const complaint = await prisma.$transaction(async (tx) => {
      const created = await tx.complaint.create({
        data: {
          complaintNumber,
          title,
          description,
          priority: priority.toUpperCase(),
          source: isPublic ? 'HOUSE' : 'INTERNAL',
          address: isPublic ? address : null,
          houseOwnerName: isPublic ? (house_owner_name || req.user.name) : null,
          houseOwnerPhone: isPublic ? (house_owner_phone || req.user.phoneNumber || null) : null,
          landmark: isPublic ? (landmark || null) : null,
          locationId: location_id ? parseInt(location_id) : null,
          installationTypeId: installation_type_id ? parseInt(installation_type_id) : null,
          installationId: installation_id ? parseInt(installation_id) : null,
          safetyConcern: safety_concern || false,
          safetyDescription: safety_description,
          estimatedDowntime: estimated_downtime,
          raisedById: req.user.userId,
          slaDeadline
        },
        include: {
          location: true,
          installationType: true,
          raisedBy: { select: { id: true, name: true } }
        }
      });
      await tx.complaintUpdate.create({
        data: {
          complaintId: created.id,
          action: 'Complaint created',
          userId: req.user.userId
        }
      });
      return created;
    });

    res.status(201).json({ success: true, data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const assignComplaint = async (req, res) => {
  try {
    const b = req.body;
    // Accept several key spellings from the web admin / mobile app.
    const assignedToId = b.assigned_to_id ?? b.assignedToId ?? b.contractorId ?? b.contractor_id;
    const note = b.note;

    if (!assignedToId) {
      return res.status(400).json({ success: false, message: 'assignee is required' });
    }

    const complaint = await prisma.complaint.update({
      where: { id: parseInt(req.params.id) },
      data: {
        assignedToId: parseInt(assignedToId),
        status: 'IN_PROGRESS'
      },
      include: { assignedTo: true }
    });

    await prisma.complaintUpdate.create({
      data: {
        complaintId: complaint.id,
        action: 'Complaint assigned',
        toStatus: 'IN_PROGRESS',
        note,
        userId: req.user.userId
      }
    });

    // Push notification to contractor
    await sendPushToUser(
      parseInt(assignedToId),
      'New Complaint Assigned',
      complaint.title,
      { complaintId: String(complaint.id), type: 'NEW_COMPLAINT_ASSIGNED' }
    );

    res.json({ success: true, data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateComplaintStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const oldComplaint = await prisma.complaint.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    const complaint = await prisma.complaint.update({
      where: { id: parseInt(req.params.id) },
      data: { status: status.toUpperCase() }
    });

    await prisma.complaintUpdate.create({
      data: {
        complaintId: complaint.id,
        action: `Status changed to ${status}`,
        fromStatus: oldComplaint.status,
        toStatus: status.toUpperCase(),
        note,
        userId: req.user.userId
      }
    });

    // Notify complaint raiser
    await sendPushToUser(
      complaint.raisedById,
      'Complaint Updated',
      `Status changed to ${status}`,
      { complaintId: String(complaint.id), type: 'COMPLAINT_UPDATED' }
    );

    res.json({ success: true, data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteComplaint = async (req, res) => {
  try {
    await prisma.complaint.update({
      where: { id: parseInt(req.params.id) },
      data: { isDeleted: true }
    });
    res.json({ success: true, message: 'Complaint deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const addComment = async (req, res) => {
  try {
    const comment = await prisma.comment.create({
      data: {
        complaintId: parseInt(req.params.id),
        userId: req.user.userId,
        text: req.body.text
      },
      include: {
        user: { select: { id: true, name: true, profilePicUrl: true } }
      }
    });
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTimeline = async (req, res) => {
  try {
    const updates = await prisma.complaintUpdate.findMany({
      where: { complaintId: parseInt(req.params.id) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const timeline = updates.map((u) => ({
      action: u.action,
      user: u.user?.name ?? 'System',
      note: u.note ?? null,
      fromStatus: u.fromStatus ?? null,
      toStatus: u.toStatus ?? null,
      timestamp: u.createdAt
    }));
    res.json({ success: true, data: timeline });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Upload one or more photos for a complaint. Files are streamed to S3 by the
// attachmentUpload (multer-s3) middleware, so req.files carry .key/.location.
const addAttachments = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    const complaintId = parseInt(req.params.id);
    const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } });
    if (!complaint || complaint.isDeleted) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const created = [];
    for (const f of req.files) {
      const att = await prisma.attachment.create({
        data: {
          complaintId,
          fileUrl: f.location || '',
          s3Key: f.key,
          fileName: f.originalname,
          fileSize: f.size,
          fileType: f.mimetype
        }
      });
      created.push(att);
    }

    await prisma.complaintUpdate.create({
      data: {
        complaintId,
        action: `${created.length} photo${created.length > 1 ? 's' : ''} attached`,
        userId: req.user.userId
      }
    });

    res.status(201).json({ success: true, data: await signAttachments(created) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteAttachment = async (req, res) => {
  try {
    const complaintId = parseInt(req.params.id);
    const attachmentId = parseInt(req.params.attachmentId);
    const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.complaintId !== complaintId) {
      return res.status(404).json({ success: false, message: 'Attachment not found' });
    }
    try { await deleteFromS3(att.s3Key); } catch (_) { /* object may already be gone */ }
    await prisma.attachment.delete({ where: { id: attachmentId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getComplaints, getComplaintById, createComplaint,
  assignComplaint, updateComplaintStatus, deleteComplaint, addComment,
  getTimeline, addAttachments, deleteAttachment
};
