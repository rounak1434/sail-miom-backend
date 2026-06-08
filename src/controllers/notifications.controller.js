const prisma = require('../lib/prisma');
const { sendPushToUser } = require('../services/notification.service');
const getNotifications = async (req, res) => {
  try {
    const { unread, page = 1, limit = 20 } = req.query;
    const where = { userId: req.user.userId };
    if (unread === 'true') where.isRead = false;

    const [data, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.notification.count({
        where: { userId: req.user.userId, isRead: false }
      })
    ]);

    res.json({ success: true, data, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markRead = async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: parseInt(req.params.id) },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const registerPushToken = async (req, res) => {
  try {
    const { token, device_id } = req.body;
    await prisma.pushToken.upsert({
      where: { token },
      update: { userId: req.user.userId, deviceId: device_id },
      create: { userId: req.user.userId, token, deviceId: device_id }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const testNotification = async (req, res) => {
  try {
    const { userId, title, body } = req.body;
    
    if (!userId || !title || !body) {
      return res.status(400).json({ success: false, message: 'Missing required fields: userId, title, body' });
    }

    const response = await sendPushToUser(parseInt(userId), title, body);
    
    res.json({ success: true, message: 'Test notification triggered', onesignalResponse: response });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getNotifications, markRead, markAllRead, registerPushToken, testNotification };
