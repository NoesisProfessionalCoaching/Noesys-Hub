// ═══════════════════════════════════════════════════════════════════════════
// IL PUNTO DELLA SITUAZIONE — la fotografia che apre ogni sessione.
//
// Nasce il 20/08/2026, da una domanda di Germano: «esiste un modo per essere
// certi che a ogni inizio di sessione tu abbia tutte le informazioni corrette
// e anche contezza del tempo che passa?».
//
// 🔴 I DUE BUCHI CHE CHIUDE, misurati sul campo:
//   1. **Il tempo.** Fra una sessione e l'altra non percepisco niente: il 17-18/08
//      ho datato commit e memorie deducendo il giorno dalla conversazione invece
//      di guardare l'orologio, e ho sbagliato di tre giorni. ➜ La data si LEGGE.
//   2. **Il quadro.** Un prospetto delle cose da fare costruito su quello che
//      avevo letto in quella sessione aveva saltato due cantieri interi
//      (Calendly, reportistica finale). ➜ Si parte dalla mappa, non dai ricordi.
//
// ⭐ Perché uno script e non una regola scritta in una memoria: è la lezione di
// `prova-file`. Una regola che vive solo in una memoria prima o poi non viene
// applicata; una che gira da sola all'avvio, sì.
//
// USO:  node --env-file=.env.reale scripts/punto.js
// (senza --env-file funziona lo stesso: salta solo la parte sui dati veri)
// ⚠️ SOLA LETTURA sul database, come guarda-produzione.js: stessa doppia
// garanzia (`default_transaction_read_only=on` + nessuna query scritta da fuori).
// ═══════════════════════════════════════════════════════════════════════════
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/Users/macbook12/Developer/Noesys-Hub';
const MEMORIE = '/Users/macbook12/.claude/projects/-Users-macbook12-Library-Mobile-Documents-com-apple-CloudDocs-Allenati-per-l-eccellenza-Materiali-per-Sessioni-Strumenti-Touch/memory';
const MAPPA = path.join(MEMORIE, 'noesys-mappa-cantieri.md');

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const oggi = new Date();
const iso = d => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
const inItaliano = d => `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
const giorniFra = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const quanto = g => g === 0 ? 'oggi' : g === 1 ? 'ieri' : g < 0 ? `fra ${-g} giorni` : `${g} giorni fa`;

const righe = [];
const dì = s => righe.push(s);

dì('═══════════════════════════════════════════════════════════════');
dì(`  OGGI È ${inItaliano(oggi).toUpperCase()}, ore ${oggi.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`);
dì('═══════════════════════════════════════════════════════════════');

// ── Da quanto non ci si vede ────────────────────────────────────────────────
// L'ultima memoria toccata dice quando è finita la sessione precedente: è il
// solo modo che ho di sapere se sono passate due ore o due settimane.
try {
  const files = fs.readdirSync(MEMORIE).filter(f => f.endsWith('.md'));
  const ultima = files.map(f => ({ f, t: fs.statSync(path.join(MEMORIE, f)).mtime }))
    .sort((a, b) => b.t - a.t)[0];
  const g = giorniFra(iso(ultima.t), iso(oggi));
  dì(`\n⏱  ULTIMA SESSIONE: ${quanto(g)} (${inItaliano(ultima.t)})`);
  if (g >= 7) dì(`   ⚠️  Sono passati ${g} giorni: i numeri qui sotto possono essere cambiati parecchio.`);
} catch (e) { dì(`\n⏱  (non riesco a leggere le memorie: ${e.message})`); }

// ── L'Hub: cosa è pubblicato e cosa no ──────────────────────────────────────
try {
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
  const [hash, quando, titolo] = git('log', '-1', '--format=%h|%ad|%s', '--date=format-local:%Y-%m-%d').split('|');
  dì(`\n📦 HUB — ultimo commit ${hash} del ${quando} (${quanto(giorniFra(quando, iso(oggi)))})`);
  dì(`   «${titolo}»`);
  const sporco = git('status', '--porcelain');
  const daPubblicare = git('log', 'origin/main..main', '--oneline');
  if (sporco) dì(`   ⚠️  ci sono modifiche NON salvate:\n${sporco.split('\n').map(r => '        ' + r).join('\n')}`);
  if (daPubblicare) dì(`   ⚠️  ci sono commit NON pubblicati:\n${daPubblicare.split('\n').map(r => '        ' + r).join('\n')}`);
  if (!sporco && !daPubblicare) dì('   ✓ tutto salvato e pubblicato');
} catch (e) { dì(`\n📦 HUB — (git non risponde: ${e.message})`); }

// ── Le scadenze, lette DALLA MAPPA e non scritte qui ────────────────────────
// ⭐ Stanno in un posto solo: le righe della mappa che cominciano per
// «📅 SCADENZA AAAA-MM-GG —». Scriverle anche qui vorrebbe dire due elenchi che
// prima o poi divergono — l'errore che questo script esiste per non ripetere.
try {
  const testo = fs.readFileSync(MAPPA, 'utf8');
  const trovate = [...testo.matchAll(/📅 SCADENZA (\d{4}-\d{2}-\d{2}) — (.+)/g)]
    .map(m => ({ data: m[1], cosa: m[2].replace(/\*\*/g, ''), g: giorniFra(iso(oggi), m[1]) }))
    .sort((a, b) => a.g - b.g);
  if (trovate.length) {
    dì('\n📅 SCADENZE');
    for (const s of trovate) {
      const segno = s.g < 0 ? '🔴 SCADUTA' : s.g <= 7 ? '🟠' : '  ';
      dì(`   ${segno} ${s.data} (${quanto(-s.g)}) — ${s.cosa}`);
    }
  }
} catch (e) { dì(`\n📅 (mappa dei cantieri non leggibile: ${e.message})`); }

// ── L'ETÀ DELLE FONTI VIVE (26/08/2026) ─────────────────────────────────────
// 🔴 PERCHÉ ESISTE: il «NOESYS — Brief e Roadmap.md» era il documento che si
// leggeva a ogni sessione e si aggiornava a ogni fine. È morto l'11/07/2026 e
// NESSUNO se n'è accorto per 46 giorni — anzi, il 21/08 lo citavo ancora come
// riferimento. Era morto di fame: un secondo sistema (le mappe vive in memoria)
// aveva preso il suo posto, e niente guardava la sua data.
// ⭐ Adesso la data la guarda una macchina. Un file vivo che smette di essere
//    toccato si vede il giorno dopo, non dopo sei settimane.
try {
  const fonti = [
    { nome: 'mappa dei cantieri', file: MAPPA, allarme: 10 },
    { nome: 'regole di lavoro (CLAUDE.md)', file: '/Users/macbook12/.claude/CLAUDE.md', allarme: 90 },
  ];
  const righeFonti = [];
  for (const f of fonti) {
    if (!fs.existsSync(f.file)) { righeFonti.push(`   🔴 ${f.nome} — NON ESISTE PIÙ (${f.file})`); continue; }
    const g = giorniFra(iso(new Date(fs.statSync(f.file).mtime)), iso(oggi));
    const segno = g > f.allarme ? '🔴' : g > f.allarme / 2 ? '🟠' : '  ';
    righeFonti.push(`   ${segno} ${f.nome} — aggiornata ${quanto(g)}`);
  }
  if (righeFonti.some(r => r.includes('🔴') || r.includes('🟠'))) {
    dì('\n🗺️  FONTI VIVE');
    righeFonti.forEach(dì);
    dì('      Una fonte che non si tocca più sta morendo: o si aggiorna, o si dichiara archiviata.');
  }
} catch (_) { /* mai fermare l'avvio per questo */ }

// ── I numeri veri, in sola lettura ──────────────────────────────────────────
// «I numeri hanno una firma»: se non tornano con quello che ricordo, è cambiato
// qualcosa fuori dalla conversazione — o sta girando una versione diversa.
async function numeriVeri() {
  const url = process.env.DATABASE_URL_REALE;
  if (!url) { dì('\n🔎 DATI VERI — saltati (manca --env-file=.env.reale)'); return; }
  // ⚠️ SI DICE SEMPRE DA QUALE DATABASE VENGONO I NUMERI: è una regola del
  // cantiere, non una gentilezza. Questo script è nato dicendo «produzione»
  // mentre leggeva lo sviluppo — un numero senza la sua provenienza è un numero
  // di cui non ci si può fidare.
  const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';
  const dove = host.startsWith('reseau') ? 'PRODUZIONE' : 'SVILUPPO';
  const { Pool } = require(path.join(REPO, 'node_modules', 'pg'));
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 8000,
  });
  try {
    const q = async s => (await pool.query(s)).rows;
    // ⭐ 20/08 — I NUMERI SEPARANO I VERI DAI GUSCI DI PROVA.
    // Prima qui c'era `count(*) FROM clients` e usciva «clienti 15», mettendo
    // insieme le persone vere e i record di collaudo. Germano: «hai inserito un
    // numero di clienti falso». Un totale che mescola le due cose è una bugia, e
    // sui soldi è una bugia pericolosa: oggi Noesys ha incassato ZERO.
    // ⚠️ `di_collaudo IS NULL` = mai classificato. Non entra in nessuno dei due
    // conti e viene DETTO: è il modo in cui un record nuovo si fa notare invece
    // di scivolare dentro un totale.
    const [c] = await q(`SELECT count(*) FILTER (WHERE di_collaudo IS FALSE)::int veri,
                                count(*) FILTER (WHERE di_collaudo IS TRUE)::int prova,
                                count(*) FILTER (WHERE di_collaudo IS NULL)::int boh
                           FROM clients`);
    const [p] = await q(`SELECT count(*) FILTER (WHERE c.di_collaudo IS FALSE)::int veri,
                                count(*) FILTER (WHERE c.di_collaudo IS FALSE AND p.stato='attivo')::int attivi
                           FROM percorsi p JOIN clients c ON c.id = p.client_id`);
    const [k] = await q(`SELECT count(*) FILTER (WHERE di_collaudo IS NULL)::int boh FROM committenti`);
    const [g] = await q(`SELECT count(*) FILTER (WHERE di_collaudo IS NULL)::int boh FROM progetti`);
    // I soldi: veri = documenti che NON vanno a un cliente o committente di collaudo.
    const [s1] = await q(`SELECT
        COALESCE(sum(i.importo) FILTER (WHERE COALESCE(cl.di_collaudo, ko.di_collaudo) IS NOT TRUE), 0)::float veri,
        COALESCE(sum(i.importo) FILTER (WHERE COALESCE(cl.di_collaudo, ko.di_collaudo) IS TRUE), 0)::float prova
      FROM incassi i JOIN proforme pf ON pf.id = i.proforma_id
      LEFT JOIN clients cl ON cl.id = pf.client_id
      LEFT JOIN committenti ko ON ko.id = pf.committente_id`);
    const [ult] = await q('SELECT numero FROM proforme ORDER BY anno DESC, progressivo DESC LIMIT 1');
    dì(`\n🔎 DATI DAL DATABASE DI ${dove} — ${host} (sola lettura)`);
    dì(`   clienti VERI ${c.veri} (${p.veri} percorsi, ${p.attivi} attivi)`);
    dì(`   ⚗️  di collaudo, da non contare mai: ${c.prova} clienti · tutti i committenti · tutti i progetti`);
    dì(`   💶 incassato VERO: € ${s1.veri.toFixed(2)}   (di collaudo: € ${s1.prova.toFixed(2)})`);
    dì(`   proforma: ultimo numero bruciato ${ult ? ult.numero : '—'} — tutte di collaudo`);
    const boh = c.boh + k.boh + g.boh;
    if (boh) {
      dì(`\n   🔴 ${boh} RECORD NON CLASSIFICATI (${c.boh} clienti · ${k.boh} committenti · ${g.boh} progetti)`);
      dì('      Sono nati dopo l\'ultima classificazione: CHIEDERE A GERMANO se sono veri');
      dì('      o di prova, e scriverlo in db.js. Finché sono qui, non stanno in nessun conto.');
    }
  } catch (e) {
    dì(`\n🔎 DATI VERI — non raggiungibili (${e.message.split('\n')[0]})`);
  } finally { await pool.end().catch(() => {}); }
}

(async () => {
  await numeriVeri();
  dì('\n───────────────────────────────────────────────────────────────');
  dì('  ⛔ PRIMA DI PROPORRE COSA FARE: leggere noesys-mappa-cantieri.md');
  dì('     (la mappa di TUTTE le mappe). Il prospetto si costruisce da lì,');
  dì('     mai da quello che ricordo di questa conversazione.');
  dì('───────────────────────────────────────────────────────────────');
  console.log(righe.join('\n'));
})();
