// ═══════════════════════════════════════════════════════════════════════════
// GUARDARE I DATI VERI — SENZA POTERLI TOCCARE.
//
// Nasce il 15/08/2026. Serve a rispondere a domande sui dati di PRODUZIONE
// («questa cosa succede davvero o l'ho solo letta nel codice?») senza dover
// dare a Claude il permesso di eseguire codice qualsiasi sul database vero.
//
// ⭐ LA GARANZIA NON È LA BUONA VOLONTÀ DI CHI SCRIVE LA QUERY: è nel codice,
// ed è DOPPIA.
//   1. la connessione si apre con `default_transaction_read_only = on`, quindi
//      è **PostgreSQL stesso** a rifiutare qualunque scrittura, anche se la
//      query passasse il controllo qui sotto;
//   2. il testo della query viene comunque controllato: una sola istruzione,
//      che deve cominciare per SELECT o WITH.
// La prima da sola basterebbe. La seconda c'è perché un messaggio d'errore
// chiaro («qui si legge e basta») vale più di un errore del database.
//
// USO:
//   node --env-file=.env.reale scripts/guarda-produzione.js "SELECT ..."
//
// ⚠️ La variabile del database vero si chiama DATABASE_URL_REALE (non
// DATABASE_URL, che è lo sviluppo). Lo script stampa SEMPRE su quale
// database sta leggendo: dirlo è una regola del cantiere, non una gentilezza.
// ═══════════════════════════════════════════════════════════════════════════

const { Pool } = require('pg');

const sql = (process.argv[2] || '').trim();

const PAROLE_VIETATE = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'vacuum', 'reindex', 'refresh', 'call', 'do',
];

function controlla(q) {
  if (!q) return 'Manca la query. Uso: node --env-file=.env.reale scripts/guarda-produzione.js "SELECT ..."';
  // Una sola istruzione: il punto e virgola si tollera solo in fondo.
  const senzaFinale = q.replace(/;\s*$/, '');
  if (senzaFinale.includes(';')) return 'Una query per volta: qui non si incollano più istruzioni.';
  const primo = senzaFinale.trimStart().slice(0, 10).toLowerCase();
  if (!primo.startsWith('select') && !primo.startsWith('with')) {
    return 'Qui si legge e basta: la query deve cominciare per SELECT (o WITH).';
  }
  // Rete in più: una parola di scrittura anche in mezzo (es. dentro una CTE).
  const parole = senzaFinale.toLowerCase().match(/[a-z_]+/g) || [];
  const trovata = parole.find(p => PAROLE_VIETATE.includes(p));
  if (trovata) return `Qui si legge e basta: trovata la parola «${trovata}».`;
  return null;
}

(async () => {
  const guaio = controlla(sql);
  if (guaio) { console.error('⛔ ' + guaio); process.exit(1); }

  const url = process.env.DATABASE_URL_REALE;
  if (!url) {
    console.error('⛔ Manca DATABASE_URL_REALE. Serve: node --env-file=.env.reale …');
    process.exit(1);
  }
  // Su quale database stiamo leggendo: si dice sempre, senza mai stampare la
  // password (di qui passa solo l'indirizzo).
  const host = (url.match(/@([^:/?]+)/) || [])[1] || 'sconosciuto';
  console.log(`Database: ${host}  —  SOLA LETTURA\n`);

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    // ⭐ È questa riga la vera serratura: da qui in poi è il database a dire di
    // no a qualunque scrittura, qualunque cosa arrivi.
    options: '-c default_transaction_read_only=on',
  });

  try {
    const r = await pool.query(sql);
    console.log(`${r.rowCount} righe\n`);
    if (r.rows.length) console.table(r.rows);
  } catch (e) {
    console.error('Errore: ' + e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
