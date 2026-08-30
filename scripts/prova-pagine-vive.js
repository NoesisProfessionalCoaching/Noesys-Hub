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
const { signToken, COOKIE_NAME } = require('../server/auth');

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
  let idCli, idComm, idProg, idPerc;
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
    r = await chiama('POST', '/dashboard/contratti/stato', { tipo: 'cliente', soggetto_id: idPercInd, stato: 'in_attesa' });
    dice(r.stato === 200, 'lo stato si muove anche di qui', r.stato + ' ' + r.testo.slice(0, 90));
    r = await chiama('GET', `/dashboard/clients/${idCli}`);
    dice(r.testo.includes('In attesa di approvazione'), 'e la scheda ricaricata lo mostra');
    const cInd = await db.query("SELECT stato FROM contratti WHERE tipo='cliente' AND percorso_id=$1", [idPercInd]);
    dice(cInd.rows.length === 1 && cInd.rows[0].stato === 'in_attesa', 'nel database c\'è una riga sola, giusta');
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
    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'approvata' });
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

    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'approvata' });
    r = await chiama('GET', `/dashboard/progetti/${idProg}`);
    dice(!r.testo.includes('si è svolto senza contratto') && !r.testo.includes('Kick-Off in calendario'),
      'e col contratto firmato l\'avviso sparisce del tutto');
    await chiama('POST', '/dashboard/contratti/stato', { tipo: 'committente', soggetto_id: idProg, stato: 'da_inviare' });
    await db.query('DELETE FROM fasi_progetto WHERE id=$1', [ko.rows[0].id]);

    console.log('\n16. 🔬 Adesso la rompo apposta');
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
  } catch (e) {
    ko++; console.log('\n🔴 ECCEZIONE: ' + e.message + '\n' + e.stack.split('\n')[1]);
  } finally {
    console.log('\n17. Pulizia (solo le righe create da questa prova)');
    try {
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
