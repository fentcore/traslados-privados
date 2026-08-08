const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { pushEnabled, VAPID_PUBLIC_KEY } = require('../push');

const router = express.Router();

router.get('/public-key', (req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Suscripcion invalida.' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar la suscripcion.' });
  }
});

router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Falta el endpoint.' });
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar la suscripcion.' });
  }
});

module.exports = router;
