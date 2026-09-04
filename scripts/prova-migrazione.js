// PROVA DI MIGRAZIONE — da lanciare SEMPRE prima di pubblicare una modifica a db.js.
//
// L'8 agosto un errore nelle istruzioni di `init()` ha fatto cadere l'Hub: le
// migrazioni girano all'avvio, quindi un comando sbagliato non rompe una pagina,
// rompe il server intero e l'Hub non riparte più.
//
// Cosa fa: crea uno SCHEMA temporaneo dentro il database, ci fa girare `init()`
// come se fosse un database appena nato, controlla che le tabelle attese ci siano,
// poi lo rilancia una SECONDA volta per verificare che sia ripetibile, e infine
// butta via lo schema. Non tocca nessuna tabella esistente, nemmeno per sbaglio:
// lavora in una stanza separata e la demolisce alla fine.
//
//   node --env-file=.env scripts/prova-migrazione.js
//
// Esce con codice 0 se è tutto a posto, 1 se qualcosa non va.

const { Pool } = require('pg');

// Le tabelle che DEVONO esistere dopo una migrazione riuscita. Se ne aggiungi una
// nuova in db.js, aggiungila anche qui: è ciò che rende la prova una prova.
const TABELLE_ATTESE = [
  'coach', 'clients', 'sessions', 'percorsi', 'sedute', 'payments', 'leads',
  'committenti', 'progetti', 'partecipazioni', 'fasi_progetto',
  'permessi_strumenti', 'moduli_letti', 'emittente',
  'proforme', 'proforma_righe', 'appuntamenti', 'tranche_progetto', 'incassi',
  'documenti', 'contratti',
  'automazione_passate',   // fetta 2.2 (04/09/2026)
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ Manca DATABASE_URL. Lancia con: node --env-file=.env scripts/prova-migrazione.js');
  process.exit(1);
}

const schema = 'prova_migrazione_' + process.pid + '_' + Date.now().toString(36);
const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';

function ssl() {
  return (url.includes('.railway.internal') || url.includes('localhost') || url.includes('127.0.0.1'))
    ? false : { rejectUnauthorized: false };
}

(async () => {
  const admin = new Pool({ connectionString: url, ssl: ssl() });
  let uscita = 1;
  let creata = false;
  try {
    console.log(`Database: ${host}`);
    console.log(`Stanza di prova: ${schema}\n`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    creata = true;

    // db.js costruisce il suo pool leggendo DATABASE_URL al momento del require:
    // gli si fa puntare la stanza di prova PRIMA di caricarlo, così `init()` crea
    // tutto lì dentro senza sapere di essere in prova.
    const sep = url.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${url}${sep}options=${encodeURIComponent('-c search_path=' + schema)}`;
    const db = require('../server/db.js');

    console.log('1ª migrazione (database appena nato)…');
    await db.init();
    console.log('   ✓ nessun errore\n');

    const r = await admin.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1`, [schema]);
    const trovate = r.rows.map(x => x.table_name);
    const mancanti = TABELLE_ATTESE.filter(t => !trovate.includes(t));
    console.log(`Tabelle create: ${trovate.length}`);
    if (mancanti.length) {
      console.log(`   ✗ MANCANO: ${mancanti.join(', ')}`);
      throw new Error('tabelle attese non create');
    }
    console.log('   ✓ ci sono tutte quelle attese\n');

    // Il guasto più insidioso: una migrazione che funziona la prima volta e
    // esplode alla seconda. In produzione `init()` gira a OGNI avvio.
    console.log('2ª migrazione (deve essere ripetibile)…');
    await db.init();
    console.log('   ✓ nessun errore\n');

    console.log('✅ Migrazione a posto: si può pubblicare.');
    uscita = 0;
  } catch (e) {
    console.error('\n✗ MIGRAZIONE NON RIUSCITA — NON pubblicare.');
    console.error('  ' + e.message);
  } finally {
    // Solo se era stata davvero creata: se la connessione è caduta subito, non c'è
    // niente da togliere e dirlo manderebbe a cercare una stanza che non esiste.
    if (creata) {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`\nStanza di prova rimossa (${schema}).`);
      } catch (e) {
        console.error(`\n⚠️ Stanza di prova NON rimossa: ${schema} — toglierla a mano.`);
      }
    }
    await admin.end();
    process.exit(uscita);
  }
})();
