const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  barrio TEXT DEFAULT '',
  tramos INTEGER DEFAULT 0,
  mail TEXT DEFAULT '',
  telefono TEXT DEFAULT '',
  monto NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'pendiente',
  fecha DATE,
  tipo_viaje TEXT DEFAULT 'ambos',
  dias JSONB DEFAULT '[]'::jsonb,
  horario_ida TEXT DEFAULT '',
  horario_vuelta TEXT DEFAULT '',
  horarios JSONB DEFAULT '{}'::jsonb,
  asientos JSONB DEFAULT '{}'::jsonb,
  dias_tipo JSONB DEFAULT '{}'::jsonb,
  activo_tramos BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS horario_ida TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS horario_vuelta TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS horarios JSONB DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS asientos JSONB DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dias_tipo JSONB DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS activo_tramos BOOLEAN NOT NULL DEFAULT true;

-- Per-day trip type (ida/vuelta/ambos) used to live only as one tipo_viaje
-- value shared by the whole contact. Backfill dias_tipo from it so every day
-- already in `dias` keeps exactly the ida/vuelta/ambos meaning it already had.
-- Self-limiting: only rows with an empty dias_tipo are touched, and this
-- query fills it in, so a row is never rewritten on a later boot.
UPDATE contacts
SET dias_tipo = (
  SELECT COALESCE(jsonb_object_agg(d, tipo_viaje), '{}'::jsonb)
  FROM jsonb_array_elements_text(dias) AS d
)
WHERE dias_tipo = '{}'::jsonb AND jsonb_array_length(dias) > 0;

-- One-time migration from the columns' previous names (en_tramos / horarios_dias)
-- and previous "renovar" estado value. Self-disabling: once the old columns are
-- dropped below, the IF EXISTS guard is false on every later boot, so this never
-- re-runs and can't clobber values the app sets afterward.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'en_tramos') THEN
    UPDATE contacts SET activo_tramos = en_tramos, horarios = horarios_dias;
    ALTER TABLE contacts DROP COLUMN en_tramos;
    ALTER TABLE contacts DROP COLUMN horarios_dias;
  END IF;
END $$;

UPDATE contacts SET estado = 'sin_tramos' WHERE estado = 'renovar';

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One shared seat map per departure (the site has a single van), editable from
-- the admin panel and read publicly by the landing page's booking widget.
CREATE TABLE IF NOT EXISTS seat_maps (
  id SERIAL PRIMARY KEY,
  horario_key TEXT UNIQUE NOT NULL,
  horario_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  seats JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
`;

// Real Renault Master layout: front row is the driver + 1 passenger seat
// (the driver isn't bookable, and the old front seat "1" was removed), then
// three rows of 3, then a 4-across back bench. 14 bookable seats total.
const SEAT_ROWS = [1, 3, 3, 3, 4];

function defaultSeats() {
  const seats = [];
  let n = 1;
  SEAT_ROWS.forEach((count, i) => {
    for (let col = 1; col <= count; col++) {
      seats.push({ id: String(n), row: i + 1, col, occupied: false });
      n++;
    }
  });
  return seats;
}

const SEAT_MAP_DEFAULTS = [
  { key: 'ingreso_730', label: 'Ingreso 7:30', order: 1 },
  { key: 'ingreso_820', label: 'Ingreso 8:20', order: 2 },
  { key: 'salida_mediodia', label: 'Salida mediodía (13:00)', order: 3 },
  { key: 'salida_tarde', label: 'Salida tarde (17:10)', order: 4 }
];

async function initSchema() {
  await pool.query(SCHEMA);
  for (const sm of SEAT_MAP_DEFAULTS) {
    await pool.query(
      `INSERT INTO seat_maps (horario_key, horario_label, sort_order, seats) VALUES ($1,$2,$3,$4)
       ON CONFLICT (horario_key) DO NOTHING`,
      [sm.key, sm.label, sm.order, JSON.stringify(defaultSeats())]
    );
  }

  // One-time layout fix: the van is 1+3+3+3+4 = 14 seats (front seat "1" next
  // to the driver was removed). Self-disabling: once a horario already has
  // exactly 14 seats it's on the current layout, so this leaves it alone.
  const expectedCount = defaultSeats().length;
  const { rows } = await pool.query('SELECT horario_key, seats FROM seat_maps');
  for (const row of rows) {
    const hasNewLayout = Array.isArray(row.seats) && row.seats.length === expectedCount;
    if (!hasNewLayout) {
      await pool.query(
        'UPDATE seat_maps SET seats = $1, updated_at = now() WHERE horario_key = $2',
        [JSON.stringify(defaultSeats()), row.horario_key]
      );
    }
  }
}

module.exports = { pool, initSchema };
