const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// Le colonne DATE (OID 1082) vanno restituite come stringa 'AAAA-MM-GG', non come
// oggetto Date (che verrebbe formattato male, es. "Thu Jul 02").
types.setTypeParser(1082, v => v);

// SSL: la rete privata di Railway (*.railway.internal) non usa SSL; le connessioni
// pubbliche/proxy sì. Rileviamo dall'URL così funziona in entrambi i casi.
function sslConfig() {
  const url = process.env.DATABASE_URL || '';
  if (url.includes('.railway.internal') || url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
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

  // `sessions` appartiene alla piattaforma strumenti; l'Hub la legge in sola
  // lettura (conteggio strumenti compilati per cliente). Sul DB reale esiste già.
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tool       TEXT NOT NULL,
      data       TEXT DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Versioni multiple per strumento (gestite dalla piattaforma): ogni riga è una
  // versione datata. Idempotente qui così l'ordine di deploy non conta.
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);

  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS telefono TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo_percorso TEXT DEFAULT 'Individuale'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS note_preliminari TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stato_percorso TEXT DEFAULT 'attivo'`);

  // Espansione anagrafica cliente (A2.4)
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS data_nascita DATE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS citta TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS indirizzo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS via TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS cap TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS provincia TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS social_tipo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS professione TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS altro_recapito TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS area TEXT DEFAULT 'Personal'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT 'altro'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS obiettivo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stato_cliente TEXT DEFAULT 'attivo'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prossima_azione TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prossima_azione_data DATE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS drive_url TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS consenso_privacy BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS consenso_data DATE`);

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

  // Espansione percorsi (2026-07-02): modalità di pagamento (Scambio servizi conta
  // come pagato per ICF), ore svolte (requisito certificazione ICF), data fine.
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS modalita TEXT DEFAULT 'Standard'`);
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS ore_fatte NUMERIC(6,1) DEFAULT 0`);
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS data_fine DATE`);

  // Diario sessioni di coaching (A8): una riga per seduta (Intake/Ongoing/Final),
  // con ore e "scheda" (riepilogo dei punti salienti, testo unico Markdown).
  // Distinta da `sessions` (che sono gli strumenti compilati dal cliente).
  // Quando un percorso ha sedute, ore_fatte/n_sessioni_fatte si ricalcolano da qui.
  await query(`
    CREATE TABLE IF NOT EXISTS sedute (
      id          TEXT PRIMARY KEY,
      percorso_id TEXT NOT NULL REFERENCES percorsi(id) ON DELETE CASCADE,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL DEFAULT 'Ongoing',
      data        DATE,
      ore         NUMERIC(4,1) DEFAULT 0,
      scheda      TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Automazione report→scheda (Fase 3): una seduta creata dall'automazione nasce
  // come BOZZA e non conta le ore ICF finché il coach non la approva (stato→confermata).
  // source_file_id = impronta del file Drive di origine (idempotenza: no doppioni +
  // tracciabilità). Le sedute preesistenti diventano 'confermata' (DEFAULT sotto).
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS stato          TEXT DEFAULT 'confermata'`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS origine        TEXT DEFAULT 'manuale'`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS source_file_id TEXT`);

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
