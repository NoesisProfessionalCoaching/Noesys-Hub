/**
 * AZZERA LE PROFORMA DI COLLAUDO e riporta la numerazione a 001.
 *
 *   guarda (non tocca niente):  node --env-file=.env.reale scripts/azzera-proforma.js
 *   esegui davvero:             node --env-file=.env.reale scripts/azzera-proforma.js --esegui
 *
 * ⭐ IL CONTATORE NON ESISTE, e questa è la cosa che rende tutto semplice: il
 *    numero nasce da `MAX(progressivo) + 1` al momento dell'inserimento
 *    (routes.js). Quindi non c'è nessun contatore da «riportare indietro»:
 *    svuotata la tabella, la prossima proforma è 001 da sola.
 *
 * ⛔ NON CANCELLA NIENTE SE TROVA UNA PROFORMA CHE NON RICONOSCE COME DI
 *    COLLAUDO. Il riconoscimento è per nome del destinatario, non per un flag:
 *    `clients.di_collaudo` qui non serve a niente, perché le proforma di prova
 *    hanno `client_id` a NULL (il cliente è stato cancellato) e il flag si
 *    perde. Il nome congelato in `destinatario_dati` invece resta.
 *
 * ⚠️ Di default GUARDA E BASTA. Serve `--esegui` per toccare qualcosa, e tutto
 *    avviene dentro una transazione: se un pezzo fallisce, non si cancella nulla.
 */
const { Client } = require('pg');

// I nomi che si riconoscono come collaudo. ⚠️ Si allunga a mano, di proposito:
// una regola automatica prima o poi scambierebbe un cliente vero per una prova.
const DI_COLLAUDO = ['Prova Soldi', 'Flamingo Beauty', 'Giulia Testi', 'Betty', 'Ninny', 'Federica Rodi', 'Prova'];

// ⭐ Un nome imprevisto si autorizza QUI, sulla riga di comando, non modificando
//    l'elenco qui sopra:  --anche="Marco Bianchi"
//    Così la decisione la prende chi lancia il comando, in quel momento, e non
//    resta scritta per sempre in un elenco che nessuno rilegge.
const ANCHE = process.argv.filter(a => a.startsWith('--anche='))
  .map(a => a.slice('--anche='.length).replace(/^["']|["']$/g, ''))
  .filter(Boolean);

const ESEGUI = process.argv.includes('--esegui');
const url = process.env.DATABASE_URL_REALE || process.env.DATABASE_URL;
if (!url) { console.log('⛔ Manca l\'indirizzo del database.'); process.exit(1); }

const eur = n => '€ ' + Number(n).toFixed(2).replace('.', ',');

(async () => {
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  console.log(`Database: ${new URL(url).hostname}  —  ${ESEGUI ? '⚠️  MODIFICA' : 'solo lettura'}\n`);

  const pf = (await db.query(`
    SELECT p.id, p.numero, p.stato, p.totale_documento, p.fattura_numero,
           COALESCE(p.destinatario_dati->>'denominazione',
                    trim(concat(p.destinatario_dati->>'nome', ' ', p.destinatario_dati->>'cognome')),
                    '(senza destinatario)') AS a_chi
      FROM proforme p ORDER BY p.anno, p.progressivo`)).rows;

  if (!pf.length) {
    console.log('✅ Non c\'è nessuna proforma: la prossima sarà già 001.');
    await db.end(); return;
  }

  const incassi  = (await db.query('SELECT proforma_id, importo FROM incassi')).rows;
  const nRighe   = Number((await db.query('SELECT count(*) n FROM proforma_righe')).rows[0].n);

  console.log('LE PROFORMA CHE CI SONO');
  const estranee = [];
  for (const p of pf) {
    const suo = incassi.filter(i => i.proforma_id === p.id);
    const collaudo = [...DI_COLLAUDO, ...ANCHE].some(n => p.a_chi.toLowerCase().includes(n.toLowerCase()));
    if (!collaudo) estranee.push(p);
    console.log(`  ${collaudo ? '⚗️ ' : '🔴 '} ${p.numero}  ${String(p.stato).padEnd(10)} ${eur(p.totale_documento).padStart(12)}  ${p.a_chi}` +
      (suo.length ? `   [incasso ${eur(suo[0].importo)}]` : '') +
      (p.fattura_numero ? `   [fattura ${p.fattura_numero}]` : ''));
  }
  console.log(`\n  ${pf.length} proforma · ${nRighe} righe di dettaglio · ${incassi.length} incassi`);

  if (estranee.length) {
    console.log(`\n🔴 FERMO: ${estranee.length} proforma NON sono riconosciute come collaudo:`);
    estranee.forEach(p => console.log(`   ${p.numero} → «${p.a_chi}»`));
    console.log('   Non cancello niente. Se sono di prova, aggiungi il nome in DI_COLLAUDO.');
    await db.end(); process.exit(1);
  }

  if (!ESEGUI) {
    console.log('\n👀 Guardato e basta. Per farlo davvero: aggiungi --esegui');
    await db.end(); return;
  }

  console.log('\n⚠️  CANCELLO (dentro una transazione)…');
  await db.query('BEGIN');
  try {
    const a = await db.query('DELETE FROM incassi');
    const b = await db.query('DELETE FROM proforma_righe');
    const c = await db.query('DELETE FROM proforme');
    console.log(`   incassi: ${a.rowCount} · righe: ${b.rowCount} · proforma: ${c.rowCount}`);
    const resto = Number((await db.query('SELECT count(*) n FROM proforme')).rows[0].n);
    if (resto !== 0) throw new Error('sono rimaste ' + resto + ' proforma');
    await db.query('COMMIT');
    console.log('\n✅ Fatto. La prossima proforma sarà 2026/001.');
    console.log('   ⚠️ Restano da cancellare A MANO i PDF di prova sul Drive: lo fa Germano.');
  } catch (e) {
    await db.query('ROLLBACK');
    console.log('\n⛔ Annullato, non è stato cancellato niente: ' + e.message);
    process.exitCode = 1;
  }
  await db.end();
})();
