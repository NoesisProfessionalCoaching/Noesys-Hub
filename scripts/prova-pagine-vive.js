/**
 * LE PAGINE SI APRONO DAVVERO — la prova che mancava.
 *
 * 🕳️ IL BUCO CHE CHIUDE, aperto nella mappa dal 28/08/2026: `npm run prova`
 *    controllava il JS che gira nel BROWSER e che i file compilassero, ma NON
 *    che le pagine del server rispondessero 200. Quel giorno la pagina del
 *    progetto rispondeva «Errore» e la catena delle prove era passata lo stesso.
 *
 * ⭐ IL CASO SI COSTRUISCE PREMENDO I PULSANTI, non scrivendo nel database.
 *    Sempre il 28/08 avevo creato un progetto di prova con l'SQL: gli mancava il
 *    percorso condiviso che l'Hub crea da sé quando agganci il primo
 *    partecipante, quindi la prova girava su un caso che nella realtà non
 *    esiste — e se n'è accorto Germano, non io.
 *
 * 🔬 E SI ROMPE APPOSTA. Una prova che non si è mai vista fallire non prova
 *    niente: metà dei controlli qui dentro verificano che le cose sbagliate
 *    vengano RIFIUTATE, e che dopo un rifiuto i dati buoni siano intatti.
 *
 * ⚠️ Gira sul database di PROVA (`--env-file=.env`) e ripulisce dietro di sé le
 *    sole righe che ha creato. Non tocca mai la produzione.
 * ⚠️ Le cartelle Drive falliscono di proposito (mancano le chiavi Google in
 *    .env): è atteso, l'Hub prosegue e stampa «[drive] … fallita».
 */
const express = require('express');
const cookieParser = require('cookie-parser');

const routes = require('../server/routes');
const db = require('../server/db');
// ⭐ Fetta 1.2 (04/09) — LA POSTA È FINTA. `.env` non ha le chiavi Gmail e non
//    deve averle: qui si sostituisce il solo `sendMail` con uno che mette la mail
//    in un cestino, così la rotta della proforma può fare il suo giro intero
//    (mandare → incassare → fatturare) senza che nulla parta davvero. Le rotte che
//    guardano `mailerReady()` (Mail 1 e 2) continuano a dire «posta non
//    configurata»: quella funzione non si tocca.
const mailer = require('../server/mailer');
const postaFinta = [];
mailer.sendMail = async (m) => { postaFinta.push(m); return { finta: true }; };
// ⭐ E LA CARTA INTESTATA È BIANCA. Il PDF della proforma si appoggia sulla carta
//    intestata scaricata da Drive: qui, senza chiavi, si danno le tre funzioni che
//    servono a quel solo scarico una pagina A4 vuota. Tutto il resto di Drive
//    (l'archiviazione della copia, le cartelle del cliente) resta vero e fallisce
//    come deve: la prova controlla che la rotta lo DICA.
const drive = require('../server/google-drive');
const { PDFDocument } = require('pdf-lib');
let cartaBianca = null;
drive.findModelliFolder = async () => ({ id: 'modelli-finti' });
drive.findFileByName = async (parentId, name) => ({ id: 'carta-finta', name });
drive.downloadFileBuffer = async () => {
  if (!cartaBianca) {
    const d = await PDFDocument.create();
    // Un rettangolo invisibile: senza un contenuto qualsiasi la pagina non si
    // può appoggiare come sfondo («missing Contents»).
    d.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 0, width: 1, height: 1, opacity: 0 });
    cartaBianca = Buffer.from(await d.save());
  }
  return cartaBianca;
};
const { signToken, COOKIE_NAME } = require('../server/auth');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cookieParser());
app.use(routes);
const srv = app.listen(0);
const PORTA = srv.address().port;
const BISCOTTO = COOKIE_NAME + '=' + signToken({ role: 'coach', id: 'prova', username: 'prova' });

let ok = 0, ko = 0;
const dice = (b, t, extra) => { if (b) { ok++; console.log('   ✓ ' + t); } else { ko++; console.log('   ✗ ' + t + (extra ? '  → ' + extra : '')); } };
const chiama = async (metodo, url, corpo) => {
  const r = await fetch(`http://127.0.0.1:${PORTA}${url}`, {
    method: metodo, redirect: 'manual',
    headers: { Cookie: BISCOTTO, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const testo = await r.text();
  let dati = null; try { dati = JSON.parse(testo); } catch {}
  return { stato: r.status, testo, dati };
};

(async () => {
  // ⚠️ La migrazione PRIMA di tutto: senza, la prova gira su un database vecchio e
  //    fallisce per un motivo che non c'entra col codice appena scritto. Successo
  //    il 30/08 con la tabella `contratti`, che qui dentro non esisteva ancora.
  await db.init();
  const marca = 'PROVA-PREVISTE-' + PORTA;
  let idCli, idComm, idProg, idPerc, idLead;
  try {
    console.log('\n1. Costruisco il caso coi pulsanti');
    let r = await chiama('POST', '/dashboard/clients', { nome: 'Prova', cognome: marca, area: 'Business' });
    idCli = r.dati && (r.dati.id || (r.dati.client && r.dati.client.id));
    dice(!!idCli, 'cliente creato', r.stato + ' ' + r.testo.slice(0, 120));
    r = await chiama('POST', '/dashboard/committenti', { denominazione: marca, area: 'Business' });
    idComm = r.dati && r.dati.id;
    dice(!!idComm, 'committente creato', r.stato + ' ' + r.testo.slice(0, 120));
    r = await chiama('POST', '/dashboard/progetti', { committente_id: idComm, titolo: marca, area: 'Business', tipo: 'team', stato: 'attivo' });
    idProg = r.dati && r.dati.id;
    dice(!!idProg, 'progetto TEAM creato', r.stato + ' ' + r.testo.slice(0, 120));
    r = await chiama('POST', `/dashboard/progetti/${idProg}/coachee`, { clientId: idCli });
    dice(r.stato === 200, 'partecipante agganciato (è questo che crea il percorso condiviso)', r.stato + ' ' + r.testo.slice(0, 120));

    const p = await db.query('SELECT id, n_sessioni_previste FROM percorsi WHERE progetto_id=$1 AND client_id IS NULL', [idProg]);
    idPerc = p.rows[0] && p.rows[0].id;
    dice(!!idPerc, 'il percorso condiviso esiste davvero');
    dice(p.rows[0] && Number(p.rows[0].n_sessioni_previste) === 8, 'nasce a 8 — il valore di riserva, che nessuno ha scelto');

    console.log('\n2. La pagina si apre e mostra il campo');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.stato === 200, 'la pagina del progetto risponde 200 (non «Errore»)', r.stato);
    dice(r.testo.includes('id="sp-previste"'), 'il campo delle sessioni previste è nella pagina');
    dice(r.testo.includes('salvaPreviste()'), 'il pulsante Salva è agganciato alla funzione');

    console.log('\n3. Il giro completo: cambio → salvo → ricarico → controllo');
    r = await chiama('POST', `/dashboard/progetti/${idProg}/percorsi/${idPerc}/previste`, { n_sessioni_previste: 12 });
    dice(r.stato === 200 && r.dati && r.dati.ok, 'il salvataggio risponde ok', r.stato + ' ' + r.testo.slice(0, 120));
    const q = await db.query('SELECT n_sessioni_previste FROM percorsi WHERE id=$1', [idPerc]);
    dice(Number(q.rows[0].n_sessioni_previste) === 12, 'nel database ora sono 12');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('value="12"'), 'e la pagina ricaricata mostra 12');

    console.log('\n4. 🔬 Adesso la rompo apposta');
    for (const [valore, etichetta] of [[0, 'zero'], [101, 'centouno'], [7.5, 'con la virgola'], ['otto', 'una parola'], [null, 'niente']]) {
      r = await chiama('POST', `/dashboard/progetti/${idProg}/percorsi/${idPerc}/previste`, { n_sessioni_previste: valore });
      dice(r.stato === 400, `rifiuta ${etichetta}`, 'ha risposto ' + r.stato);
    }
    const q2 = await db.query('SELECT n_sessioni_previste, n_sessioni_fatte FROM percorsi WHERE id=$1', [idPerc]);
    dice(Number(q2.rows[0].n_sessioni_previste) === 12, 'dopo i cinque rifiuti il valore buono è ancora 12');
    dice(Number(q2.rows[0].n_sessioni_fatte) === 0, 'le sessioni FATTE non sono state toccate');

    console.log('\n5. 🔬 E provo a colpire il percorso di un CLIENTE, che non deve poter toccare');
    const pc = await db.query(
      `INSERT INTO percorsi (id, client_id, tipo, n_sessioni_previste, stato) VALUES (gen_random_uuid(), $1, 'Individuale', 8, 'attivo') RETURNING id`, [idCli]);
    r = await chiama('POST', `/dashboard/progetti/${idProg}/percorsi/${pc.rows[0].id}/previste`, { n_sessioni_previste: 3 });
    dice(r.stato === 404, 'il percorso di un cliente è irraggiungibile da questa rotta', 'ha risposto ' + r.stato);
    const q3 = await db.query('SELECT n_sessioni_previste FROM percorsi WHERE id=$1', [pc.rows[0].id]);
    dice(Number(q3.rows[0].n_sessioni_previste) === 8, 'ed è rimasto a 8');
    await db.query('DELETE FROM percorsi WHERE id=$1', [pc.rows[0].id]);

    // ── Fetta 6a — gli stati della bozza di contratto ────────────────────────
    console.log('\n6. Il ciclo di vita della bozza di contratto');
    const statoDb = async () => (await db.query(
      "SELECT stato, data_invio, data_approvazione FROM contratti WHERE tipo='committente' AND progetto_id=$1",
      [idProg])).rows[0] || null;
    dice(await statoDb() === null, '«da redigere» è l\'ASSENZA della riga: il database è vuoto');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('Da redigere'), 'e la pagina lo mostra lo stesso, come «Da redigere»');

    for (const [st, atteso] of [['da_inviare', 'Da inviare'], ['in_attesa', 'In attesa di approvazione'], ['approvata', 'Approvata']]) {
      r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: st });
      dice(r.stato === 200, `passa a «${atteso}»`, r.stato + ' ' + r.testo.slice(0, 90));
      const d = await statoDb();
      dice(d && d.stato === st, `  e nel database c'è ${st}`);
      r = await chiama('GET', `/dashboard/progetti/${idProg}`);
      dice(r.testo.includes(atteso), `  e la pagina mostra «${atteso}»`);
    }
    let d6 = await statoDb();
    dice(!!d6.data_invio && !!d6.data_approvazione, 'le due date sono state registrate');

    console.log('\n7. L\'azione «Modifica contratto approvato» riporta a «da inviare»');
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'da_inviare' });
    d6 = await statoDb();
    dice(d6.stato === 'da_inviare', 'lo stato è tornato indietro');
    dice(!d6.data_invio && !d6.data_approvazione,
      'e le due date sono state AZZERATE: il documento cambia, quelle sarebbero date false');
    const quante = await db.query("SELECT count(*)::int AS n FROM contratti WHERE tipo='committente' AND progetto_id=$1", [idProg]);
    dice(quante.rows[0].n === 1, 'e la riga resta UNA: i passaggi non ne creano di nuove');

    // La firma dell'informativa NON è uno stato del contratto: si legge dalla
    // casella dell'anagrafica. Se un giorno qualcuno ne facesse una seconda, qui
    // si vedrebbe: la pagina deve cambiare quando cambia l'ANAGRAFICA.
    console.log('\n8. L\'informativa si legge dall\'anagrafica, non da uno stato suo');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('informativa non ancora firmata'), 'senza consenso la pagina lo dice');
    await db.query('UPDATE clients SET consenso_privacy=TRUE, consenso_data=CURRENT_DATE WHERE id=$1', [idCli]);
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('informativa firmata'), 'spuntata in anagrafica, la pagina del progetto la mostra firmata');
    dice(!r.testo.includes('informativa non ancora firmata'), 'e non dice piu il contrario');

    // ── Il contratto del CLIENTE INDIVIDUALE, sulla sua scheda ──────────────
    console.log('\n9. Lo stesso ciclo sulla scheda del cliente individuale');
    const pInd = await db.query(
      `INSERT INTO percorsi (id, client_id, tipo, n_sessioni_previste, stato)
       VALUES (gen_random_uuid(), $1, 'Individuale', 8, 'attivo') RETURNING id`, [idCli]);
    const idPercInd = pInd.rows[0].id;
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(r.stato === 200, 'la scheda del cliente risponde 200', r.stato);
    dice(r.testo.includes('Da redigere'), 'e mostra il contratto come «Da redigere»');
    // ⛔ Fetta 0.5 (04/09): i passaggi sono UNO alla volta, come i pulsanti della
    //    cella. Fino al 03/09 questa prova saltava da «da redigere» a «in attesa»
    //    in una chiamata, e la rotta lasciava fare.
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'in_attesa' });
    dice(r.stato === 400, '🔬 da «da redigere» non si salta a «in attesa»: 400', 'ha risposto ' + r.stato);
    let cInd = await db.query("SELECT stato FROM contratti WHERE tipo='cliente' AND percorso_id=$1", [idPercInd]);
    dice(cInd.rows.length === 0, '  e il rifiuto non ha creato nessuna riga');
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'da_inviare' });
    dice(r.stato === 200, 'lo stato si muove anche di qui: «l\'ho preparata»', r.stato + ' ' + r.testo.slice(0, 90));
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'in_attesa' });
    dice(r.stato === 200, '  poi «l\'ho inviata»', r.stato + ' ' + r.testo.slice(0, 90));
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(r.testo.includes('In attesa di approvazione'), 'e la scheda ricaricata lo mostra');
    cInd = await db.query("SELECT stato FROM contratti WHERE tipo='cliente' AND percorso_id=$1", [idPercInd]);
    dice(cInd.rows.length === 1 && cInd.rows[0].stato === 'in_attesa', 'nel database c\'è una riga sola, giusta');

    // ── Fetta 0.5 (04/09) — la Mail 2 manda il contratto del percorso GUARDATO ──
    // Fino al 03/09 l'anteprima usava il percorso dell'URL e la rotta della Mail 2
    // ne sceglieva uno per conto suo: con due percorsi individuali il PDF spedito
    // poteva non essere quello aperto. Ora la finestrella dice alla rotta QUALE
    // percorso ha mostrato, e la rotta lo accetta solo se è davvero del cliente.
    // ⚠️ In .env non ci sono le chiavi Gmail: la mail non può partire, e va bene
    //    così — qui si prova il controllo che sta PRIMA dell'invio.
    console.log('\n9b. La Mail 2 allega il contratto del percorso che si è guardato');
    dice(r.testo.includes(`/percorsi/${idPercInd}/contratto`), 'la finestrella della Mail 2 apre l\'anteprima su quel percorso');
    dice(r.testo.includes(`PERC_CONTRATTO = '${idPercInd}'`), 'e lo stesso percorso è quello che il pulsante «Approva e invia» manderà');
    const m2 = { to: 'prova@example.invalid', subject: 'Prova', body: 'Prova' };
    r = await chiama('POST', `/dashboard/clients/${idCli}/mail2/invia`, m2);
    dice(r.stato === 400 && /percorso/i.test(r.testo), '🔬 senza dire quale percorso, la rotta rifiuta (400) invece di sceglierne uno da sé', r.stato + ' ' + r.testo.slice(0, 100));
    r = await chiama('POST', `/dashboard/clients/${idCli}/mail2/invia`, { ...m2, percorso_id: idPerc });
    dice(r.stato === 404, '🔬 con un percorso che non è del cliente (quello del progetto): 404', r.stato + ' ' + r.testo.slice(0, 100));
    r = await chiama('POST', `/dashboard/clients/${idCli}/mail2/invia`, { ...m2, percorso_id: '00000000-0000-0000-0000-000000000000' });
    dice(r.stato === 404, '🔬 con un percorso inventato: 404', r.stato + ' ' + r.testo.slice(0, 100));
    r = await chiama('POST', `/dashboard/clients/${idCli}/mail2/invia`, { ...m2, percorso_id: idPercInd });
    dice(r.stato === 400 && /non configurato/i.test(r.testo), 'col percorso giusto il controllo passa, e si ferma solo perché qui non c\'è la posta', r.stato + ' ' + r.testo.slice(0, 100));
    const dopoM2 = await db.query('SELECT mail2_inviata_data FROM clients WHERE id=$1', [idCli]);
    dice(dopoM2.rows[0].mail2_inviata_data === null, '  e nessuna delle quattro chiamate ha segnato la Mail 2 come inviata');
    cInd = await db.query("SELECT stato FROM contratti WHERE tipo='cliente' AND percorso_id=$1", [idPercInd]);
    dice(cInd.rows.length === 1 && cInd.rows[0].stato === 'in_attesa', '  né ha toccato lo stato del contratto');
    // ── La sezione «Contratti» in Amministrazione ───────────────────────────
    // ⚠️ Questa prova esiste perché il 30/08, scrivendo la pagina, avevo chiamato
    //    una `footerNoesys()` che non esiste: `node --check` non se ne accorge,
    //    e la pagina avrebbe risposto «Errore» come il 28/08.
    console.log('\n10. La sezione Contratti in Amministrazione');
    r = await chiama('GET', '/dashboard/amministrazione/contratti');
    dice(r.stato === 200, 'la pagina risponde 200 (non «Errore»)', r.stato + ' ' + r.testo.slice(0, 120));
    dice(r.testo.includes('Percorsi singoli') && r.testo.includes('Progetti strutturati'),
      'ci sono i DUE elenchi separati che ha chiesto Germano');
    dice(r.testo.includes(marca), 'e dentro c\'è il caso appena costruito');
    dice(r.testo.includes('In attesa di approvazione'), 'con lo stato vero del contratto del cliente');
    dice(r.testo.includes('/dashboard/amministrazione/contratti'), 'e la voce sta nel menù dell\'area');

    // L'interruttore dei percorsi conclusi. ⛔ Quello che conta è che le righe
    // nascoste vengano DICHIARATE: nascondere in silenzio è peggio che mostrare.
    const percConcluso = await db.query(
      `INSERT INTO percorsi (id, client_id, tipo, stato) VALUES (gen_random_uuid(), $1, 'Individuale', 'concluso') RETURNING id`, [idCli]);
    const progConcluso = await chiama('POST', '/dashboard/progetti',
      { committente_id: idComm, titolo: marca + '-CHIUSO', area: 'Business', tipo: 'team', stato: 'concluso' });
    // e uno IN PAUSA, che NON deve sparire: è lavoro vivo che si è fermato
    const progPausa = await chiama('POST', '/dashboard/progetti',
      { committente_id: idComm, titolo: marca + '-PAUSA', area: 'Business', tipo: 'team', stato: 'in pausa' });

    r = await chiama('GET', '/dashboard/amministrazione/contratti');
    dice(/mostra anche .*conclus/.test(r.testo), 'di norma i conclusi sono nascosti, e la pagina DICE quanti sono');
    dice(!r.testo.includes(marca + '-CHIUSO'), 'il progetto concluso non si vede');
    dice(r.testo.includes(marca + '-PAUSA'), '⚠️ ma quello IN PAUSA sì: è lavoro fermo, non finito');
    const strette = (r.testo.match(/apri la scheda|apri il progetto/g) || []).length;
    r = await chiama('GET', '/dashboard/amministrazione/contratti?tutti=1');
    const larghe = (r.testo.match(/apri la scheda|apri il progetto/g) || []).length;
    dice(larghe > strette, 'con l\'interruttore acceso le righe aumentano');
    dice(r.testo.includes(marca + '-CHIUSO'), 'e il progetto concluso compare');
    dice(r.testo.includes('percorso concluso'), 'e i percorsi conclusi si riconoscono dal cartellino');
    dice(/nascondi .*conclus/.test(r.testo), 'e l\'interruttore si può rispegnere');
    await db.query('DELETE FROM percorsi WHERE id=$1', [percConcluso.rows[0].id]);
    for (const g of [progConcluso, progPausa]) if (g.dati && g.dati.id) {
      await db.query('DELETE FROM percorsi WHERE progetto_id=$1', [g.dati.id]);
      await db.query('DELETE FROM progetti WHERE id=$1', [g.dati.id]);
    }

    // ── Fetta 6b — il congelamento ───────────────────────────────────────────
    console.log('\n11. La tipologia si cambia dalla card, finché si può');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('id="sp-tipo"'), 'la tendina della tipologia è nella card');
    r = await chiama('POST', `/dashboard/progetti/${idProg}/tipo`, { tipo: 'group' });
    dice(r.stato === 200, 'si cambia in «group»', r.stato + ' ' + r.testo.slice(0, 90));
    let tp = await db.query('SELECT tipo FROM progetti WHERE id=$1', [idProg]);
    dice(tp.rows[0].tipo === 'group', 'e nel database è cambiata');
    r = await chiama('POST', `/dashboard/progetti/${idProg}/tipo`, { tipo: 'quadrupla' });
    dice(r.stato === 400, '🔬 rifiuta una tipologia inventata', 'ha risposto ' + r.stato);

    console.log('\n12. 🔒 Con una seduta registrata la tipologia si chiude');
    const sed = await db.query(
      `INSERT INTO sedute (id, percorso_id, tipo, data, ore, stato)
       VALUES (gen_random_uuid(), $1, 'Ongoing', CURRENT_DATE, 1, 'confermata') RETURNING id`, [idPerc]);
    r = await chiama('POST', `/dashboard/progetti/${idProg}/tipo`, { tipo: 'team' });
    dice(r.stato === 409, 'un percorso cominciato non cambia tipologia', 'ha risposto ' + r.stato);
    dice((r.dati && r.dati.error || '').includes('già cominciato'), 'e lo dice con parole comprensibili');
    tp = await db.query('SELECT tipo FROM progetti WHERE id=$1', [idProg]);
    dice(tp.rows[0].tipo === 'group', 'la tipologia è rimasta quella di prima');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(!r.testo.includes('id="sp-tipo"'), 'e la tendina sparisce dalla card');
    await db.query('DELETE FROM sedute WHERE id=$1', [sed.rows[0].id]);

    console.log('\n13. 🔒 Col contratto del Committente firmato si congela TUTTO');
    // ⛔ Fetta 0.5 (04/09): da «da inviare» non si salta ad «approvata» — sarebbe
    //    congelare un progetto con una chiamata sola. Un passo alla volta.
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'approvata' });
    dice(r.stato === 400, '🔬 da «da inviare» ad «approvata» in un colpo: 400', 'ha risposto ' + r.stato);
    dice((await statoDb()).stato === 'da_inviare', '  e lo stato è rimasto «da inviare»');
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'in_attesa' });
    dice(r.stato === 200, 'prima «l\'ho inviata»', r.stato + ' ' + r.testo.slice(0, 90));
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'approvata' });
    dice(r.stato === 200, 'poi «è tornata firmata»', r.stato + ' ' + r.testo.slice(0, 90));
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.stato === 200, 'la pagina si apre lo stesso', r.stato);
    dice(r.testo.includes('Specifiche congelate'), 'e dice a chiare lettere che è congelato');
    dice(!r.testo.includes('id="sp-previste"') && !r.testo.includes('id="sp-tipo"'),
      'i campi non ci sono più');
    // ⛔ IL PUNTO VERO: il lucchetto sta sulle ROTTE, non sui pulsanti. Chi arriva
    //    da un'altra strada deve trovare la porta chiusa lo stesso.
    for (const [m, url, corpo, et] of [
      ['POST', `/dashboard/progetti/${idProg}/tipo`, { tipo: 'team' }, 'la tipologia'],
      ['POST', `/dashboard/progetti/${idProg}/percorsi/${idPerc}/previste`, { n_sessioni_previste: 20 }, 'le sessioni previste'],
      ['POST', `/dashboard/progetti/${idProg}/quota`, { quota_totale: 9999 }, 'il valore del progetto'],
      ['POST', `/dashboard/progetti/${idProg}/coachee`, { clientId: idCli }, 'l\'aggiunta di un partecipante'],
      ['POST', `/dashboard/progetti/${idProg}`, { committente_id: idComm, titolo: marca, tipo: 'team', stato: 'attivo' }, 'la rotta generale del progetto'],
    ]) {
      r = await chiama(m, url, corpo);
      dice(r.stato === 409, `🔬 la ROTTA rifiuta ${et}`, 'ha risposto ' + r.stato);
    }
    const dopo = await db.query('SELECT tipo, quota_totale FROM progetti WHERE id=$1', [idProg]);
    dice(dopo.rows[0].tipo === 'group' && Number(dopo.rows[0].quota_totale || 0) !== 9999,
      'e dopo cinque tentativi il progetto è intatto');
    // I PARAMETRI si scrivono solo MODIFICANDO una fase esistente, non creandola:
    // per provare il lucchetto giusto bisogna passare da lì. (Alla prima stesura
    // chiamavo la creazione e la prova falliva accusando il codice a torto.)
    const fase = await db.query(
      `INSERT INTO fasi_progetto (id, progetto_id, tipo, fatta, stato, origine)
       VALUES (gen_random_uuid(), $1, 'intake-sponsor', TRUE, 'confermata', 'manuale') RETURNING id`, [idProg]);
    await db.query("UPDATE progetti SET parametri='quelli buoni' WHERE id=$1", [idProg]);
    r = await chiama('POST', `/dashboard/progetti/${idProg}/fasi`,
      { fid: fase.rows[0].id, tipo: 'intake-sponsor', parametri: 'quelli cambiati di nascosto' });
    dice(r.stato === 409, '🔬 la ROTTA rifiuta i parametri di successo', 'ha risposto ' + r.stato);
    const par = await db.query('SELECT parametri FROM progetti WHERE id=$1', [idProg]);
    dice(par.rows[0].parametri === 'quelli buoni', 'e i parametri veri sono intatti');
    await db.query('DELETE FROM fasi_progetto WHERE id=$1', [fase.rows[0].id]);
    // ✅ ma i FATTI si registrano ancora: una fase avvenuta non è una modifica
    r = await chiama('POST', `/dashboard/progetti/${idProg}/fasi`, { tipo: 'chiusura-sponsor' });
    dice(r.stato === 200, '✅ ma registrare una FASE avvenuta si può ancora', 'ha risposto ' + r.stato);

    console.log('\n14. ↩️ «Modifica contratto approvato» riapre tutto');
    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'da_inviare' });
    r = await chiama('POST', `/dashboard/progetti/${idProg}/percorsi/${idPerc}/previste`, { n_sessioni_previste: 20 });
    dice(r.stato === 200, 'le sessioni previste si cambiano di nuovo', 'ha risposto ' + r.stato);
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(!r.testo.includes('Specifiche congelate'), 'e il cartello del congelamento è sparito');

    // ── Fetta 6c — l'avviso prima del Kick-Off ──────────────────────────────
    console.log('\n15. L\'avviso del Kick-Off: grida, ma non sbarra');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(!r.testo.includes('Kick-Off in calendario'), 'senza Kick-Off in calendario non dice niente');

    const ko = await db.query(
      `INSERT INTO fasi_progetto (id, progetto_id, tipo, data, fatta, stato, origine)
       VALUES (gen_random_uuid(), $1, 'kick-off', CURRENT_DATE + 7, FALSE, 'confermata', 'manuale') RETURNING id`, [idProg]);
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('Kick-Off in calendario'), 'messo in calendario col contratto non firmato, avvisa');
    dice(r.testo.includes('non un blocco'), 'e dice esplicitamente che non impedisce niente');

    // ⛔ IL PUNTO: è un avviso, NON una porta chiusa. Le rotte devono passare.
    r = await chiama('POST', `/dashboard/progetti/${idProg}/percorsi/${idPerc}/previste`, { n_sessioni_previste: 9 });
    dice(r.stato === 200, '⛔ e infatti si continua a lavorare: nessuna rotta si chiude', 'ha risposto ' + r.stato);

    await db.query('UPDATE fasi_progetto SET fatta=TRUE WHERE id=$1', [ko.rows[0].id]);
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes('si è svolto senza contratto firmato'), 'se il Kick-Off è già AVVENUTO, l\'avviso diventa rosso');

    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'in_attesa' });
    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'approvata' });
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(!r.testo.includes('si è svolto senza contratto') && !r.testo.includes('Kick-Off in calendario'),
      'e col contratto firmato l\'avviso sparisce del tutto');
    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'da_inviare' });
    await db.query('DELETE FROM fasi_progetto WHERE id=$1', [ko.rows[0].id]);

    // ── Le sezioni pieghevoli della pagina progetto ─────────────────────────
    console.log('\n16. Le sezioni della pagina progetto si piegano');
    await db.query("UPDATE progetti SET drive_url='https://drive.example/x' WHERE id=$1", [idProg]);
    await db.query("UPDATE percorsi SET drive_url='https://drive.example/y' WHERE id=$1", [idPerc]);
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    const nSez = (r.testo.match(/<details class="sec"/g) || []).length;
    dice(nSez >= 6, `ci sono tutte le sezioni pieghevoli (trovate ${nSez})`);
    for (const t of ['Specifiche di Progetto', 'Contratti', 'Fasi del progetto', 'Percorsi', 'Amministrazione'])
      dice(new RegExp('<details class="sec"[^>]*>[\\s\\S]{0,700}' + t).test(r.testo), `  «${t}» è pieghevole`);
    // ⛔ LA TRAPPOLA NUMERO UNO: un pulsante dentro un <summary> che non ferma il
    //    clic chiude la sezione invece di fare il suo mestiere. Qui si controlla
    //    che OGNI pulsante dentro un summary lo fermi.
    const sommari = r.testo.match(/<summary[\s\S]*?<\/summary>/g) || [];
    const distratti = sommari.flatMap(x => (x.match(/onclick="(?!event\.stopPropagation)[^"]*"/g) || []));
    dice(distratti.length === 0,
      'ogni pulsante nelle intestazioni ferma il clic (altrimenti chiuderebbe la sezione)',
      distratti.join(' · '));
    // ⚠️ L'Amministrazione dev'essere una card come le altre. Convertendola avevo
    //    lasciato un <div id="amm"> intorno, e quel contenitore prendeva
    //    `padding:14px 18px` da una regola generale: la sezione risultava 36px più
    //    stretta delle altre e rientrata. Visto da Germano, misurato nel browser.
    dice(/<div class="card" id="amm">/.test(r.testo),
      'l\'Amministrazione è una card come le altre, senza contenitori in più');
    dice(!/<div id="amm">/.test(r.testo), 'e non c\'è nessun involucro rimasto in giro');

    // ── Le rate dentro il testo del contratto ───────────────────────────────
    // Testi puri: si chiamano direttamente, senza passare dal PDF (che avrebbe
    // bisogno della carta intestata su Drive, e qui le chiavi non ci sono).
    console.log('\n17. Il piano delle rate dentro il contratto');
    const T = require('../server/contratto-testi');
    const testo = (b) => b.filter(x => typeof x.x === 'string').map(x => x.x).join('\n');
    const rate3 = [{ etichetta: 'Acconto', importo: 600, innesco: 'firma', giorni: 30 },
                   { etichetta: 'Saldo',   importo: 900, innesco: 'fine',  giorni: 30 }];
    const cliente = { nome: 'M', cognome: 'R', name: 'M R' };
    const prog = { tipo: 'team', titolo: 'X', quota_totale: 2000, quota_committente: 1500, data_inizio: '2026-10-01' };

    const pac = testo(T.personaFisica({ cliente, percorso: { tipo: 'Individuale', modalita: 'Pacchetto', prezzo: 1500, n_sessioni_previste: 8 }, rate: rate3 }));
    dice(pac.includes('Acconto — € 600,00 + IVA 22% — fattura alla firma'), 'il PACCHETTO elenca le rate');
    dice(pac.includes('si salda entro 30 giorni'), '  e dice che si pagano a 30 giorni');
    dice(!/fattura a 30 giorni/.test(pac),
      '  ⚠️ e NON dice «fattura a 30 giorni»: sommato al pagamento farebbe 60');

    const std = testo(T.personaFisica({ cliente, percorso: { tipo: 'Individuale', modalita: 'Standard', prezzo: 150, n_sessioni_previste: 8 } }));
    dice(std.includes('cadenza mensile') && std.includes('rimessa diretta'),
      'lo STANDARD a sessione si fattura ogni mese, a rimessa diretta');
    dice(!std.includes('rate:'), '  e non ha rate: si paga man mano');

    for (const [et, b] of [
      ['COMMITTENTE', T.personaGiuridica({ committente: { denominazione: 'A' }, progetto: prog, nPartecipanti: 4, sessioni: { condivise: 8 }, rate: rate3 })],
      ['PARTECIPANTE', T.partecipanteProgetto({ cliente, progetto: prog, committente: { denominazione: 'A' }, quota: 500, nSessioni: 8, rate: rate3 })],
    ]) {
      const x = testo(b);
      dice(x.includes('Acconto — € 600,00') && x.includes('si salda entro 30 giorni'), `il contratto ${et} porta le rate`);
    }
    const senza = testo(T.personaGiuridica({ committente: { denominazione: 'A' }, progetto: prog, nPartecipanti: 4, sessioni: { condivise: 8 } }));
    dice(!senza.includes('nelle seguenti rate') && senza.includes('si salda entro 30 giorni'),
      '⛔ senza piano NON si inventa nessuna rata, e resta la regola generale');
    dice(!/15 giorni/.test(pac + std + senza), 'e da nessuna parte si parla più di 15 giorni');

    // ═══ FETTA 0.1 DEL RIORDINO (03/09/2026) — LE RATE DENTRO UN DOCUMENTO NON SI TOCCANO ═══
    // La ricognizione indipendente (B1): salvare il piano cancellava e riscriveva
    // TUTTE le rate, anche quella già dentro una proforma. Il documento restava
    // orfano e la rata si poteva chiedere due volte, in silenzio. Qui si fa il
    // giro vero coi pulsanti: piano → proforma su una rata → si prova a toglierla
    // o a cambiarla (rifiutato, rata intatta e ancora legata al documento) → si
    // cambiano le altre (accettato). Su tutte e TRE le rotte del piano.
    console.log('\n18. Le rate dentro un documento non si toccano più (fetta 0.1)');
    // Il cliente deve essere fatturabile: un privato con codice fiscale e indirizzo.
    // ⭐ 0.4 — da qui in avanti il cliente si chiama «D'Amico»: l'apostrofo nel nome
    // deve arrivare intero in ogni pulsante delle pagine che seguono (sezione 20).
    r = await chiama('POST', `/dashboard/clients/${idCli}`, { nome: 'Prova', cognome: "D'Amico " + marca, area: 'Business',
      codice_fiscale: 'RSSMRA80A01H501U', via: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM' });
    dice(r.stato === 200, 'il cliente ha i dati che servono a una proforma', r.stato + ' ' + r.testo.slice(0, 120));
    const idPart = (await db.query('SELECT id FROM partecipazioni WHERE progetto_id=$1 AND client_id=$2', [idProg, idCli])).rows[0].id;
    r = await chiama('POST', `/dashboard/progetti/${idProg}/quota`, { quota_totale: 10000, quota_committente: 7000 });
    dice(r.stato === 200, 'valore del progetto 10.000, committente 7.000', r.stato);
    r = await chiama('POST', `/dashboard/progetti/${idProg}/quote-coachee`, { quote: [{ part_id: idPart, quota: 3000 }] });
    dice(r.stato === 200, 'il partecipante paga 3.000', r.stato);

    const rateComm = (a, b, c) => [{ etichetta: 'Acconto', importo: a, innesco: 'firma', giorni: 30 },
                                   { etichetta: 'Metà percorso', importo: b, innesco: 'meta', giorni: 30 },
                                   { etichetta: 'Saldo', importo: c, innesco: 'fine', giorni: 30 }].filter(x => x.importo > 0);
    const salvaProgetto = (righeComm, righePart) => chiama('POST', `/dashboard/progetti/${idProg}/piano`, {
      piani: [{ partecipazione_id: null, righe: righeComm }, { partecipazione_id: idPart, righe: righePart }],
      data_meta: '2026-11-15', data_fine: '2026-12-20' });
    const rateDb = (dove, id) => db.query(`SELECT id, etichetta, importo::int AS importo, ordine FROM tranche_progetto WHERE ${dove}=$1 ORDER BY ordine`, [id]);

    r = await salvaProgetto(rateComm(2100, 2800, 2100), [{ etichetta: 'Quota', importo: 3000, innesco: 'firma', giorni: 30 }]);
    dice(r.stato === 200, 'il piano si salva: 3 rate al committente, 1 al partecipante', r.stato + ' ' + r.testo.slice(0, 160));
    let rataQuota = (await rateDb('partecipazione_id', idPart)).rows[0];
    dice(!!rataQuota && rataQuota.importo === 3000, 'la rata del partecipante è nel database');

    // La proforma nasce dal pulsante «Chiedi il pagamento» di quella rata.
    r = await chiama('POST', `/dashboard/tranche/${rataQuota.id}/proforma`);
    dice(r.stato === 200 && r.dati && r.dati.numero, 'la proforma della rata del partecipante nasce', r.stato + ' ' + r.testo.slice(0, 200));
    const numPf = r.dati && r.dati.numero;
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.stato === 200 && r.testo.includes('"stato":"da_mandare"'), 'e la pagina del progetto dice che la rata è «da mandare»: sta in un documento');

    // 🔴 IL DIFETTO: si risalva il piano del progetto SENZA la rata chiesta.
    r = await salvaProgetto(rateComm(2100, 2800, 2100), [{ etichetta: 'Quota', importo: 3000, innesco: 'firma', giorni: 30 }]);
    dice(r.stato === 400, '🔴 risalvare il piano del PROGETTO senza quella rata è rifiutato', 'ha risposto ' + r.stato + ' ' + r.testo.slice(0, 160));
    dice(r.dati && /Quota/.test(r.dati.error || '') && new RegExp(String(numPf).replace('/', '\\/')).test(r.dati.error || ''),
      '  e il messaggio nomina la rata e la proforma', r.dati && r.dati.error);
    let rateOra = (await rateDb('partecipazione_id', idPart)).rows;
    dice(rateOra.length === 1 && rateOra[0].id === rataQuota.id, '  la rata è ancora lì, con lo stesso id');
    let legamePf = await db.query('SELECT count(*)::int AS n FROM proforma_righe WHERE tranche_id=$1', [rataQuota.id]);
    dice(legamePf.rows[0].n === 1, '  e la proforma sa ancora a quale rata si riferisce');
    // Cambiarle l'importo è come toglierla.
    r = await salvaProgetto(rateComm(2100, 2800, 2100), [{ id: rataQuota.id, etichetta: 'Quota', importo: 2000, innesco: 'firma', giorni: 30 }, { etichetta: 'Resto', importo: 1000, innesco: 'fine', giorni: 30 }]);
    dice(r.stato === 400 && /modificare/.test((r.dati || {}).error || ''), '🔴 cambiare l’importo della rata chiesta è rifiutato', r.stato + ' ' + r.testo.slice(0, 160));
    // Il caso buono: la rata chiesta arriva identica, le rate del committente cambiano.
    r = await salvaProgetto(rateComm(3000, 4000, 0), [{ id: rataQuota.id, etichetta: 'Quota', importo: 3000, innesco: 'firma', giorni: 30 }]);
    dice(r.stato === 200, '✅ con la rata chiesta intatta, le ALTRE rate si cambiano', r.stato + ' ' + r.testo.slice(0, 160));
    rateOra = (await rateDb('partecipazione_id', idPart)).rows;
    dice(rateOra.length === 1 && rateOra[0].id === rataQuota.id, '  la rata chiesta ha ancora lo stesso id');
    const rateCommOra = (await db.query('SELECT importo::int AS importo FROM tranche_progetto WHERE progetto_id=$1 AND partecipazione_id IS NULL ORDER BY ordine', [idProg])).rows.map(x => x.importo);
    dice(JSON.stringify(rateCommOra) === '[3000,4000]', '  e il committente ha le due rate nuove', JSON.stringify(rateCommOra));
    r = await chiama('POST', `/dashboard/tranche/${rataQuota.id}/proforma`);
    dice(r.stato === 400, '  e la rata non si può chiedere una seconda volta', r.stato);

    // La rotta del PARTECIPANTE (dalla scheda del cliente): stessa regola.
    r = await chiama('POST', `/dashboard/partecipazioni/${idPart}/piano`, { righe: [{ etichetta: 'Quota', importo: 3000, innesco: 'firma', giorni: 30 }] });
    dice(r.stato === 400, '🔴 risalvare le rate del PARTECIPANTE senza quella chiesta è rifiutato', r.stato + ' ' + r.testo.slice(0, 160));
    r = await chiama('POST', `/dashboard/partecipazioni/${idPart}/piano`, { righe: [{ id: rataQuota.id, etichetta: 'Quota', importo: 3000, innesco: 'firma', giorni: 30 }] });
    dice(r.stato === 200, '✅ con la rata identica il salvataggio passa', r.stato + ' ' + r.testo.slice(0, 160));
    rateOra = (await rateDb('partecipazione_id', idPart)).rows;
    dice(rateOra.length === 1 && rateOra[0].id === rataQuota.id, '  e la rata ha ancora lo stesso id');

    // La rotta del PACCHETTO: un percorso a Pacchetto dello stesso cliente.
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi`, { tipo: 'Individuale', modalita: 'Pacchetto', prezzo: 1500, data_inizio: '2026-10-05', n_sessioni_previste: 8 });
    dice(r.stato === 200, 'nasce un percorso a Pacchetto', r.stato + ' ' + r.testo.slice(0, 120));
    const idPacc = (await db.query("SELECT id FROM percorsi WHERE client_id=$1 AND modalita='Pacchetto'", [idCli])).rows[0].id;
    const salvaPacc = (righe) => chiama('POST', `/dashboard/percorsi/${idPacc}/piano`, { prezzo: 1500, data_meta: '', data_fine: '2026-12-20', righe });
    r = await salvaPacc([{ etichetta: 'Acconto', importo: 600, innesco: 'firma', giorni: 30 }, { etichetta: 'Saldo', importo: 900, innesco: 'fine', giorni: 30 }]);
    dice(r.stato === 200, 'il piano del pacchetto si salva: 600 + 900', r.stato + ' ' + r.testo.slice(0, 160));
    const acconto = (await rateDb('percorso_id', idPacc)).rows[0];
    r = await chiama('POST', `/dashboard/tranche/${acconto.id}/proforma`);
    dice(r.stato === 200, 'la proforma dell’acconto nasce', r.stato + ' ' + r.testo.slice(0, 200));
    r = await salvaPacc([{ etichetta: 'Tutto', importo: 1500, innesco: 'fine', giorni: 30 }]);
    dice(r.stato === 400, '🔴 risalvare il piano del PACCHETTO senza l’acconto chiesto è rifiutato', r.stato + ' ' + r.testo.slice(0, 160));
    rateOra = (await rateDb('percorso_id', idPacc)).rows;
    dice(rateOra.length === 2 && rateOra[0].id === acconto.id, '  le due rate sono intatte');
    r = await salvaPacc([{ id: acconto.id, etichetta: 'Acconto', importo: 600, innesco: 'firma', giorni: 30 },
                         { etichetta: 'Metà', importo: 450, innesco: 'meta', giorni: 30 }, { etichetta: 'Saldo', importo: 450, innesco: 'fine', giorni: 30 }]);
    dice(r.stato === 200, '✅ l’acconto intatto e il saldo spezzato in due: passa', r.stato + ' ' + r.testo.slice(0, 160));
    rateOra = (await rateDb('percorso_id', idPacc)).rows;
    dice(rateOra.length === 3 && rateOra[0].id === acconto.id && rateOra[0].ordine === 0, '  tre rate, e l’acconto è sempre lui, al primo posto');

    // ═══ FETTA 0.3 DEL RIORDINO (03/09/2026) — SEDUTE COERENTI (B2) ═══
    // «Una sessione con data nel futuro è fissata, non fatta» valeva in UNA rotta
    // sola e non si ricalcolava mai. Qui si fa il giro coi pulsanti sulle rotte
    // collettive e individuali, si controlla che le ore ICF seguano, che una riga
    // nata da un report resti in bozza, che chiudere un percorso guardi di chi è,
    // e che la rotta senza login non esista più.
    console.log('\n19. Sedute coerenti: lo stato viene dalla data, in tutte le rotte (fetta 0.3)');
    const oreDi = async (pid) => { const x = await db.query('SELECT ore_fatte::float AS ore, n_sessioni_fatte::int AS n FROM percorsi WHERE id=$1', [pid]); return x.rows[0]; };
    const statoSed = async (sid) => (await db.query('SELECT stato FROM sedute WHERE id=$1', [sid])).rows[0].stato;
    const ieri = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const fraUnMese = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const collSedute = `/dashboard/progetti/${idProg}/percorsi/${idPerc}/sedute`;

    // Collettiva: nasce nel futuro → bozza, e le ore NON salgono.
    const prima = await oreDi(idPerc);
    r = await chiama('POST', collSedute, { tipo: 'Ongoing', data: fraUnMese, ore: 1 });
    const sidColl = r.dati && r.dati.id;
    dice(r.stato === 200 && !!sidColl, 'una sessione COLLETTIVA fissata fra un mese si registra', r.stato + ' ' + r.testo.slice(0, 120));
    dice(await statoSed(sidColl) === 'bozza', '🔴 e nasce in BOZZA: è fissata, non fatta', 'stato ' + await statoSed(sidColl));
    let ora = await oreDi(idPerc);
    dice(ora.ore === prima.ore && ora.n === prima.n, '  e le ore ICF del percorso non sono salite', `${prima.ore}h/${prima.n} → ${ora.ore}h/${ora.n}`);
    // La sposto a ieri → è avvenuta → confermata, ore salite.
    r = await chiama('POST', `${collSedute}/${sidColl}`, { tipo: 'Ongoing', data: ieri, ore: 1 });
    dice(r.stato === 200 && await statoSed(sidColl) === 'confermata', '🔴 spostata a ieri diventa FATTA', 'stato ' + await statoSed(sidColl));
    ora = await oreDi(idPerc);
    dice(ora.ore === prima.ore + 1 && ora.n === prima.n + 1, '  e adesso conta: un’ora e una sessione in più', `${ora.ore}h/${ora.n}`);
    // La rimando avanti → torna bozza, le ore tornano giù.
    r = await chiama('POST', `${collSedute}/${sidColl}`, { tipo: 'Ongoing', data: fraUnMese, ore: 1 });
    dice(r.stato === 200 && await statoSed(sidColl) === 'bozza', 'rimandata avanti torna in bozza', 'stato ' + await statoSed(sidColl));
    ora = await oreDi(idPerc);
    dice(ora.ore === prima.ore && ora.n === prima.n, '  e le ore tornano quelle di prima', `${ora.ore}h/${ora.n}`);

    // Una riga nata da un REPORT (source_file_id) sta in bozza perché aspetta
    // l'approvazione: correggerle la data non deve approvarla al posto del coach.
    // (L'automazione legge Drive, che qui non c'è: la riga si scrive come la
    // scriverebbe lei, con file di origine, stato bozza e origine auto.)
    const auto = await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, stato, origine, source_file_id)
       VALUES (gen_random_uuid(), $1, NULL, 'Ongoing', $2::date, 1, 'bozza', 'auto', $3) RETURNING id`,
      [idPerc, ieri, 'PROVA-FILE-' + PORTA]);
    const sidAuto = auto.rows[0].id;
    r = await chiama('POST', `${collSedute}/${sidAuto}`, { tipo: 'Ongoing', data: ieri, ore: 1.5 });
    dice(r.stato === 200 && await statoSed(sidAuto) === 'bozza', '⛔ una riga con un report dietro, corretta, RESTA in bozza: la approva il coach', 'stato ' + await statoSed(sidAuto));
    ora = await oreDi(idPerc);
    dice(ora.ore === prima.ore && ora.n === prima.n, '  e non ha contato niente', `${ora.ore}h/${ora.n}`);

    // Individuale: la stessa regola, sul percorso a Pacchetto del cliente.
    const indSedute = `/dashboard/clients/${idCli}/percorsi/${idPacc}/sedute`;
    const primaInd = await oreDi(idPacc);
    r = await chiama('POST', indSedute, { tipo: 'Ongoing', data: fraUnMese, ore: 1 });
    const sidInd = r.dati && r.dati.id;
    dice(r.stato === 200 && await statoSed(sidInd) === 'bozza', 'una sessione INDIVIDUALE futura nasce in bozza (già così)', 'stato ' + (sidInd && await statoSed(sidInd)));
    r = await chiama('POST', `${indSedute}/${sidInd}`, { tipo: 'Ongoing', data: ieri, ore: 1 });
    dice(r.stato === 200 && await statoSed(sidInd) === 'confermata', '🔴 spostata a ieri diventa fatta anche lei', 'stato ' + await statoSed(sidInd));
    ora = await oreDi(idPacc);
    dice(ora.n === primaInd.n + 1, '  e il percorso conta una sessione in più', `${primaInd.n} → ${ora.n}`);

    // Chiudere un percorso guarda DI CHI è.
    r = await chiama('POST', `/dashboard/clients/00000000-0000-0000-0000-000000000000/percorsi/${idPacc}/chiudi`, { data_fine: ieri });
    let st = (await db.query('SELECT stato FROM percorsi WHERE id=$1', [idPacc])).rows[0].stato;
    dice(st === 'attivo', '🔴 chiudere il percorso dalla scheda di un ALTRO cliente non chiude niente', 'stato ' + st + ' (risposta ' + r.stato + ')');
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi/${idPacc}/chiudi`, { data_fine: ieri });
    st = (await db.query('SELECT stato FROM percorsi WHERE id=$1', [idPacc])).rows[0].stato;
    dice(r.stato === 200 && st === 'concluso', '  dalla scheda giusta si chiude', 'stato ' + st);

    // La rotta senza login non esiste più.
    r = await chiama('POST', '/api/sedute', { secret: 'x', percorso_id: idPacc, client_id: idCli, tipo: 'Ongoing' });
    dice(r.stato === 404, '⛔ la rotta senza login /api/sedute non esiste più', 'ha risposto ' + r.stato);

    // ═══ FETTA 0.4 DEL RIORDINO (03/09/2026) — I QUATTRO DIFETTI D'INTERFACCIA ═══
    console.log("\n20. Un apostrofo nel nome non spegne i pulsanti, e gli altri tre difetti d'interfaccia");
    // Ogni onclick delle pagine vere, decodificato come fa il browser (le entità
    // HTML si sciolgono PRIMA che il JavaScript venga letto), deve essere codice
    // valido. Il cliente si chiama «D'Amico» dalla sezione 18; qui nasce anche un
    // lead con l'apostrofo, perché i suoi pulsanti passano da un'altra pagina.
    const decodifica = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    // Si guardano gli onclick del MARKUP, non il codice dentro <script> (lì ci sono
    // le stringhe che costruiscono i pulsanti nel browser: quelle le prova
    // prova-js-pagine.js con un documento finto).
    const pulsantiRotti = (html) => [...html.replace(/<script>[\s\S]*?<\/script>/g, '').matchAll(/onclick="([^"]*)"/g)].map(m => decodifica(m[1]))
      .filter(c => { try { new Function(c); return false; } catch (e) { return true; } });
    r = await chiama('POST', '/dashboard/leads', { nome: "Sant'Elia", cognome: "D'Amico " + marca, email: 'x@example.it', fonte: 'altro', stato: 'nuovo', note: "un'annotazione" });
    idLead = r.dati && r.dati.id;
    dice(r.stato === 200 && !!idLead, "nasce un lead che si chiama Sant'Elia D'Amico", r.stato + ' ' + r.testo.slice(0, 120));
    for (const [nome, url, deve] of [
      ['la scheda del cliente', `/dashboard/clients/${idCli}`, "D'Amico"],
      ['la pagina del progetto', `/dashboard/progetti/${idProg}`, "D'Amico"],
      ['i lead', '/dashboard/leads', "Sant'Elia"],
      ['le proforma', '/dashboard/amministrazione/proforma', "D'Amico"],
      ['la home', '/dashboard', null],
    ]) {
      r = await chiama('GET', url);
      const rotti = r.stato === 200 ? pulsantiRotti(r.testo) : ['pagina non risponde 200'];
      const contiene = !deve || decodifica(r.testo).includes(deve);
      dice(r.stato === 200 && contiene && rotti.length === 0, `🔴 ${nome}: tutti i pulsanti reggono l'apostrofo`,
        r.stato !== 200 ? 'risposta ' + r.stato : !contiene ? 'la pagina non mostra il nome con l’apostrofo' : rotti.length + ' rotti, es. ' + (rotti[0] || '').slice(0, 90));
    }

    // La data del consenso è un dato legale: togliere la spunta non la cancella.
    const anagrafica = { nome: 'Prova', cognome: "D'Amico " + marca, area: 'Business', codice_fiscale: 'RSSMRA80A01H501U', via: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM' };
    r = await chiama('POST', `/dashboard/clients/${idCli}`, { ...anagrafica, consenso_privacy: true });
    let cons = (await db.query('SELECT consenso_privacy, consenso_data FROM clients WHERE id=$1', [idCli])).rows[0];
    dice(r.stato === 200 && cons.consenso_privacy === true && !!cons.consenso_data, 'spuntato il consenso, la data si scrive', JSON.stringify(cons));
    const dataConsenso = String(cons.consenso_data);
    r = await chiama('POST', `/dashboard/clients/${idCli}`, { ...anagrafica, consenso_privacy: false });
    cons = (await db.query('SELECT consenso_privacy, consenso_data FROM clients WHERE id=$1', [idCli])).rows[0];
    dice(r.stato === 200 && cons.consenso_privacy === false, 'tolta la spunta, il consenso risulta revocato');
    dice(String(cons.consenso_data) === dataConsenso, '🔴 ma la data in cui era stato dato NON sparisce: è un dato legale', 'ora è ' + cons.consenso_data);
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(r.stato === 200 && !/Consenso privacy<\/div><div class="field-value">Sì/.test(r.testo), '  e la scheda non lo mostra come «Sì»');

    // Scrivere su Drive non si fa con un link: la prova di scrittura è un POST.
    r = await chiama('GET', '/dashboard/diag/drive/test-create');
    dice(r.stato === 404, '🔴 aprire un LINK non crea più cartelle su Drive (GET → 404)', 'ha risposto ' + r.stato);
    r = await chiama('POST', '/dashboard/diag/drive/test-create');
    dice(r.stato === 200 && /Variabili mancanti|Cartella di prova/.test(r.testo), '  la stessa prova si fa con un pulsante (POST), e qui senza chiavi Google lo dice', r.stato + ' ' + r.testo.slice(0, 80));

    // ══ Fetta 1.2 (04/09/2026) — LA PROVA DEI SOLDI ═══════════════════════════
    // La catena intera della proforma coi pulsanti veri: nasce → PDF → si manda
    // (posta finta) → si incassa a pezzi → si scrive il numero di fattura; e la
    // seconda: nasce → si annulla → le sessioni tornano da chiedere → rinasce con
    // un numero NUOVO (quello bruciato non si riusa). Metà dei controlli sono
    // rifiuti: incassare prima di mandare, incassare più del dovuto, mandare o
    // incassare un documento annullato.
    // 🔴 IL NUMERO: fino al 04/09 lo componeva l'SQL con lpad(n, 3, '0'), che
    //    oltre 999 TRONCA (Postgres: lpad('1000',3,'0') = '100'). Per vederlo qui
    //    si porta il contatore dell'anno a 999 con una riga finta — l'unica cosa
    //    di questa sezione che non si fa con un pulsante, perché nessun pulsante
    //    fa 999 proforme — e poi si crea la millesima col pulsante.
    console.log('\n20b. 💶 La prova dei soldi: proforma dalla nascita alla fattura (fetta 1.2)');
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi`,
      { tipo: 'Individuale', modalita: 'Standard', prezzo: 100, data_inizio: '2026-08-01', n_sessioni_previste: 8 });
    const idStd = r.dati && r.dati.id;
    dice(r.stato === 200 && !!idStd, 'un percorso Standard a 100 € a sessione', r.stato + ' ' + r.testo.slice(0, 100));
    const giorniFa = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi/${idStd}/sedute`, { tipo: 'Intake', data: giorniFa(10), ore: 2 });
    dice(r.stato === 200, 'un Intake di dieci giorni fa (vale due sessioni)', r.stato);
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi/${idStd}/sedute`, { tipo: 'Ongoing', data: giorniFa(3), ore: 1 });
    dice(r.stato === 200, 'e un Ongoing di tre giorni fa', r.stato);
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.stato === 200, 'la pagina Proforma risponde 200', r.stato + ' ' + r.testo.slice(0, 100));
    dice(r.testo.includes("D&#39;Amico " + marca) || r.testo.includes("D'Amico " + marca), '  e il cliente compare fra quelli con qualcosa da chiedere');

    const anno = new Date().toISOString().slice(0, 4);
    await db.query(`INSERT INTO proforme (id, numero, anno, progressivo, client_id, data_emissione, stato)
                    VALUES ($1, $2, $3::int, 999, $4, CURRENT_DATE, 'annullata') ON CONFLICT DO NOTHING`,
      [uuidv4(), anno + '/999', anno, idCli]);
    const prossimo = async () => Number((await db.query('SELECT COALESCE(MAX(progressivo),0)+1 AS n FROM proforme WHERE anno=$1::int', [anno])).rows[0].n);
    let nAtteso = await prossimo();
    r = await chiama('POST', `/dashboard/clients/${idCli}/proforma`);
    const pf1 = r.dati || {};
    dice(r.stato === 200 && !!pf1.id, 'la proforma delle sessioni nasce dal pulsante', r.stato + ' ' + r.testo.slice(0, 160));
    dice(pf1.numero === anno + '/' + String(nAtteso).padStart(3, '0'),
      `🔴 e il numero è ${anno}/${nAtteso}, non troncato (oltre 999 lpad tagliava)`, 'numero: ' + pf1.numero);
    let d1 = (await db.query('SELECT * FROM proforme WHERE id=$1', [pf1.id])).rows[0];
    dice(d1 && d1.progressivo === nAtteso && d1.numero === pf1.numero, '  e nel database numero e progressivo combaciano');
    const righe1 = await db.query('SELECT quantita, importo::numeric AS importo FROM proforma_righe WHERE proforma_id=$1 ORDER BY ordine', [pf1.id]);
    dice(righe1.rows.length === 2 && Number(righe1.rows[0].quantita) === 2, '  due righe, e l\'Intake conta quantità 2');
    dice(Number(d1.imponibile) === 300, '  imponibile 300 € (100 × 2 + 100)', 'imponibile ' + d1.imponibile);
    r = await chiama('GET', `/dashboard/proforma/${pf1.id}/pdf`);
    dice(r.stato === 200 && r.testo.startsWith('%PDF'), 'il PDF si rigenera dai dati congelati', r.stato + ' ' + r.testo.slice(0, 20));
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.stato === 200 && r.testo.includes(pf1.numero) && r.testo.includes('Da rileggere e mandare'), 'la pagina la mette fra quelle «da rileggere e mandare»',
      r.stato + ' numero:' + r.testo.includes(pf1.numero));
    r = await chiama('POST', `/dashboard/clients/${idCli}/proforma`);
    dice(r.stato === 400, '🔬 chiederle di nuovo è rifiutato: le sessioni sono già in un documento vivo', 'ha risposto ' + r.stato);

    // mandare
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, { importo: 100, data_incasso: giorniFa(1) });
    dice(r.stato === 400 && /prima si manda/.test(r.testo), '🔬 incassare PRIMA di mandare è rifiutato', r.stato + ' ' + r.testo.slice(0, 100));
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/invia`, {});
    dice(r.stato === 400, '🔬 mandare senza destinatario è rifiutato', 'ha risposto ' + r.stato);
    const primaPosta = postaFinta.length;
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/invia`, { to: 'prova@example.invalid' });
    dice(r.stato === 200 && r.dati && r.dati.ok, 'si manda (con la posta finta)', r.stato + ' ' + r.testo.slice(0, 160));
    const ultima = postaFinta[postaFinta.length - 1] || {};
    dice(postaFinta.length === primaPosta + 1 && ultima.to === 'prova@example.invalid'
         && (ultima.attachments || []).some(a => a.filename.includes(pf1.numero.replace('/', '-'))),
      '  la mail finta ha il PDF in allegato, col numero nel nome', JSON.stringify((ultima.attachments || []).map(a => a.filename)));
    dice(r.dati && r.dati.driveErrore, '  e la risposta DICE che la copia su Drive non è riuscita (qui non ci sono le chiavi)');
    d1 = (await db.query('SELECT * FROM proforme WHERE id=$1', [pf1.id])).rows[0];
    dice(d1.stato === 'inviata' && !!d1.inviata_data && d1.inviata_a === 'prova@example.invalid', '  nel database è «inviata», con quando e a chi');
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.testo.includes('Mandate, in attesa di incasso') && r.testo.includes(pf1.numero), '  e la pagina la mette fra le «mandate, in attesa di incasso»');

    // incassare
    const dovuto = Number(d1.da_pagare);
    const meta = Math.round(dovuto * 50) / 100;
    for (const [corpo, et] of [
      [{ importo: dovuto + 0.01, data_incasso: giorniFa(1) }, 'più del dovuto'],
      [{ importo: 0, data_incasso: giorniFa(1) }, 'zero'],
      [{ importo: 10 }, 'senza il giorno'],
    ]) { r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, corpo); dice(r.stato === 400, `🔬 incassare ${et} è rifiutato`, 'ha risposto ' + r.stato); }
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, { importo: meta, data_incasso: giorniFa(2) });
    dice(r.stato === 200 && r.dati.saldata === false, `metà (${meta} €) entra, e il documento NON è saldato`, r.stato + ' ' + r.testo.slice(0, 120));
    const idInc1 = (await db.query('SELECT id FROM incassi WHERE proforma_id=$1', [pf1.id])).rows[0].id;
    r = await chiama('POST', `/dashboard/incassi/${idInc1}/togli`);
    dice(r.stato === 200, 'un incasso sbagliato si toglie', r.stato);
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, { importo: meta, data_incasso: giorniFa(2) });
    dice(r.stato === 200 && r.dati.saldata === false, '  e si rimette', r.stato);
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, { importo: Math.round((dovuto - meta) * 100) / 100, data_incasso: giorniFa(1) });
    dice(r.stato === 200 && r.dati.saldata === true && Number(r.dati.residuo) === 0, 'col resto è SALDATA, residuo zero', r.stato + ' ' + r.testo.slice(0, 120));
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/incasso`, { importo: 1, data_incasso: giorniFa(1) });
    dice(r.stato === 400 && /già saldato/.test(r.testo), '🔬 un soldo in più su un documento saldato è rifiutato', r.stato + ' ' + r.testo.slice(0, 100));
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.testo.includes('Incassate, da fatturare') && r.testo.includes(pf1.numero), 'la pagina la mette fra le «incassate, da fatturare»');

    // fatturare
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/fattura`, { numero: 'FT-PROVA-1' });
    d1 = (await db.query('SELECT fattura_numero, fattura_data FROM proforme WHERE id=$1', [pf1.id])).rows[0];
    dice(r.stato === 200 && d1.fattura_numero === 'FT-PROVA-1' && !!d1.fattura_data, 'il numero della fattura (fatta in SuperBill) si scrive, con la data di oggi');
    r = await chiama('POST', `/dashboard/proforma/${pf1.id}/fattura`, { numero: '' });
    d1 = (await db.query('SELECT fattura_numero, fattura_data FROM proforme WHERE id=$1', [pf1.id])).rows[0];
    dice(r.stato === 200 && d1.fattura_numero === null && d1.fattura_data === null, '  e si può cancellare: torna «da fatturare», senza data fantasma');

    // la seconda: nasce, si annulla, le sessioni tornano da chiedere, rinasce con un numero nuovo
    r = await chiama('POST', `/dashboard/clients/${idCli}/percorsi/${idStd}/sedute`, { tipo: 'Ongoing', data: giorniFa(1), ore: 1 });
    dice(r.stato === 200, 'una nuova sessione di ieri', r.stato);
    nAtteso = await prossimo();
    r = await chiama('POST', `/dashboard/clients/${idCli}/proforma`);
    const pf2 = r.dati || {};
    dice(r.stato === 200 && pf2.numero === anno + '/' + String(nAtteso).padStart(3, '0'), `la seconda proforma nasce col numero successivo (${pf2.numero})`, r.stato + ' ' + r.testo.slice(0, 120));
    dice((await db.query('SELECT count(*)::int AS n FROM proforma_righe WHERE proforma_id=$1', [pf2.id])).rows[0].n === 1, '  con dentro SOLO la sessione nuova: le altre due sono già chieste');
    r = await chiama('POST', `/dashboard/proforma/${pf2.id}/annulla`);
    dice(r.stato === 200, 'si annulla', r.stato);
    r = await chiama('POST', `/dashboard/proforma/${pf2.id}/annulla`);
    dice(r.stato === 404, '🔬 annullarla due volte: 404', 'ha risposto ' + r.stato);
    r = await chiama('POST', `/dashboard/proforma/${pf2.id}/invia`, { to: 'prova@example.invalid' });
    dice(r.stato === 400, '🔬 mandare un documento annullato è rifiutato', 'ha risposto ' + r.stato);
    r = await chiama('POST', `/dashboard/proforma/${pf2.id}/incasso`, { importo: 10, data_incasso: giorniFa(1) });
    dice(r.stato === 400, '🔬 incassarci sopra è rifiutato', 'ha risposto ' + r.stato);
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.testo.includes('Annullata, mai mandata') && r.testo.includes(pf2.numero), 'la pagina la mostra «annullata, mai mandata», col suo numero');
    nAtteso = await prossimo();
    r = await chiama('POST', `/dashboard/clients/${idCli}/proforma`);
    const pf3 = r.dati || {};
    dice(r.stato === 200 && pf3.numero === anno + '/' + String(nAtteso).padStart(3, '0') && pf3.numero !== pf2.numero,
      `🔴 la sessione torna da chiedere, e il nuovo documento ha un numero NUOVO (${pf3.numero}): quello bruciato non si riusa`, r.stato + ' ' + r.testo.slice(0, 120));
    dice((await db.query('SELECT count(*)::int AS n FROM proforma_righe WHERE proforma_id=$1', [pf3.id])).rows[0].n === 1, '  con dentro quella sessione sola');
    // ⚠️ Segnato, non toccato: annullare una proforma CON incassi sopra oggi è
    //    permesso (la rotta guarda solo «non già annullata»). È la fetta 0.2
    //    (cancellazioni guardate), rimandata a ottobre per decisione di Germano.

    // ══ Fetta 1.4 (04/09/2026) — I DATI DI COLLAUDO NON ENTRANO NEI NUMERI ═════
    // Decisioni di Germano («1a, 2a, 3a»): i record di collaudo escono dai numeri
    // e dai totali ma restano nelle liste di lavoro col cartellino; un record mai
    // classificato conta come vero e la home lo dice; si classifica dall'Hub.
    // Il cliente, il committente e il progetto di questa prova sono nati oggi dai
    // pulsanti, quindi NON classificati: devono contare come veri, e la home deve
    // dirlo. Poi si segnano di collaudo e devono sparire dai numeri, dall'Estratto
    // ICF (che non può contenere ore di persone inventate) ma non dalle liste.
    console.log('\n20c. ⚗️ I dati di collaudo non entrano nei numeri (fetta 1.4)');
    const porte = (html) => [...html.matchAll(/hm-porta-num">(\d+)</g)].map(m => Number(m[1]));
    let home = await chiama('GET', '/dashboard');
    let [nInd, nProg] = porte(home.testo);
    dice(home.stato === 200 && nInd > 0 && nProg > 0, 'la home conta i clienti e i progetti', home.stato + ' ' + JSON.stringify(porte(home.testo)));
    dice(/record non ancora classificat/.test(home.testo), '  e dice che ci sono record non ancora classificati (i tre di questa prova)');
    r = await chiama('GET', '/dashboard/icf');
    dice(r.stato === 200 && r.testo.includes('D&#39;Amico ' + marca), 'l\'Estratto ICF contiene il cliente (ha ore fatte sul percorso Standard)', r.stato);
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(r.testo.includes('non classificato') && r.testo.includes(`segnaCollaudo('cliente','${idCli}',true)`), 'la scheda del cliente ha l\'interruttore, e lo dice «non classificato»');

    // si segnano tutti e tre di collaudo, dall'Hub
    for (const [tipo, id] of [['cliente', idCli], ['committente', idComm], ['progetto', idProg]]) {
      r = await chiama('POST', '/dashboard/collaudo', { tipo, id, di_collaudo: true });
      dice(r.stato === 200, `il ${tipo} si segna di collaudo`, r.stato + ' ' + r.testo.slice(0, 100));
    }
    const dc = await db.query('SELECT (SELECT di_collaudo FROM clients WHERE id=$1) c, (SELECT di_collaudo FROM committenti WHERE id=$2) k, (SELECT di_collaudo FROM progetti WHERE id=$3) p', [idCli, idComm, idProg]);
    dice(dc.rows[0].c === true && dc.rows[0].k === true && dc.rows[0].p === true, '  e nel database sono TRUE tutti e tre');
    home = await chiama('GET', '/dashboard');
    const [nInd2, nProg2] = porte(home.testo);
    dice(nInd2 === nInd - 1 && nProg2 === nProg - 1, `🔴 la home ora conta uno in meno: clienti ${nInd}→${nInd2}, progetti ${nProg}→${nProg2}`, JSON.stringify(porte(home.testo)));
    dice(/record di collaudo/.test(home.testo) && /non entra/.test(home.testo), '  e il cartello dice che ci sono record di collaudo fuori dai numeri');
    r = await chiama('GET', '/dashboard/icf');
    dice(r.stato === 200 && !r.testo.includes('D&#39;Amico ' + marca), '🔴 l\'Estratto ICF non lo contiene più', r.stato);
    r = await chiama('GET', '/dashboard/icf/export.csv');
    dice(r.stato === 200 && !r.testo.includes(marca), '  e nemmeno il CSV');
    r = await chiama('GET', '/dashboard/individuali?tutti=1');
    dice(r.testo.includes('D&#39;Amico ' + marca) && r.testo.includes('⚗️ di collaudo'), 'nell\'elenco clienti resta, col cartellino');
    r = await chiama('GET', '/dashboard/committenti');
    dice(r.testo.includes(marca) && r.testo.includes('⚗️ di collaudo') && r.testo.includes(`segnaCollaudo('committente','${idComm}',false)`), 'nell\'elenco committenti resta, col cartellino e l\'interruttore per tornare vero');
    r = await chiama('GET', '/dashboard/progetti');
    dice(r.testo.includes(marca) && r.testo.includes('⚗️ di collaudo'), 'nell\'elenco progetti resta, col cartellino');
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(r.testo.includes(`segnaCollaudo('progetto','${idProg}',false)`), 'la pagina del progetto ha l\'interruttore per tornare vero');
    r = await chiama('GET', '/dashboard/amministrazione/proforma');
    dice(r.testo.includes('⚗️ di collaudo'), 'la pagina Proforma mostra il cartellino sui documenti del cliente di collaudo');
    r = await chiama('GET', '/dashboard/amministrazione');
    dice(r.stato === 200, 'le anomalie rispondono 200', r.stato);

    // torna vero: i numeri risalgono
    r = await chiama('POST', '/dashboard/collaudo', { tipo: 'cliente', id: idCli, di_collaudo: false });
    dice(r.stato === 200, 'il cliente torna vero', r.stato);
    home = await chiama('GET', '/dashboard');
    dice(porte(home.testo)[0] === nInd, `  e la home lo riconta (${nInd})`, JSON.stringify(porte(home.testo)));
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(!r.testo.includes('non classificato') && r.testo.includes('segna come di collaudo'), '  e la scheda propone «segna come di collaudo»');
    r = await chiama('POST', '/dashboard/collaudo', { tipo: 'cliente', id: idCli, di_collaudo: true });

    // 🔬 rifiuti
    r = await chiama('POST', '/dashboard/collaudo', { tipo: 'lead', id: idCli, di_collaudo: true });
    dice(r.stato === 400, '🔬 un tipo che non ha la colonna: 400', 'ha risposto ' + r.stato);
    r = await chiama('POST', '/dashboard/collaudo', { tipo: 'cliente', id: idCli, di_collaudo: 'forse' });
    dice(r.stato === 400, '🔬 un valore che non è vero/falso: 400', 'ha risposto ' + r.stato);
    r = await chiama('POST', '/dashboard/collaudo', { tipo: 'cliente', id: '00000000-0000-0000-0000-000000000000', di_collaudo: true });
    dice(r.stato === 404, '🔬 un record che non esiste: 404', 'ha risposto ' + r.stato);

    console.log('\n21. 🔬 Adesso la rompo apposta');
    for (const [corpo, et] of [
      [{ tipo: 'boh',         soggetto_id: idProg, stato: 'da_inviare' }, 'un tipo inventato'],
      [{ tipo: 'committente', soggetto_id: idProg, stato: 'firmata'    }, 'uno stato che non esiste più'],
      [{ tipo: 'committente', soggetto_id: '',     stato: 'da_inviare' }, 'un soggetto vuoto'],
    ]) {
      r = await chiama('POST', '/dashboard/contratti/stato', corpo);
      dice(r.stato === 400, `rifiuta ${et}`, 'ha risposto ' + r.stato);
    }
    r = await chiama('POST', '/dashboard/contratti/stato',
      { tipo: 'committente', soggetto_id: '00000000-0000-0000-0000-000000000000', stato: 'approvata' });
    dice(r.stato === 404, 'rifiuta un progetto che non esiste', 'ha risposto ' + r.stato);
    const orfani = await db.query("SELECT count(*)::int AS n FROM contratti WHERE progetto_id='00000000-0000-0000-0000-000000000000'");
    dice(orfani.rows[0].n === 0, 'e non ha lasciato righe orfane nel database');
    d6 = await statoDb();
    dice(d6.stato === 'da_inviare', 'dopo i quattro rifiuti lo stato buono è intatto');

    // ── Fetta 0.5 (04/09) — i passaggi di stato li verifica il SERVER ──────────
    // Prima la rotta controllava che lo stato esistesse, non che il passo fosse
    // ammesso: si poteva congelare un progetto in una chiamata, e scrivere in
    // tabella «da_redigere», che per definizione è l'assenza della riga.
    console.log('\n21b. 🔬 I salti di stato del contratto sono rifiutati (fetta 0.5)');
    for (const [st, et] of [['approvata', 'da «da inviare» ad «approvata» (congelerebbe il progetto)'],
                            ['da_redigere', '«da redigere» in scrittura: è l\'assenza della riga'],
                            ['da_inviare', 'restare fermi su «da inviare»']]) {
      r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: st });
      dice(r.stato === 400, `rifiuta ${et}`, 'ha risposto ' + r.stato + ' ' + r.testo.slice(0, 80));
    }
    d6 = await statoDb();
    dice(d6.stato === 'da_inviare', '  e lo stato è intatto: «da inviare»');
    dice((await db.query("SELECT count(*)::int AS n FROM contratti WHERE tipo='committente' AND progetto_id=$1", [idProg])).rows[0].n === 1,
      '  e la riga è sempre una');
    // un contratto che NON ha ancora la riga (il partecipante): il salto non deve nemmeno crearla
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'partecipante', soggetto_id: idPart, stato: 'approvata' });
    dice(r.stato === 400, 'sul contratto del partecipante, ancora «da redigere», rifiuta il salto ad «approvata»', 'ha risposto ' + r.stato);
    dice((await db.query("SELECT count(*)::int AS n FROM contratti WHERE tipo='partecipante' AND partecipazione_id=$1", [idPart])).rows[0].n === 0,
      '  e non ha creato la riga');
    // ⚠️ e «Modifica contratto approvato» resta possibile: sul contratto del cliente
    const stCli = async () => (await db.query("SELECT stato, data_invio, data_approvazione FROM contratti WHERE tipo='cliente' AND percorso_id=$1", [idPercInd])).rows[0];
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'approvata' });
    dice(r.stato === 200 && (await stCli()).stato === 'approvata', 'il contratto del cliente, «in attesa», torna firmato: approvata');
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'in_attesa' });
    dice(r.stato === 400 && (await stCli()).stato === 'approvata', '🔬 da «approvata» non si torna a «in attesa»: 400, stato intatto', 'ha risposto ' + r.stato);
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'da_inviare' });
    const sc = await stCli();
    dice(r.stato === 200 && sc.stato === 'da_inviare' && !sc.data_invio && !sc.data_approvazione,
      '✅ ma «Modifica contratto approvato» (→ da inviare) resta possibile, e azzera le due date', r.stato + ' ' + JSON.stringify(sc));
  } catch (e) {
    ko++; console.log('\n🔴 ECCEZIONE: ' + e.message + '\n' + e.stack.split('\n')[1]);
  } finally {
    console.log('\n22. Pulizia (solo le righe create da questa prova)');
    try {
      if (idLead) await db.query('DELETE FROM leads WHERE id=$1', [idLead]);
      // Le proforme nate nella sezione 18 (i numeri bruciati nel database di PROVA
      // restano bruciati: qui non è un problema). Prima le righe, poi i documenti,
      // e prima del cliente: cancellandolo il legame andrebbe solo a NULL.
      if (idCli) { await db.query('DELETE FROM proforma_righe WHERE proforma_id IN (SELECT id FROM proforme WHERE client_id=$1)', [idCli]);
                   await db.query('DELETE FROM incassi WHERE proforma_id IN (SELECT id FROM proforme WHERE client_id=$1)', [idCli]);
                   await db.query('DELETE FROM proforme WHERE client_id=$1', [idCli]); }
      if (idProg) { await db.query('DELETE FROM contratti WHERE progetto_id=$1 OR partecipazione_id IN (SELECT id FROM partecipazioni WHERE progetto_id=$1)', [idProg]);
                    await db.query('DELETE FROM percorso_partecipanti WHERE percorso_id IN (SELECT id FROM percorsi WHERE progetto_id=$1)', [idProg]);
                    await db.query('DELETE FROM partecipazioni WHERE progetto_id=$1', [idProg]);
                    await db.query('DELETE FROM percorsi WHERE progetto_id=$1', [idProg]);
                    await db.query('DELETE FROM progetti WHERE id=$1', [idProg]); }
      if (idCli)  { await db.query('DELETE FROM contratti WHERE percorso_id IN (SELECT id FROM percorsi WHERE client_id=$1)', [idCli]);
                    await db.query('DELETE FROM percorsi WHERE client_id=$1', [idCli]); await db.query('DELETE FROM clients WHERE id=$1', [idCli]); }
      if (idComm) await db.query('DELETE FROM committenti WHERE id=$1', [idComm]);
      console.log('   ✓ righe di prova rimosse');
    } catch (e) { console.log('   ⚠️ pulizia incompleta: ' + e.message); }
    srv.close();
    console.log(`\n${ko === 0 ? '✅' : '🔴'} ${ok} passate, ${ko} fallite`);
    process.exit(ko === 0 ? 0 : 1);
  }
})();
