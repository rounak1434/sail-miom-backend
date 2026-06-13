const prisma = require('../lib/prisma');
const { validateAssignee } = require('../utils/assignment');
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

// Civilian GUEST complaint — no login, no account. The submitter supplies their
// name/phone/address (email optional); the complaint is stored with
// source=CIVILIAN_GUEST and NO raiser User. They get a reference number back to
// quote later (there is no in-app tracking for guests). IP-rate-limited in the route.
const createGuestComplaint = async (req, res) => {
  try {
    const b = req.body;
    const name = String(b.name ?? b.guestName ?? b.houseOwnerName ?? '').trim();
    const phone = String(b.phone ?? b.phoneNumber ?? b.guestPhone ?? b.houseOwnerPhone ?? '').trim();
    const address = String(b.address ?? '').trim();
    const emailRaw = String(b.email ?? b.guestEmail ?? '').trim();
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    const title = String(b.title ?? '').trim();
    const description = String(b.description ?? '').trim();
    const landmark = b.landmark ? String(b.landmark).trim() : null;
    const priority = String(b.priority ?? 'MEDIUM').toUpperCase();

    // Required: name, phone, address, and an issue title. Email is optional.
    if (!name || !phone || !address || !title) {
      return res.status(400).json({
        success: false,
        message: 'name, phone number, address and a complaint title are required'
      });
    }
    if (email && !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    const VALID_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const finalPriority = VALID_PRIORITIES.includes(priority) ? priority : 'MEDIUM';

    const year = new Date().getFullYear();
    const slaDeadline = await calculateSlaDeadline(finalPriority);

    const complaint = await prisma.$transaction(async (tx) => {
      // Civilian-guest complaints get a human-friendly SEQUENTIAL number
      // (MIOM-YYYY-000001). The per-year counter is bumped atomically with an
      // INSERT … ON CONFLICT so concurrent guest submissions never collide.
      const rows = await tx.$queryRaw`
        INSERT INTO "ComplaintCounter" ("year", "lastSeq") VALUES (${year}, 1)
        ON CONFLICT ("year") DO UPDATE SET "lastSeq" = "ComplaintCounter"."lastSeq" + 1
        RETURNING "lastSeq"`;
      const seq = Number(rows[0].lastSeq);
      const complaintNumber = `MIOM-${year}-${String(seq).padStart(6, '0')}`;

      const created = await tx.complaint.create({
        data: {
          complaintNumber,
          title,
          description,
          priority: finalPriority,
          source: 'CIVILIAN_GUEST',
          address,
          landmark,
          houseOwnerName: name,
          houseOwnerPhone: phone,
          guestName: name,
          guestPhone: phone,
          guestEmail: email,
          raisedById: null, // no account — guest complaint
          slaDeadline
        }
      });
      await tx.complaintUpdate.create({
        data: {
          complaintId: created.id,
          action: 'Complaint created (civilian guest)',
          userId: null // no actor — guest has no User row
        }
      });
      return created;
    });

    // Return only what a guest needs: the reference number to quote later.
    res.status(201).json({
      success: true,
      data: {
        id: complaint.id,
        complaintNumber: complaint.complaintNumber,
        referenceNumber: complaint.complaintNumber,
        status: complaint.status
      },
      message: 'Complaint submitted. Please save your reference number.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public complaint tracking — no auth. A civilian proves ownership with the
// complaint number AND the phone number they filed under; only then is the
// complaint returned. Any mismatch (wrong number OR wrong phone) returns the
// SAME 404 so the endpoint can't be used to enumerate complaints. Rate-limited.
const trackComplaint = async (req, res) => {
  try {
    const complaintNumber = String(req.body.complaintNumber ?? req.body.complaint_number ?? '').trim();
    const phone = String(req.body.phone ?? req.body.phoneNumber ?? req.body.mobile ?? '').trim();
    if (!complaintNumber || !phone) {
      return res.status(400).json({ success: false, message: 'Complaint number and phone number are required' });
    }

    const complaint = await prisma.complaint.findFirst({
      where: { complaintNumber, isDeleted: false },
      include: {
        installationType: true,
        location: true,
        assignedTo: { select: { name: true, role: true } },
        updates: {
          orderBy: { createdAt: 'asc' },
          select: { action: true, toStatus: true, note: true, createdAt: true }
        }
      }
    });

    // Ownership check: the phone must match what was filed (guest or house owner).
    const phoneMatch =
      complaint &&
      [complaint.guestPhone, complaint.houseOwnerPhone]
        .filter(Boolean)
        .some((p) => String(p).trim() === phone);

    if (!complaint || !phoneMatch) {
      return res.status(404).json({
        success: false,
        message: 'No complaint found for that number and phone. Check both and try again.'
      });
    }

    return res.json({
      success: true,
      data: {
        complaintNumber: complaint.complaintNumber,
        title: complaint.title,
        description: complaint.description,
        status: complaint.status,
        priority: complaint.priority,
        category: complaint.installationType?.name
          ?? (complaint.source === 'CIVILIAN_GUEST' ? 'Civilian Complaint' : complaint.source),
        location: complaint.location?.name ?? complaint.address ?? null,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt,
        assignedRole: complaint.assignedTo?.role ?? null,
        assignedUser: complaint.assignedTo?.name ?? null,
        timeline: complaint.updates.map((u) => ({
          action: u.action,
          status: u.toStatus ?? null,
          note: u.note ?? null,
          at: u.createdAt
        }))
      }
    });
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

    // Same policy as work orders: complaints may only be assigned to an
    // operational role — never a civilian (PUBLIC / CIVILIAN_GUEST), a
    // not-yet-approved (PENDING), or an inactive account.
    const assigneeError = await validateAssignee(assignedToId, 'complaint');
    if (assigneeError) {
      return res.status(422).json({ success: false, message: assigneeError });
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
    const newStatus = status.toUpperCase();
    const oldComplaint = await prisma.complaint.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    // SLA is decided at the moment of resolution: a complaint is BREACHED only
    // if it is resolved/closed AFTER its deadline (or stays open past it — that
    // path is handled by the cron). Recomputing here clears stale breach flags
    // left by the cron when a complaint is later resolved on time.
    const updateData = { status: newStatus };
    if (newStatus === 'RESOLVED' || newStatus === 'CLOSED') {
      const breachedLate = !!oldComplaint.slaDeadline && new Date() > oldComplaint.slaDeadline;
      updateData.isSlaBreached = breachedLate;
      updateData.slaBreachedAt = breachedLate ? (oldComplaint.slaBreachedAt ?? new Date()) : null;
    }

    const complaint = await prisma.complaint.update({
      where: { id: parseInt(req.params.id) },
      data: updateData
    });

    await prisma.complaintUpdate.create({
      data: {
        complaintId: complaint.id,
        action: `Status changed to ${status}`,
        fromStatus: oldComplaint.status,
        toStatus: newStatus,
        note,
        userId: req.user.userId
      }
    });

    // Notify complaint raiser (guest complaints have no raiser → skip).
    if (complaint.raisedById) {
      await sendPushToUser(
        complaint.raisedById,
        'Complaint Updated',
        `Status changed to ${status}`,
        { complaintId: String(complaint.id), type: 'COMPLAINT_UPDATED' }
      );
    }

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
  getComplaints, getComplaintById, createComplaint, createGuestComplaint,
  trackComplaint,
  assignComplaint, updateComplaintStatus, deleteComplaint, addComment,
  getTimeline, addAttachments, deleteAttachment
};
