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
  } catch (e) {
    ko++; console.log('\n🔴 ECCEZIONE: ' + e.message + '\n' + e.stack.split('\n')[1]);
  } finally {
    console.log('\n6. Pulizia (solo le righe create da questa prova)');
    try {
      if (idProg) { await db.query('DELETE FROM percorso_partecipanti WHERE percorso_id IN (SELECT id FROM percorsi WHERE progetto_id=$1)', [idProg]);
                    await db.query('DELETE FROM partecipazioni WHERE progetto_id=$1', [idProg]);
                    await db.query('DELETE FROM percorsi WHERE progetto_id=$1', [idProg]);
                    await db.query('DELETE FROM progetti WHERE id=$1', [idProg]); }
      if (idCli)  { await db.query('DELETE FROM percorsi WHERE client_id=$1', [idCli]); await db.query('DELETE FROM clients WHERE id=$1', [idCli]); }
      if (idComm) await db.query('DELETE FROM committenti WHERE id=$1', [idComm]);
      console.log('   ✓ righe di prova rimosse');
    } catch (e) { console.log('   ⚠️ pulizia incompleta: ' + e.message); }
    srv.close();
    console.log(`\n${ko === 0 ? '✅' : '🔴'} ${ok} passate, ${ko} fallite`);
    process.exit(ko === 0 ? 0 : 1);
  }
})();
