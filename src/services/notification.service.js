const OneSignal = require('@onesignal/node-onesignal');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

const configuration = OneSignal.createConfiguration({
  restApiKey: ONESIGNAL_API_KEY,
});

const client = new OneSignal.DefaultApi(configuration);

/**
 * Send push notification to a specific user
 */
const sendPushToUser = async (userId, title, body, data = {}) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { pushTokens: true }
    });

    if (!user || !user.pushTokens.length) return;

    const playerIds = user.pushTokens.map(t => t.token);

    const notification = new OneSignal.Notification();
    notification.app_id = ONESIGNAL_APP_ID;
    notification.include_player_ids = playerIds;
    notification.headings = { en: title };
    notification.contents = { en: body };
    notification.data = data;

    const response = await client.createNotification(notification);
    return response;
  } catch (error) {
    console.error('OneSignal Push Error:', error);
  }
};

/**
 * Send push notification to multiple users
 */
const sendBulkNotification = async (userIds, title, body, data = {}) => {
  try {
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: userIds } }
    });

    if (!tokens.length) return;

    const playerIds = tokens.map(t => t.token);

    const notification = new OneSignal.Notification();
    notification.app_id = ONESIGNAL_APP_ID;
    notification.include_player_ids = playerIds;
    notification.headings = { en: title };
    notification.contents = { en: body };
    notification.data = data;

    const response = await client.createNotification(notification);
    return response;
  } catch (error) {
    console.error('OneSignal Bulk Push Error:', error);
  }
};

/**
 * Send push notification to one or more roles.
 * Accepts a single role string or an array of role strings.
 */
const sendRoleNotification = async (roleOrRoles, title, body, data = {}) => {
  try {
    const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
    const users = await prisma.user.findMany({
      where: { role: { in: roles }, isActive: true },
      include: { pushTokens: true }
    });

    const playerIds = users.flatMap(u => u.pushTokens.map(t => t.token));

    if (!playerIds.length) return;

    const notification = new OneSignal.Notification();
    notification.app_id = ONESIGNAL_APP_ID;
    notification.include_player_ids = playerIds;
    notification.headings = { en: title };
    notification.contents = { en: body };
    notification.data = data;

    const response = await client.createNotification(notification);
    return response;
  } catch (error) {
    console.error('OneSignal Role Push Error:', error);
  }
};

module.exports = {
  sendPushToUser,
  sendBulkNotification,
  sendRoleNotification
};
