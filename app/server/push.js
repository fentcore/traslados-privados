const webpush = require('web-push');
const { pool } = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@example.com';

const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no configuradas: las notificaciones push estan desactivadas.');
}

// Sends a push notification to every user in the workspace except `excludeUserId`.
async function notifyWorkspace(workspaceId, excludeUserId, payload) {
  if (!pushEnabled) return;
  const { rows } = await pool.query(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE u.workspace_id = $1 AND u.id != $2`,
    [workspaceId, excludeUserId]
  );

  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('[push] error enviando notificacion:', err.message);
      }
    }
  }));
}

module.exports = { pushEnabled, VAPID_PUBLIC_KEY, notifyWorkspace };
