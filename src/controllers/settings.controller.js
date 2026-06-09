const prisma = require('../lib/prisma');
const getLocations = async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { installations: true } } }
    });
    const result = locations.map(({ _count, ...l }) => ({
      ...l, installationsCount: _count.installations
    }));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createLocation = async (req, res) => {
  try {
    const name = req.body.name && String(req.body.name).trim();
    const code = req.body.code && String(req.body.code).trim();
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'name and code are required' });
    }
    const location = await prisma.location.create({ data: { name, code } });
    res.status(201).json({ success: true, data: location });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'A location with that code already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateLocation = async (req, res) => {
  try {
    // Only touch known columns (don't forward arbitrary req.body to Prisma).
    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.code !== undefined) data.code = String(req.body.code).trim();
    const location = await prisma.location.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json({ success: true, data: location });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'A location with that code already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteLocation = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const loc = await prisma.location.findUnique({
      where: { id },
      include: { _count: { select: { users: true, complaints: true, installations: true, drawings: true } } }
    });
    if (!loc) return res.status(404).json({ success: false, message: 'Location not found' });
    const linked = loc._count.users + loc._count.complaints + loc._count.installations + loc._count.drawings;
    if (linked > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: location has ${linked} linked record(s). Reassign or remove them first.`
      });
    }
    await prisma.location.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createInstallationType = async (req, res) => {
  try {
    const name = req.body.name && String(req.body.name).trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const type = await prisma.installationType.create({ data: { name } });
    res.status(201).json({ success: true, data: type });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'An installation type with that name already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInstallationTypes = async (req, res) => {
  try {
    const types = await prisma.installationType.findMany({
      include: { _count: { select: { installations: true } } }
    });
    const result = types.map(({ _count, ...t }) => ({
      ...t, installationsCount: _count.installations
    }));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateInstallationType = async (req, res) => {
  try {
    const name = req.body.name && String(req.body.name).trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const type = await prisma.installationType.update({
      where: { id: parseInt(req.params.id) },
      data: { name }
    });
    res.json({ success: true, data: type });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'An installation type with that name already exists.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteInstallationType = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const type = await prisma.installationType.findUnique({
      where: { id },
      include: { _count: { select: { installations: true } } }
    });
    if (!type) return res.status(404).json({ success: false, message: 'Type not found' });
    if (type._count.installations > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: type has ${type._count.installations} installation(s).`
      });
    }
    await prisma.installationType.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getInstallations = async (req, res) => {
  try {
    const { location_id, type_id } = req.query;
    const where = { isActive: true };
    if (location_id) where.locationId = parseInt(location_id);
    if (type_id) where.installationTypeId = parseInt(type_id);

    const installations = await prisma.installation.findMany({
      where,
      include: { location: true, installationType: true },
      orderBy: { name: 'asc' }
    });
    res.json({ success: true, data: installations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createInstallation = async (req, res) => {
  try {
    const b = req.body;
    const name = b.name;
    const assetId = b.asset_id ?? b.assetId ?? null;
    const locationId = b.location_id ?? b.locationId;
    const installationTypeId = b.installation_type_id ?? b.installationTypeId;

    if (!name || !locationId || !installationTypeId) {
      return res.status(400).json({
        success: false,
        message: 'name, location and installation type are required'
      });
    }

    const installation = await prisma.installation.create({
      data: {
        name,
        assetId,
        locationId: parseInt(locationId),
        installationTypeId: parseInt(installationTypeId)
      },
      include: { location: true, installationType: true }
    });
    res.status(201).json({ success: true, data: installation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateInstallation = async (req, res) => {
  try {
    const b = req.body;
    const updateData = {};
    if (b.name !== undefined) updateData.name = b.name;
    if ((b.asset_id ?? b.assetId) !== undefined) updateData.assetId = b.asset_id ?? b.assetId;
    const locationId = b.location_id ?? b.locationId;
    const installationTypeId = b.installation_type_id ?? b.installationTypeId;
    if (locationId !== undefined) updateData.locationId = parseInt(locationId);
    if (installationTypeId !== undefined) updateData.installationTypeId = parseInt(installationTypeId);
    if (b.isActive !== undefined) updateData.isActive = b.isActive;

    const installation = await prisma.installation.update({
      where: { id: parseInt(req.params.id) },
      data: updateData,
      include: { location: true, installationType: true }
    });
    res.json({ success: true, data: installation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const deleteInstallation = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const inst = await prisma.installation.findUnique({
      where: { id },
      include: { _count: { select: { complaints: true, drawings: true, maintenance: true } } }
    });
    if (!inst) return res.status(404).json({ success: false, message: 'Installation not found' });
    const linked = inst._count.complaints + inst._count.drawings + inst._count.maintenance;
    if (linked > 0) {
      // Soft-disable instead of hard delete when records reference it.
      await prisma.installation.update({ where: { id }, data: { isActive: false } });
      return res.json({ success: true, message: 'Installation deactivated (it has linked records).' });
    }
    await prisma.installation.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSlaConfig = async (req, res) => {
  try {
    const config = await prisma.slaConfig.findFirst();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateSlaConfig = async (req, res) => {
  try {
    // Accept both camelCase (criticalHours) and snake_case (critical_hours)
    const b = req.body;
    const criticalHours = parseInt(b.criticalHours ?? b.critical_hours);
    const highHours = parseInt(b.highHours ?? b.high_hours);
    const mediumHours = parseInt(b.mediumHours ?? b.medium_hours);
    const lowHours = parseInt(b.lowHours ?? b.low_hours);

    const config = await prisma.slaConfig.upsert({
      where: { id: 1 },
      update: { criticalHours, highHours, mediumHours, lowHours },
      create: { criticalHours, highHours, mediumHours, lowHours }
    });
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getLocations, createLocation, updateLocation, deleteLocation,
  getInstallationTypes, createInstallationType, updateInstallationType, deleteInstallationType,
  getInstallations, createInstallation, updateInstallation, deleteInstallation,
  getSlaConfig, updateSlaConfig
};
