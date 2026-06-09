const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

// Backend-enforced privilege boundary (the admin UI is NOT a security control).
// Returns a denial message if `actorRole` may not administer a target that
// currently has `targetRole`, or assign `newRole`. Null = allowed.
//   - SUPERADMIN: unrestricted.
//   - ADMIN: may manage ENGINEER/CONTRACTOR/STAFF/PENDING/ADMIN, but may NOT
//     grant the SUPERADMIN role nor act on an existing SUPERADMIN account.
function privilegeDenial(actorRole, targetRole, newRole) {
  if (actorRole === 'SUPERADMIN') return null;
  if (newRole && String(newRole).toUpperCase() === 'SUPERADMIN') {
    return 'Only a superadmin can assign the superadmin role.';
  }
  if (targetRole === 'SUPERADMIN') {
    return 'You cannot modify a superadmin account.';
  }
  return null;
}
const getUsers = async (req, res) => {
  try {
    const { role, location_id, search, page = 1, limit = 20 } = req.query;
    const where = {};

    if (role) where.role = role.toUpperCase();
    if (location_id) where.locationId = parseInt(location_id);
    if (req.query.status === 'inactive') where.isActive = false;
    else if (req.query.status === 'active') where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeId: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, employeeId: true,
          role: true, department: true, phone: true, isActive: true,
          locationId: true, location: true, createdAt: true
        },
        orderBy: { name: 'asc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.user.count({ where })
    ]);

    res.json({ success: true, data, total });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    const b = req.body;
    const { name, email, employeeId, password, role, department, phone } = b;
    const locationId = b.location_id ?? b.locationId;

    if (!name || !email || !employeeId || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'name, email, employee ID, password and role are required'
      });
    }
    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Privilege ceiling: only a SUPERADMIN may create a SUPERADMIN account.
    const denial = privilegeDenial(req.user.role, null, role);
    if (denial) {
      return res.status(403).json({ success: false, message: denial });
    }

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { employeeId }] }
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Email or Employee ID already exists'
      });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name, email, employeeId,
        password: hashed,
        role: role.toUpperCase(),
        locationId: locationId ? parseInt(locationId) : null,
        department: department || 'Electrical',
        phone
      },
      select: {
        id: true, name: true, email: true,
        employeeId: true, role: true, isActive: true
      }
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true, name: true, email: true, employeeId: true,
        role: true, department: true, phone: true,
        profilePicUrl: true, isActive: true, locationId: true,
        location: { select: { id: true, name: true, code: true } },
        createdAt: true
      }
    });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update own profile (name / phone / department)
const updateMe = async (req, res) => {
  try {
    const { name, phone, department } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (department !== undefined) updateData.department = department;

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
      select: {
        id: true, name: true, email: true, employeeId: true,
        role: true, department: true, phone: true,
        profilePicUrl: true, isActive: true, locationId: true,
        location: { select: { id: true, name: true, code: true } },
        createdAt: true
      }
    });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMeStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    // Count only non-deleted complaints across EVERY metric, otherwise the SLA
    // rate is skewed (a breached-then-deleted complaint would count against a
    // denominator that excludes it) and "raised" wouldn't match the dashboard.
    const [complaintsRaised, resolved, breached] = await Promise.all([
      prisma.complaint.count({ where: { raisedById: userId, isDeleted: false } }),
      prisma.complaint.count({ where: { raisedById: userId, status: 'RESOLVED', isDeleted: false } }),
      prisma.complaint.count({ where: { raisedById: userId, isSlaBreached: true, isDeleted: false } })
    ]);

    const slaRate = complaintsRaised > 0
      ? parseFloat((((complaintsRaised - breached) / complaintsRaised) * 100).toFixed(1))
      : 100;

    res.json({
      success: true,
      data: { complaintsRaised, resolved, slaRate }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: update any user (name, phone, role, location, department)
const updateUser = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true }
    });
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { name, phone, department, role, isActive } = req.body;

    // Enforce the privilege boundary before touching anything.
    const denial = privilegeDenial(req.user.role, target.role, role);
    if (denial) {
      return res.status(403).json({ success: false, message: denial });
    }

    const locationId = req.body.location_id ?? req.body.locationId;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (department !== undefined) updateData.department = department;
    if (role !== undefined) updateData.role = role.toUpperCase();
    // Lets an admin approve a pending Google signup in one call (assign role +
    // activate). Only a real boolean toggles it.
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (locationId !== undefined) {
      updateData.locationId = locationId ? parseInt(locationId) : null;
    }

    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: updateData,
      select: {
        id: true, name: true, email: true, employeeId: true,
        role: true, department: true, phone: true,
        isActive: true, locationId: true,
        location: { select: { id: true, name: true, code: true } }
      }
    });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Loads the target's role and enforces the privilege boundary. Returns the
// target id if allowed, or sends the response and returns null if denied.
async function guardTarget(req, res) {
  const targetId = parseInt(req.params.id);
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true }
  });
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }
  const denial = privilegeDenial(req.user.role, target.role, undefined);
  if (denial) {
    res.status(403).json({ success: false, message: denial });
    return null;
  }
  return targetId;
}

const deactivateUser = async (req, res) => {
  try {
    const id = await guardTarget(req, res);
    if (id === null) return;
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const activateUser = async (req, res) => {
  try {
    const id = await guardTarget(req, res);
    if (id === null) return;
    await prisma.user.update({ where: { id }, data: { isActive: true } });
    res.json({ success: true, message: 'User activated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const id = await guardTarget(req, res);
    if (id === null) return;
    const hashed = await bcrypt.hash(req.body.newPassword, 12);
    await prisma.user.update({ where: { id }, data: { password: hashed } });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUsers, createUser, getMe, updateMe, getMeStats,
  updateUser, deactivateUser, activateUser, resetPassword
};
