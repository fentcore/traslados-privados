const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

function generateInviteCode() {
  return 'TRASLADOS-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Creates a brand-new workspace and its first user (the account owner).
router.post('/register', async (req, res) => {
  const { email, password, displayName, workspaceName } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalido.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Falta el nombre.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }
    let inviteCode = generateInviteCode();
    const wsResult = await client.query(
      'INSERT INTO workspaces (name, invite_code) VALUES ($1, $2) RETURNING id, invite_code',
      [(workspaceName || 'Mi espacio de trabajo').trim(), inviteCode]
    );
    const workspace = wsResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (workspace_id, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING id, workspace_id, email, display_name',
      [workspace.id, email.toLowerCase(), passwordHash, displayName.trim()]
    );
    await client.query('COMMIT');
    const user = userResult.rows[0];
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name }, workspace: { inviteCode: workspace.invite_code } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la cuenta.' });
  } finally {
    client.release();
  }
});

// Joins an existing workspace using the invite code shared by the owner.
router.post('/join', async (req, res) => {
  const { email, password, displayName, inviteCode } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalido.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Falta el nombre.' });
  if (!inviteCode || !inviteCode.trim()) return res.status(400).json({ error: 'Falta el codigo de invitacion.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }
    const wsResult = await client.query('SELECT id, invite_code FROM workspaces WHERE invite_code = $1', [inviteCode.trim().toUpperCase()]);
    if (!wsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Codigo de invitacion invalido.' });
    }
    const workspace = wsResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (workspace_id, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING id, workspace_id, email, display_name',
      [workspace.id, email.toLowerCase(), passwordHash, displayName.trim()]
    );
    await client.query('COMMIT');
    const user = userResult.rows[0];
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name }, workspace: { inviteCode: workspace.invite_code } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'No se pudo unir al espacio de trabajo.' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || !password) return res.status(400).json({ error: 'Email o contraseña invalidos.' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.workspace_id, u.email, u.password_hash, u.display_name, w.invite_code
       FROM users u JOIN workspaces w ON w.id = u.workspace_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name }, workspace: { inviteCode: user.invite_code } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo iniciar sesion.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, w.invite_code, w.name AS workspace_name
       FROM users u JOIN workspaces w ON w.id = u.workspace_id
       WHERE u.id = $1`,
      [req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const u = rows[0];
    res.json({ user: { id: u.id, email: u.email, displayName: u.display_name }, workspace: { inviteCode: u.invite_code, name: u.workspace_name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor.' });
  }
});

module.exports = router;
