const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function serialize(row) {
  return {
    horarioKey: row.horario_key,
    horarioLabel: row.horario_label,
    sortOrder: row.sort_order,
    seats: Array.isArray(row.seats) ? row.seats : [],
    updatedAt: row.updated_at
  };
}

// GET /api/seats/public - no auth. Read-only feed for the landing page's
// reservation widget, so any visitor can see live seat availability.
router.get('/public', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM seat_maps ORDER BY sort_order ASC');
    res.json({ seatMaps: rows.map(serialize) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron cargar los asientos.' });
  }
});

router.use(requireAuth);

// GET /api/seats - same data, for the admin panel (kept separate from
// /public so the panel doesn't depend on an unauthenticated route).
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM seat_maps ORDER BY sort_order ASC');
    res.json({ seatMaps: rows.map(serialize) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron cargar los asientos.' });
  }
});

// PATCH /api/seats/:horarioKey/seat/:seatId { occupied: boolean } - toggles a
// single seat for one departure. Used by the admin panel's "Asientos" tab.
router.patch('/:horarioKey/seat/:seatId', async (req, res) => {
  const occupied = !!(req.body && req.body.occupied);
  try {
    const { rows } = await pool.query('SELECT * FROM seat_maps WHERE horario_key = $1', [req.params.horarioKey]);
    if (!rows.length) return res.status(404).json({ error: 'Horario no encontrado.' });
    const seats = (Array.isArray(rows[0].seats) ? rows[0].seats : []).map((s) =>
      s.id === req.params.seatId ? Object.assign({}, s, { occupied }) : s
    );
    const { rows: updated } = await pool.query(
      'UPDATE seat_maps SET seats = $1, updated_at = now() WHERE horario_key = $2 RETURNING *',
      [JSON.stringify(seats), req.params.horarioKey]
    );
    res.json({ seatMap: serialize(updated[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el asiento.' });
  }
});

module.exports = router;
