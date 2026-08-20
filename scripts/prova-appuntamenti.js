// ═══════════════════════════════════════════════════════════════════════════
// PROVA DELLA REGOLA «VINCE L'ULTIMA NOTIZIA» — server/appuntamenti.js.
//
// 🔴 IL BUCO CHE CHIUDE, segnato come noto il 12/08/2026 e rimasto aperto:
// «la regola vive in SQL e `npm run prova` NON la copre. Verificata a mano. Se
// un domani si tocca quella query, niente suona l'allarme — e un appuntamento
// con la data sbagliata è un guasto silenzioso».
// È il tipo di guasto peggiore: non dà errore, ti fa presentare nel giorno
// sbagliato.
//
// ⚠️ Questa regola NON si può provare con dei numeri come le altre: vive in una
// query che unisce tre tabelle. Quindi la prova costruisce un database VERO in
// una stanza temporanea (come `prova-migrazione.js`), ci mette dentro i casi, fa
// girare la query ESPORTATA dal modulo — non una copia — e poi butta la stanza.
// ⭐ Usa `appuntamenti.EFFETTIVO`: se qualcuno cambia quella query, questa prova
// gira sulla versione nuova. Copiarla qui l'avrebbe resa inutile.
//
//   node --env-file=.env scripts/prova-appuntamenti.js
// ═══════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ Manca DATABASE_URL. Lancia con: node --env-file=.env scripts/prova-appuntamenti.js');
  process.exit(1);
}
// ⚠️ La stanza si crea SEMPRE sul database di sviluppo: se questo script
// puntasse alla produzione creerebbe (e cancellerebbe) uno schema là dentro.
const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';
if (host.startsWith('reseau')) {
  console.error('✗ Questo è il database VERO. La prova gira solo sullo sviluppo.');
  process.exit(1);
}
const schema = 'prova_appuntamenti_' + process.pid + '_' + Date.now().toString(36);
const ssl = () => (url.includes('.railway.internal') || url.includes('localhost')) ? false : { rejectUnauthorized: false };

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) console.log(`✓ ${titolo}`);
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

(async () => {
  const admin = new Pool({ connectionString: url, ssl: ssl() });
  let creata = false;
  try {
    console.log(`Database: ${host}\nStanza di prova: ${schema}\n`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    creata = true;

    const sep = url.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${url}${sep}options=${encodeURIComponent('-c search_path=' + schema)}`;
    const db = require('../server/db.js');
    const appuntamenti = require('../server/appuntamenti.js');
    await db.init();

    // ── I casi, uno per persona, così ognuno si legge da solo ───────────────
    // `creata` = quando è arrivato il report; `updated_at` = quando ha scritto
    // il coach. È il confronto fra queste due che decide chi vince.
    const q = (s, p) => db.query(s, p);
    const casi = [
      // nome                  report          quando il report  mano             quando la mano   atteso
      ['Report e basta',       ['2026-09-01', '10:00'], '2026-08-01', null,                    null,          { scad: '2026-09-01', ora: '10:00', fonte: 'report' }],
      ['Mano dopo il report',  ['2026-09-01', '10:00'], '2026-08-01', ['2026-09-05', '15:00'], '2026-08-10',  { scad: '2026-09-05', ora: '15:00', fonte: 'mano' }],
      ['Report dopo la mano',  ['2026-09-20', '09:00'], '2026-08-15', ['2026-09-05', '15:00'], '2026-08-10',  { scad: '2026-09-20', ora: '09:00', fonte: 'report' }],
      ['Tolto a mano',         ['2026-09-01', '10:00'], '2026-08-01', [null, null],            '2026-08-10',  { scad: null, ora: null, fonte: 'mano' }],
      ['Solo mano, nessun report', [null, null],        null,         ['2026-09-08', '11:30'], '2026-08-10',  { scad: '2026-09-08', ora: '11:30', fonte: 'mano' }],
      ['Niente di niente',     [null, null],            null,         null,                    null,          { scad: null, ora: null, fonte: 'report' }],
    ];

    for (const [nome, rep, quandoRep, mano, quandoMano] of casi) {
      const cid = randomUUID(), pid = randomUUID();
      await q(`INSERT INTO clients (id, name, token) VALUES ($1,$2,$3)`, [cid, nome, randomUUID()]);
      await q(`INSERT INTO percorsi (id, client_id, tipo, stato) VALUES ($1,$2,'Percorso','attivo')`, [pid, cid]);
      if (rep[0]) {
        await q(`INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, stato, scadenza, prossima_ora, created_at)
                 VALUES ($1,$2,$3,'Ongoing','2026-07-01',1,'confermata',$4,$5,$6::timestamptz)`,
          [randomUUID(), pid, cid, rep[0], rep[1], quandoRep]);
      }
      if (mano) {
        await q(`INSERT INTO appuntamenti (id, percorso_id, data, ora, origine, updated_at)
                 VALUES ($1,$2,$3::date,$4,'mano',$5::timestamptz)`,
          [randomUUID(), pid, mano[0], mano[1], quandoMano]);
      }
    }

    const r = await db.query(`SELECT name, scad::text, ora, fonte FROM (${appuntamenti.EFFETTIVO}) v`);
    const per = new Map(r.rows.map(x => [x.name, { scad: x.scad, ora: x.ora, fonte: x.fonte }]));

    console.log('— CHI VINCE, CASO PER CASO —');
    for (const [nome, , , , , atteso] of casi) prova(nome, atteso, per.get(nome));

    console.log('\n— LE DUE TRAPPOLE —');
    // ⭐ La più insidiosa: «tolto a mano» NON deve far riaffiorare il report.
    prova('«tolto a mano» non fa riaffiorare l’appuntamento del report',
      null, per.get('Tolto a mano').scad);
    // Un percorso CHIUSO non deve comparire: la home mostra solo gli attivi.
    const cid = randomUUID(), pid = randomUUID();
    await q(`INSERT INTO clients (id, name, token) VALUES ($1,'Percorso concluso',$2)`, [cid, randomUUID()]);
    await q(`INSERT INTO percorsi (id, client_id, tipo, stato) VALUES ($1,$2,'Percorso','concluso')`, [pid, cid]);
    await q(`INSERT INTO appuntamenti (id, percorso_id, data, ora, origine) VALUES ($1,$2,'2026-09-30','10:00','mano')`,
      [randomUUID(), pid]);
    const r2 = await db.query(`SELECT count(*)::int n FROM (${appuntamenti.EFFETTIVO}) v WHERE name = 'Percorso concluso'`);
    prova('un percorso concluso resta fuori', 0, r2.rows[0].n);

    console.log(falliti ? `\n✗ ${falliti} prove fallite` : '\n✓ tutte le prove passate');
  } catch (e) {
    falliti = 1;
    console.error('\n✗ PROVA NON RIUSCITA:', e.message);
  } finally {
    if (creata) {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); console.log(`\nStanza di prova rimossa (${schema}).`); }
      catch { console.error(`\n⚠️ Stanza di prova NON rimossa: ${schema} — toglierla a mano.`); }
    }
    await admin.end().catch(() => {});
    process.exit(falliti ? 1 : 0);
  }
})();
