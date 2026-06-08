const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const { getSignedDownloadUrl, deleteFromS3, uploadBuffer } = require('../services/s3.service');
const { sendRoleNotification } = require('../services/notification.service');
const { addWatermark } = require('../utils/pdfHelper');
const prisma = new PrismaClient();

const getDrawings = async (req, res) => {
  try {
    const { location_id, installation_type_id, type, search, page = 1, limit = 20 } = req.query;
    const where = { isDeleted: false };

    if (location_id) where.locationId = parseInt(location_id);
    if (installation_type_id) where.installationTypeId = parseInt(installation_type_id);
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { drawingNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [data, total] = await Promise.all([
      prisma.drawing.findMany({
        where,
        include: { location: true, installation: true, installationType: true },
        orderBy: { updatedAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.drawing.count({ where })
    ]);

    res.json({ success: true, data, total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDrawingById = async (req, res) => {
  try {
    const drawing = await prisma.drawing.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        location: true,
        installation: true,
        installationType: true,
        versions: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!drawing || drawing.isDeleted) {
      return res.status(404).json({ success: false, message: 'Drawing not found' });
    }

    const signedUrl = await getSignedDownloadUrl(drawing.s3Key);
    res.json({ success: true, data: { ...drawing, signedUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDownloadUrl = async (req, res) => {
  try {
    const drawing = await prisma.drawing.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!drawing) {
      return res.status(404).json({ success: false, message: 'Drawing not found' });
    }

    const downloadUrl = await getSignedDownloadUrl(drawing.s3Key, 3600);
    res.json({ success: true, downloadUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// FIX #1 + #2 + #3: watermark applied, version record created, installationTypeId saved
const uploadDrawing = async (req, res) => {
  try {
    // Accept both snake_case and camelCase keys from the web admin.
    const b = req.body;
    const title = b.title;
    const drawing_number = b.drawing_number ?? b.drawingNumber;
    const type = b.type;
    const location_id = b.location_id ?? b.locationId;
    const installation_id = b.installation_id ?? b.installationId;
    const installation_type_id = b.installation_type_id ?? b.installationTypeId;
    const version = b.version;
    const notes = b.notes ?? b.description;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    if (!title || !drawing_number || !location_id) {
      return res.status(400).json({ success: false, message: 'title, drawing number and location are required' });
    }

    const isPdf = req.file.mimetype === 'application/pdf';
    const s3Key = `drawings/${uuidv4()}-${req.file.originalname}`;
    const contentType = isPdf ? 'application/pdf' : 'application/octet-stream';

    // FIX #1: Apply watermark to PDFs before uploading to S3
    let fileBuffer = req.file.buffer;
    if (isPdf) {
      const watermarkText = `SAIL MIOM - INTERNAL USE ONLY - ${drawing_number || 'CONFIDENTIAL'}`;
      fileBuffer = await addWatermark(fileBuffer, watermarkText);
    }

    await uploadBuffer(s3Key, fileBuffer, contentType);

    const versionLabel = version || 'v1.0';

    // FIX #3: Save installationTypeId
    const drawing = await prisma.drawing.create({
      data: {
        title,
        drawingNumber: drawing_number,
        type,
        locationId: parseInt(location_id),
        installationId: installation_id ? parseInt(installation_id) : null,
        installationTypeId: installation_type_id ? parseInt(installation_type_id) : null,
        s3Key,
        fileSize: req.file.size,
        currentVersion: versionLabel,
        isEncrypted: isPdf,
        uploadedById: req.user.userId
      },
      include: { location: true, installationType: true }
    });

    // FIX #2: Create the initial DrawingVersion record
    await prisma.drawingVersion.create({
      data: {
        drawingId: drawing.id,
        version: versionLabel,
        s3Key,
        fileSize: req.file.size,
        notes: notes || 'Initial upload',
        uploadedBy: req.user.userId
      }
    });

    // Notify engineers that a new drawing is available.
    await sendRoleNotification(
      ['ENGINEER'],
      '📐 New Drawing Available',
      `${drawing.title} (${drawing.drawingNumber}) has been uploaded`,
      { drawingId: String(drawing.id), type: 'NEW_DRAWING' }
    );

    res.status(201).json({ success: true, data: drawing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update drawing metadata and optionally upload a new version
const updateDrawing = async (req, res) => {
  try {
    const { title, type, location_id, installation_id, installation_type_id, version, notes } = req.body;
    const drawingId = parseInt(req.params.id);

    const existing = await prisma.drawing.findUnique({ where: { id: drawingId } });
    if (!existing || existing.isDeleted) {
      return res.status(404).json({ success: false, message: 'Drawing not found' });
    }

    const updateData = {};
    if (title) updateData.title = title;
    if (type) updateData.type = type;
    if (location_id) updateData.locationId = parseInt(location_id);
    if (installation_id !== undefined) updateData.installationId = installation_id ? parseInt(installation_id) : null;
    if (installation_type_id !== undefined) updateData.installationTypeId = installation_type_id ? parseInt(installation_type_id) : null;

    // If a new file is provided, upload it as a new version
    if (req.file) {
      const versionLabel = version || `v${parseFloat(existing.currentVersion.replace('v', '')) + 0.1}`;
      const isPdf = req.file.mimetype === 'application/pdf';
      const s3Key = `drawings/${uuidv4()}-${req.file.originalname}`;
      const contentType = isPdf ? 'application/pdf' : 'application/octet-stream';

      let fileBuffer = req.file.buffer;
      if (isPdf) {
        const watermarkText = `SAIL MIOM - INTERNAL USE ONLY - ${existing.drawingNumber}`;
        fileBuffer = await addWatermark(fileBuffer, watermarkText);
      }

      await uploadBuffer(s3Key, fileBuffer, contentType);

      updateData.s3Key = s3Key;
      updateData.fileSize = req.file.size;
      updateData.currentVersion = versionLabel;

      await prisma.drawingVersion.create({
        data: {
          drawingId,
          version: versionLabel,
          s3Key,
          fileSize: req.file.size,
          notes: notes || `Updated to ${versionLabel}`,
          uploadedBy: req.user.userId
        }
      });
    }

    const drawing = await prisma.drawing.update({
      where: { id: drawingId },
      data: updateData,
      include: { location: true, installationType: true }
    });

    res.json({ success: true, data: drawing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getCategories = async (req, res) => {
  try {
    const categories = await prisma.drawing.groupBy({
      by: ['type'],
      where: { isDeleted: false },
      _count: { type: true }
    });

    const formatted = categories.map(c => ({
      type: c.type,
      count: c._count.type
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteDrawing = async (req, res) => {
  try {
    await prisma.drawing.update({
      where: { id: parseInt(req.params.id) },
      data: { isDeleted: true }
    });
    res.json({ success: true, message: 'Drawing deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDrawingVersions = async (req, res) => {
  try {
    const versions = await prisma.drawingVersion.findMany({
      where: { drawingId: parseInt(req.params.id) },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: versions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Bulk upload: one drawing per file. Drawing number + title derived from the
// filename; type from the extension. Requires a location (and optional type).
const bulkUploadDrawings = async (req, res) => {
  try {
    const b = req.body;
    const location_id = b.location_id ?? b.locationId;
    const installation_type_id = b.installation_type_id ?? b.installationTypeId;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    if (!location_id) {
      return res.status(400).json({ success: false, message: 'location is required' });
    }

    const created = [];
    const failed = [];
    for (const file of req.files) {
      try {
        const base = file.originalname.replace(/\.[^.]+$/, '');
        const lower = file.originalname.toLowerCase();
        const ext = lower.endsWith('.dwg') ? 'dwg' : lower.endsWith('.dxf') ? 'dxf' : 'pdf';
        const isPdf = file.mimetype === 'application/pdf';

        let drawingNumber = base;
        const exists = await prisma.drawing.findUnique({ where: { drawingNumber } });
        if (exists) drawingNumber = `${base}-${Date.now().toString(36).slice(-4)}`;

        const s3Key = `drawings/${uuidv4()}-${file.originalname}`;
        let buffer = file.buffer;
        if (isPdf) {
          buffer = await addWatermark(buffer, `SAIL MIOM - INTERNAL USE ONLY - ${drawingNumber}`);
        }
        await uploadBuffer(s3Key, buffer, isPdf ? 'application/pdf' : 'application/octet-stream');

        const drawing = await prisma.drawing.create({
          data: {
            title: base,
            drawingNumber,
            type: ext,
            locationId: parseInt(location_id),
            installationTypeId: installation_type_id ? parseInt(installation_type_id) : null,
            s3Key,
            fileSize: file.size,
            currentVersion: 'v1.0',
            isEncrypted: isPdf,
            uploadedById: req.user.userId
          }
        });
        await prisma.drawingVersion.create({
          data: {
            drawingId: drawing.id,
            version: 'v1.0',
            s3Key,
            fileSize: file.size,
            notes: 'Bulk upload',
            uploadedBy: req.user.userId
          }
        });
        created.push(drawingNumber);
      } catch (e) {
        failed.push({ file: file.originalname, error: e.message });
      }
    }

    // One consolidated notification to engineers for the whole batch.
    if (created.length > 0) {
      await sendRoleNotification(
        ['ENGINEER'],
        '📐 New Drawing Available',
        `${created.length} new drawings have been uploaded`,
        { type: 'NEW_DRAWING' }
      );
    }

    res.status(201).json({
      success: true,
      data: { created: created.length, failed },
      message: `${created.length} drawing(s) uploaded${failed.length ? `, ${failed.length} failed` : ''}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── On-PDF annotations (markup) ──────────────────────────────────
// Markups are stored server-side so they are shared across users/devices.
// `data` is a freehand stroke { color, width, points:[[x,y],…] } with
// normalised 0..1 coordinates relative to the rendered page box.

const getAnnotations = async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id);
    const annotations = await prisma.drawingAnnotation.findMany({
      where: { drawingId },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' }
    });
    res.json({
      success: true,
      data: annotations.map(a => ({
        id: a.id,
        drawingId: a.drawingId,
        page: a.page,
        type: a.type,
        data: a.data,
        createdById: a.createdById,
        createdByName: a.createdBy?.name || null,
        createdAt: a.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createAnnotation = async (req, res) => {
  try {
    const drawingId = parseInt(req.params.id);
    const { page = 0, type = 'stroke', data } = req.body;
    if (!data) {
      return res.status(400).json({ success: false, message: 'annotation data is required' });
    }

    const drawing = await prisma.drawing.findUnique({ where: { id: drawingId } });
    if (!drawing || drawing.isDeleted) {
      return res.status(404).json({ success: false, message: 'Drawing not found' });
    }

    const annotation = await prisma.drawingAnnotation.create({
      data: {
        drawingId,
        page: parseInt(page) || 0,
        type,
        data,
        createdById: req.user.userId
      },
      include: { createdBy: { select: { id: true, name: true } } }
    });

    res.status(201).json({
      success: true,
      data: {
        id: annotation.id,
        drawingId: annotation.drawingId,
        page: annotation.page,
        type: annotation.type,
        data: annotation.data,
        createdById: annotation.createdById,
        createdByName: annotation.createdBy?.name || null,
        createdAt: annotation.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteAnnotation = async (req, res) => {
  try {
    const annotationId = parseInt(req.params.annotationId);
    const annotation = await prisma.drawingAnnotation.findUnique({ where: { id: annotationId } });
    if (!annotation) {
      return res.status(404).json({ success: false, message: 'Annotation not found' });
    }

    // Only the author or an admin may remove a markup.
    const isOwner = annotation.createdById === req.user.userId;
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed to delete this annotation' });
    }

    await prisma.drawingAnnotation.delete({ where: { id: annotationId } });
    res.json({ success: true, message: 'Annotation deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDrawings, getDrawingById, getDownloadUrl,
  uploadDrawing, updateDrawing, getCategories,
  deleteDrawing, getDrawingVersions, bulkUploadDrawings,
  getAnnotations, createAnnotation, deleteAnnotation
};
