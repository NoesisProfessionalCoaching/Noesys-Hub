const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// Schema condiviso con Coaching-Tools (stesso database Postgres).
// L'Hub non tocca `sessions` (dati degli strumenti): quella resta di competenza
// della piattaforma strumenti. Qui l'Hub possiede lead/percorsi/pagamenti.
async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS coach (
      id         SERIAL PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT,
      token      TEXT UNIQUE NOT NULL,
      active     BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen  TIMESTAMPTZ
    )
  `);

  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS telefono TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo_percorso TEXT DEFAULT 'Individuale'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS note_preliminari TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stato_percorso TEXT DEFAULT 'attivo'`);

  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id                     TEXT PRIMARY KEY,
      nome                   TEXT NOT NULL,
      cognome                TEXT,
      email                  TEXT,
      telefono               TEXT,
      fonte                  TEXT DEFAULT 'altro',
      stato                  TEXT DEFAULT 'nuovo',
      note                   TEXT,
      data_prossimo_contatto DATE,
      created_at             TIMESTAMPTZ DEFAULT NOW(),
      updated_at             TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS percorsi (
      id                  TEXT PRIMARY KEY,
      client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tipo                TEXT DEFAULT 'Individuale',
      n_sessioni_previste INTEGER DEFAULT 8,
      n_sessioni_fatte    INTEGER DEFAULT 0,
      prezzo              NUMERIC(10,2),
      promo               BOOLEAN DEFAULT FALSE,
      sconto_note         TEXT,
      stato               TEXT DEFAULT 'attivo',
      data_inizio         DATE,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id             TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      percorso_id    TEXT REFERENCES percorsi(id) ON DELETE SET NULL,
      importo        NUMERIC(10,2) NOT NULL,
      data_pagamento DATE,
      tipo           TEXT DEFAULT 'sessione',
      stato          TEXT DEFAULT 'atteso',
      note           TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Stesso account coach della piattaforma strumenti (solo per il DB di test:
  // sul DB reale condiviso la riga esiste già).
  const existing = await query('SELECT id FROM coach WHERE username = $1', ['Germano']);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync('ProfessionalCoaching', 10);
    await query('INSERT INTO coach (username, password) VALUES ($1, $2)', ['Germano', hash]);
    console.log('✅ Coach account creato: Germano');
  }
}

module.exports = { query, init };
