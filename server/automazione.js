/**
 * L'AUTOMAZIONE SI VEDE — fetta 2.2 del riordino (04/09/2026).
 *
 * Le quattro passate delle 07/15/23 (report dei clienti, dei progetti, delle
 * sedute collettive, moduli) scrivevano il loro esito nei log di Railway, dove
 * non guarda nessuno; e stavano in un solo blocco, per cui se la prima
 * esplodeva le altre tre non partivano. Un report con un nome fuori schema
 * («Verbale Intake.docx») veniva ignorato senza traccia.
 *
 * Qui ogni passata gira per conto suo, dentro `esegui`, e lascia una riga in
 * `automazione_passate` (decisione (a) di Germano, 04/09: una tabella nuova, che
 * non tocca quelle esistenti): quando, quanto è durata, cosa ha fatto, cosa non
 * è riuscita, cosa ha ignorato. La home legge l'ultima riga di ogni passata e
 * dice «L'automazione non è riuscita a…» con i nomi, così il coach può agire
 * (rinominare un file, controllare un link Drive) invece di scoprirlo fra due mesi.
 */
const db = require('./db');

/** Le passate conosciute, con le parole della home. */
const NOMI = {
  'report-clienti':    'i report dei clienti',
  'report-progetti':   'i report dei progetti',
  'report-collettivi': 'i report delle sedute collettive',
  'moduli':            'i moduli compilati (scheda e contratto)',
};

/**
 * Il riassunto di un esito, PURO: dal risultato di uno scanner alle poche cose
 * che contano. Regge i quattro formati (processed/proposte, skipped/letti…).
 */
function riassunto(out) {
  const o = out || {};
  const fatti = (o.processed || o.proposte || []).length;
  const errori = (o.errors || []).map(e => ({
    chi: e.cliente || e.progetto || e.percorso || e.dove || '',
    file: e.file || '',
    err: String(e.err || e.errore || e.message || 'errore'),
  }));
  const ignorati = (o.ignorati || []).map(i => ({ chi: i.cliente || i.progetto || '', file: i.file || '' }));
  const alLimite = errori.filter(e => /limite per passata/.test(e.err)).length;
  return {
    fatti,
    saltati: Number(o.skipped || o.saltati || 0),
    soggetti: Number(o.clients || o.progetti || o.percorsi || 0),
    errori: errori.filter(e => !/limite per passata/.test(e.err)),
    ignorati,
    rimasti: alLimite,   // report lasciati indietro perché la passata ha un tetto
  };
}

/**
 * Esegue una passata e ne conserva l'esito. Non rilancia mai: una passata che
 * fallisce non deve fermare quella dopo. Restituisce { ok, esito, errore }.
 */
async function esegui(passata, fn) {
  const t0 = Date.now();
  let esito = null, errore = null, out = null;
  try { out = await fn(); esito = riassunto(out); }
  catch (e) { errore = String((e && e.message) || e); }
  const durata = Date.now() - t0;
  try {
    await db.query(
      `INSERT INTO automazione_passate (passata, ok, durata_ms, esito, errore) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [passata, !errore, durata, JSON.stringify(esito || {}), errore]);
    // Le righe vecchie non servono a nessuno: si tengono novanta giorni.
    await db.query(`DELETE FROM automazione_passate WHERE quando < NOW() - INTERVAL '90 days'`);
  } catch (e) { console.error('[automazione] esito non registrato:', e.message); }
  return { ok: !errore, esito, errore, out };
}

/** L'ultima riga di ogni passata, per la home. */
async function ultime() {
  const r = await db.query(
    `SELECT DISTINCT ON (passata) passata, quando, ok, durata_ms, esito, errore
       FROM automazione_passate ORDER BY passata, quando DESC`);
  return r.rows;
}

/**
 * Le cose da dire in home, PURE: una voce per ogni problema, con un nome.
 * `righe` sono quelle di `ultime()`. Vuoto = niente da dire.
 * @returns {Array<{testo:string, grave:boolean}>}
 */
function perHome(righe) {
  const voci = [];
  for (const r of righe || []) {
    const nome = NOMI[r.passata] || r.passata;
    if (!r.ok) { voci.push({ testo: `Non è riuscita a leggere ${nome}: ${r.errore || 'errore'}`, grave: true }); continue; }
    const e = r.esito || {};
    for (const x of e.errori || []) {
      voci.push({ testo: `${x.chi ? x.chi + ' — ' : ''}${x.file ? '«' + x.file + '»: ' : ''}${x.err}`, grave: true });
    }
    for (const x of e.ignorati || []) {
      voci.push({ testo: `${x.chi ? x.chi + ' — ' : ''}«${x.file}» non comincia con «Report»: ignorato. Rinominalo e verrà letto.`, grave: false });
    }
    if (e.rimasti) voci.push({ testo: `${nome}: ${e.rimasti === 1 ? '1 report lasciato' : e.rimasti + ' report lasciati'} alla prossima passata (tetto raggiunto).`, grave: false });
  }
  return voci;
}

module.exports = { NOMI, riassunto, esegui, ultime, perHome };
