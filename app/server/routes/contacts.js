const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { notifyWorkspace } = require('../push');

const router = express.Router();
router.use(requireAuth);

const DIAS_VALID = new Set(['lun', 'mar', 'mie', 'jue', 'vie']);
const TIPO_VALID = new Set(['ida', 'vuelta', 'ambos']);
const ESTADO_VALID = new Set(['pendiente', 'pagado']);

function serialize(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    barrio: row.barrio || '',
    tramos: row.tramos || 0,
    mail: row.mail || '',
    telefono: row.telefono || '',
    monto: row.monto === null ? 0 : Number(row.monto),
    estado: row.estado || 'pendiente',
    fecha: row.fecha ? new Date(row.fecha).toISOString().slice(0, 10) : '',
    tipoViaje: row.tipo_viaje || 'ambos',
    dias: Array.isArray(row.dias) ? row.dias : [],
    createdBy: row.created_by,
    updatedAt: row.updated_at
  };
}

function sanitizeInput(body) {
  const dias = Array.isArray(body.dias) ? body.dias.filter(d => DIAS_VALID.has(d)) : [];
  return {
    nombre: String(body.nombre || '').trim().slice(0, 200),
    barrio: String(body.barrio || '').trim().slice(0, 200),
    tramos: Math.max(0, Number(body.tramos) || 0),
    mail: String(body.mail || '').trim().slice(0, 200),
    telefono: String(body.telefono || '').trim().slice(0, 60),
    monto: Math.max(0, Number(body.monto) || 0),
    estado: ESTADO_VALID.has(body.estado) ? body.estado : 'pendiente',
    fecha: body.fecha ? String(body.fecha).slice(0, 10) : null,
    tipoViaje: TIPO_VALID.has(body.tipoViaje) ? body.tipoViaje : 'ambos',
    dias
  };
}

// GET /api/contacts?since=<ISO timestamp> - full list, or only rows changed after `since` for lightweight polling.
router.get('/', async (req, res) => {
  try {
    const { since } = req.query;
    let rows;
    if (since) {
      ({ rows } = await pool.query(
        'SELECT * FROM contacts WHERE workspace_id = $1 AND updated_at > $2 ORDER BY updated_at DESC',
        [req.workspaceId, since]
      ));
    } else {
      ({ rows } = await pool.query(
        'SELECT * FROM contacts WHERE workspace_id = $1 ORDER BY created_at DESC',
        [req.workspaceId]
      ));
    }
    res.json({ contacts: rows.map(serialize), serverTime: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron cargar los contactos.' });
  }
});

router.post('/', async (req, res) => {
  const data = sanitizeInput(req.body || {});
  if (!data.nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (workspace_id, nombre, barrio, tramos, mail, telefono, monto, estado, fecha, tipo_viaje, dias, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.workspaceId, data.nombre, data.barrio, data.tramos, data.mail, data.telefono, data.monto, data.estado, data.fecha, data.tipoViaje, JSON.stringify(data.dias), req.userId]
    );
    const contact = rows[0];
    res.status(201).json({ contact: serialize(contact) });

    notifyWorkspace(req.workspaceId, req.userId, {
      title: 'Nuevo cliente cargado',
      body: contact.nombre,
      tag: 'nuevo-cliente',
      url: '/?view=list'
    }).catch(err => console.error('[push] fallo al notificar:', err.message));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el contacto.' });
  }
});

router.put('/:id', async (req, res) => {
  const data = sanitizeInput(req.body || {});
  if (!data.nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET nombre=$1, barrio=$2, tramos=$3, mail=$4, telefono=$5, monto=$6, estado=$7, fecha=$8, tipo_viaje=$9, dias=$10, updated_at=now()
       WHERE id=$11 AND workspace_id=$12 RETURNING *`,
      [data.nombre, data.barrio, data.tramos, data.mail, data.telefono, data.monto, data.estado, data.fecha, data.tipoViaje, JSON.stringify(data.dias), req.params.id, req.workspaceId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado.' });
    res.json({ contact: serialize(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el contacto.' });
  }
});

// PATCH /:id/tramos { delta: 1 | -1 } - used by the "Tramos" tab +/- controls.
router.patch('/:id/tramos', async (req, res) => {
  const delta = Number(req.body && req.body.delta) || 0;
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET tramos = GREATEST(0, tramos + $1), updated_at = now()
       WHERE id = $2 AND workspace_id = $3 RETURNING *`,
      [delta, req.params.id, req.workspaceId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado.' });
    res.json({ contact: serialize(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo ajustar los tramos.' });
  }
});

router.patch('/:id/estado', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET estado = CASE WHEN estado = 'pagado' THEN 'pendiente' ELSE 'pagado' END, updated_at = now()
       WHERE id = $1 AND workspace_id = $2 RETURNING *`,
      [req.params.id, req.workspaceId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado.' });
    res.json({ contact: serialize(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cambiar el estado.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [req.params.id, req.workspaceId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contacto no encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el contacto.' });
  }
});

module.exports = router;
