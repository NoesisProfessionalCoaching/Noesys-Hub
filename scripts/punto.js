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

// ── I numeri veri, in sola lettura ──────────────────────────────────────────
// «I numeri hanno una firma»: se non tornano con quello che ricordo, è cambiato
// qualcosa fuori dalla conversazione — o sta girando una versione diversa.
async function numeriVeri() {
  const url = process.env.DATABASE_URL_REALE;
  if (!url) { dì('\n🔎 DATI VERI — saltati (manca --env-file=.env.reale)'); return; }
  const { Pool } = require(path.join(REPO, 'node_modules', 'pg'));
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 8000,
  });
  try {
    const q = async s => (await pool.query(s)).rows;
    const [c] = await q('SELECT count(*)::int n FROM clients');
    const [p] = await q("SELECT count(*)::int n, count(*) FILTER (WHERE stato='attivo')::int attivi FROM percorsi");
    const pf = await q('SELECT stato, count(*)::int n FROM proforme GROUP BY stato ORDER BY stato');
    const [i] = await q('SELECT count(*)::int n, COALESCE(sum(importo),0)::float tot FROM incassi');
    const [ult] = await q('SELECT numero FROM proforme ORDER BY anno DESC, progressivo DESC LIMIT 1');
    const [daF] = await q(`SELECT count(*)::int n FROM proforme p
      WHERE p.stato='inviata' AND p.fattura_numero IS NULL
        AND COALESCE((SELECT sum(importo) FROM incassi i WHERE i.proforma_id=p.id),0) >= p.da_pagare`);
    dì('\n🔎 DATI VERI (produzione, sola lettura)');
    dì(`   clienti ${c.n} · percorsi ${p.n} (${p.attivi} attivi)`);
    dì(`   proforma: ${pf.map(r => r.stato + ' ' + r.n).join(' · ')} — ultimo numero ${ult ? ult.numero : '—'}`);
    dì(`   incassi registrati ${i.n} (€ ${i.tot.toFixed(2)}) · da fatturare in SuperBill: ${daF.n}`);
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
