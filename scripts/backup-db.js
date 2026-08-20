// ═══════════════════════════════════════════════════════════════════════════
// BACKUP COMPLETO DEL DATABASE NOESYS in un file JSON.
//
//   node --env-file=.env.reale scripts/backup-db.js ~/Noesys-Backup     (PRODUZIONE)
//   node --env-file=.env       scripts/backup-db.js ~/Noesys-Backup     (sviluppo)
//   node scripts/backup-db.js <DATABASE_URL> <cartella>                 (come prima)
//
// 🔴 20/08/2026 — PERCHÉ È STATO RIFATTO. L'elenco delle tabelle era SCRITTO A
// MANO e si era fermato a 7: coach, clients, sessions, leads, percorsi, sedute,
// payments. Nel frattempo il database era arrivato a 20, e restavano fuori
// committenti, progetti, partecipazioni, appuntamenti, proforme, proforma_righe,
// tranche_progetto, incassi, emittente, moduli_letti, permessi_strumenti,
// fasi_progetto — cioè tutto il lavoro da luglio in poi, compresa l'intera
// catena dei soldi.
// ⭐ Uno strumento di salvataggio che salva metà delle cose è PEGGIO di nessuno,
// perché fa credere di essere coperti. ➜ Adesso l'elenco lo chiede al database
// (`information_schema`), quindi comprende da solo anche le tabelle che
// nasceranno domani: la stessa lezione di `prova-file`, una regola che sta solo
// in una lista scritta a mano prima o poi resta indietro.
// ⚠️ Il file contiene DATI PERSONALI dei clienti e la password (cifrata) del
// coach: si tiene in un posto suo, non nel repository e mai su GitHub.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ⚠️ In `.env.reale` la variabile si chiama DATABASE_URL_REALE, non DATABASE_URL:
// è una precauzione voluta, così un comando distratto non parte sulla produzione.
function leggiArgomenti() {
  const a = process.argv.slice(2);
  const pareUrl = s => /^postgres(ql)?:\/\//.test(s || '');
  if (pareUrl(a[0])) return { url: a[0], dir: a[1] };
  return { url: process.env.DATABASE_URL_REALE || process.env.DATABASE_URL, dir: a[0] };
}

async function main() {
  const { url, dir } = leggiArgomenti();
  if (!url || !dir) {
    console.error('Uso: node --env-file=.env.reale scripts/backup-db.js <cartella-destinazione>');
    process.exit(1);
  }
  const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';
  console.log(`Database: ${host}`);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ⭐ L'elenco NON è scritto qui: è il database a dire quali tabelle ha.
  const elenco = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`);
  const tabelle = elenco.rows.map(r => r.table_name);
  console.log(`${tabelle.length} tabelle da salvare\n`);

  const backup = { creato_il: new Date().toISOString(), database: host, tabelle: {} };
  let righeTotali = 0, falliti = 0;
  for (const t of tabelle) {
    try {
      // Il nome viene dal database stesso, ma si cita lo stesso: un nome con una
      // maiuscola o un trattino manderebbe in errore la query.
      const r = await client.query(`SELECT * FROM "${t}"`);
      backup.tabelle[t] = r.rows;
      righeTotali += r.rows.length;
      console.log(`  ${t}: ${r.rows.length} righe`);
    } catch (e) {
      falliti++;
      backup.tabelle[t] = { errore: e.message };
      console.log(`  ${t}: ERRORE — ${e.message}`);
    }
  }
  await client.end();

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const file = path.join(dir, `noesys-backup-${stamp}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));

  const mb = (fs.statSync(file).size / 1048576).toFixed(2);
  console.log(`\n✅ Backup salvato: ${file}`);
  console.log(`   ${tabelle.length} tabelle · ${righeTotali} righe · ${mb} MB`);
  // Una tabella che non si riesce a leggere non deve passare inosservata: il
  // backup c'è, ma è incompleto, e chi lo lancia deve saperlo.
  if (falliti) {
    console.log(`\n⚠️  ${falliti} tabelle NON salvate: il backup è incompleto.`);
    process.exit(1);
  }
}

main().catch(err => { console.error('❌ Backup fallito:', err.message); process.exit(1); });
