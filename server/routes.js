
const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('./db');
const { signToken, requireCoach, COOKIE_NAME } = require('./auth');
const { logoCompact, logoPicto } = require('./logo');
const drive = require('./google-drive');
const scan = require('./scan');
const scanModuli = require('./scan-moduli');
const contratto = require('./contratto');            // l'impaginatore: disegna le pagine
const contrattoTesti = require('./contratto-testi');  // le parole del contratto
const contrattiStato = require('./contratti-stato'); // gli stati della bozza
const collaudo = require('./collaudo');               // i record di prova fuori dai numeri (fetta 1.4)
const chiamaUi = require('./chiama-ui');              // la chiamata che legge la risposta (fetta 2.1)
const statoUi = require('./stato-ui');                // filtro e sezioni aperte non si perdono (fetta 2.4)
const automazione = require('./automazione');         // l'esito delle passate automatiche (fetta 2.2)
const dateIt = require('./date-it');                  // un solo «oggi», una sola data italiana (fetta 4.3)
const paginaJs = require('./pagina-js');              // il JavaScript comune delle pagine (fetta 4.4)
const documenti = require('./documenti');
const mailer = require('./mailer');
const moduli = require('./moduli');
const fiscale = require('./fiscale');
const proforma = require('./proforma');
const maturato = require('./maturato');
const appuntamenti = require('./appuntamenti');
const tranche = require('./tranche');

// L'incasso (fetta C4): una riga appesa alla proforma, e da lì lo stato si
// ricava invece di spuntarlo. Vedi incassi.js.
const incassi = require('./incassi');

// La finestrella del piano di pagamento: una sola, usata dalla scheda del
// progetto E da quella del cliente (fetta C, 15/08). Vedi piano-ui.js.
const pianoUi = require('./piano-ui');
const sedute = require('./sedute');   // lo stato di una seduta (bozza/confermata), in un posto solo

const router = express.Router();

// ⭐ Fetta 4.1 (04/09/2026): le pagine stanno in server/pagine/, ciò che è in comune in
//    server/pagine/comune.js. Qui restano le rotte e i loro aiutanti.
const { ORE_TIPO, PERMESSO_ORE_SESSIONE, PLATFORM_URL, STRUMENTI, fmtOre, itDate, itFolderDate, oggiIso } = require('./pagine/comune');
const { homePage } = require('./pagine/home');
const { loginPage, dashboardPage, driveDiagPage, clientDetailPage, cercaPage, icfPage } = require('./pagine/clienti');
const { leadsPage } = require('./pagine/lead');
const { anomaliePage, proformaPage, contrattiAmmPage, emittentePage } = require('./pagine/amministrazione');
const { committentiPage, progettiPage, progettoDettaglioPage } = require('./pagine/progetti');

router.get('/login', (req, res) => {
  res.send(loginPage());
});

router.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM coach WHERE username = $1', [username]);
    const coach = result.rows[0];
    if (!coach || !bcrypt.compareSync(password, coach.password)) {
      return res.send(loginPage('Credenziali non corrette'));
    }
    const token = signToken({ role: 'coach', id: coach.id, username: coach.username });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: 12 * 3600 * 1000 });
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.send(loginPage('Errore interno, riprova'));
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// ═══════════════════════════════════════════════════════
// DASHBOARD — LISTA CLIENTI
// ═══════════════════════════════════════════════════════

router.get('/', (req, res) => res.redirect('/dashboard'));

// Chi appartiene al mondo INDIVIDUALE: chi ha almeno un percorso FUORI dai
// progetti, più chi non ha ancora nessun percorso (un cliente appena inserito non
// deve sparire da nessuna parte). Chi esiste solo dentro un progetto si raggiunge
// dal progetto — deciso con Germano il 28/07. `tutti` scavalca il filtro: è la
// valvola di sicurezza finché la ricerca in alto non è accesa.
function queryClienti({ tutti = false } = {}) {
  const filtro = tutti ? '' : `
      WHERE EXISTS (SELECT 1 FROM percorsi pi WHERE pi.client_id = c.id AND pi.progetto_id IS NULL)
         OR NOT EXISTS (SELECT 1 FROM percorsi pt WHERE pt.client_id = c.id
              OR EXISTS (SELECT 1 FROM percorso_partecipanti ppt
                          WHERE ppt.percorso_id = pt.id AND ppt.client_id = c.id))`;
  return `
      SELECT c.*,
        (SELECT COUNT(DISTINCT s.tool) FROM sessions s WHERE s.client_id = c.id) AS tool_count,
        pp.tipo AS p_tipo, pp.n_sessioni_fatte AS p_sess, pp.ore_fatte AS p_ore, pp.stato AS p_stato,
        pp.area AS p_area, pp.progetto_id AS p_progetto_id, pp.progetto_titolo AS p_progetto_titolo
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT p.tipo, p.n_sessioni_fatte, p.ore_fatte, p.stato, p.area, p.progetto_id,
               (SELECT titolo FROM progetti g WHERE g.id = p.progetto_id) AS progetto_titolo
        FROM percorsi p
        WHERE p.client_id = c.id
           OR EXISTS (SELECT 1 FROM percorso_partecipanti pp2 WHERE pp2.percorso_id = p.id AND pp2.client_id = c.id)
        ORDER BY (p.stato = 'attivo') DESC, p.created_at DESC LIMIT 1
      ) pp ON true
      ${filtro}
      ORDER BY c.created_at DESC`;
}

// Elenco del mondo individuale, al suo indirizzo. Nasce ACCANTO alla home di oggi
// (che resta l'elenco completo finché non si scambiano gli indirizzi).
router.get('/dashboard/individuali', requireCoach, async (req, res) => {
  try {
    const tutti = req.query.tutti === '1';
    const result = await db.query(queryClienti({ tutti }));
    res.send(dashboardPage(result.rows, req, { tutti, individuali: true }));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento elenco');
  }
});

// ── ⚗️ Vero o di collaudo — fetta 1.4 (04/09/2026) ───────────────────────────
// Una rotta per le tre tabelle. Decisione 3 di Germano: si classifica dall'Hub,
// non più a mano nel codice a ogni record nuovo. Non passa dal congelamento del
// progetto: dire «è di prova» non cambia niente di ciò che il contratto scrive.
router.post('/dashboard/collaudo', requireCoach, express.json(), async (req, res) => {
  const { tipo, id, di_collaudo: v } = req.body || {};
  const tabella = collaudo.TABELLE[tipo];
  if (!tabella) return res.status(400).json({ error: 'Questo tipo di record non si classifica.' });
  if (v !== true && v !== false) return res.status(400).json({ error: 'Dire solo se è vero (false) o di collaudo (true).' });
  if (!id) return res.status(400).json({ error: 'Manca il record.' });
  try {
    const r = await db.query(`UPDATE ${tabella} SET di_collaudo = $2 WHERE id = $1 RETURNING id`, [String(id), v]);
    if (!r.rows.length) return res.status(404).json({ error: 'Record non trovato.' });
    res.json({ ok: true, di_collaudo: v });
  } catch (err) { console.error('[collaudo]', err); res.status(500).json({ error: 'Errore' }); }
});

// ── HOME (Fase 2) ────────────────────────────────────────────────────────────
// Tre porte + ciò che chiede attenzione. Niente elenco clienti: quello vive nella
// sua pagina (decisione di Germano 28/07). Nasce su /dashboard/home e diventerà la
// home quando l'avrà vista: così l'Hub non resta mai senza elenco.
// Tutti i numeri vengono da dati che l'Hub ha già: nessun campo nuovo.
async function mostraHome(req, res) {
  try {
    // ⚠️ `appRows` e non `appuntamenti`: qui dentro si chiama il modulo
    // `appuntamenti`, e una variabile con lo stesso nome — anche se assegnata
    // dopo — lo renderebbe irraggiungibile già mentre si compone questa lista.
    // ⚗️ Fetta 1.4 (04/09): i NUMERI tengono fuori i record di collaudo
    //    (`collaudo.filtro`); NULL conta come vero. Le liste qui sotto no: quelle
    //    sono lavoro, e il cartellino dice chi è di prova.
    const [ind, prog, comm, lead, bozze, daChiudere, azioni, richiami, appRows,
           anagrafiche, docsMancanti, classif, passate] = await Promise.all([
      db.query(`SELECT count(*)::int n FROM clients c
                 WHERE ${collaudo.filtro('c')}
                   AND (EXISTS (SELECT 1 FROM percorsi pi WHERE pi.client_id = c.id AND pi.progetto_id IS NULL)
                    OR NOT EXISTS (SELECT 1 FROM percorsi pt WHERE pt.client_id = c.id
                         OR EXISTS (SELECT 1 FROM percorso_partecipanti ppt
                                     WHERE ppt.percorso_id = pt.id AND ppt.client_id = c.id)))`),
      db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE p.stato='attivo')::int attivi FROM progetti p WHERE ${collaudo.filtro('p')}`),
      db.query(`SELECT count(*)::int n FROM committenti k WHERE ${collaudo.filtro('k')}`),
      db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE stato <> 'convertito')::int aperti FROM leads`),
      // Sessioni in bozza: possono essere di un cliente o di un percorso di gruppo.
      db.query(`SELECT s.id, s.data, cl.id AS client_id, cl.name AS cliente,
                       g.id AS progetto_id, g.titolo AS progetto
                  FROM sedute s
                  JOIN percorsi p ON p.id = s.percorso_id
                  LEFT JOIN clients cl ON cl.id = COALESCE(s.client_id, p.client_id)
                  LEFT JOIN progetti g ON g.id = p.progetto_id
                 WHERE s.stato = 'bozza'
                   AND (s.data IS NULL OR s.data <= CURRENT_DATE)
                 ORDER BY s.data DESC NULLS LAST LIMIT 6`),
      db.query(`SELECT cl.id, cl.name, count(*)::int n
                  FROM percorsi p JOIN clients cl ON cl.id = p.client_id
                 WHERE cl.stato_cliente = 'concluso' AND p.stato = 'attivo'
                 GROUP BY cl.id, cl.name ORDER BY cl.name LIMIT 6`),
      db.query(`SELECT id, name, prossima_azione, prossima_azione_data FROM clients
                 WHERE prossima_azione IS NOT NULL AND prossima_azione <> ''
                   AND (prossima_azione_data IS NULL OR prossima_azione_data <= CURRENT_DATE + 7)
                 ORDER BY prossima_azione_data NULLS LAST LIMIT 6`),
      db.query(`SELECT id, nome, cognome, data_prossimo_contatto FROM leads
                 WHERE stato <> 'convertito' AND data_prossimo_contatto IS NOT NULL
                   AND data_prossimo_contatto <= CURRENT_DATE + 7
                 ORDER BY data_prossimo_contatto LIMIT 6`),
      // ── Prossimi appuntamenti ──────────────────────────────────────────────
      // Non è un campo nuovo: la data della sessione successiva la scrive già
      // l'automazione dei report nel campo `scadenza` della sessione ("di norma è
      // la data della sessione SUCCESSIVA, che il report indica in chiusura").
      // Qui si legge e basta. Di ogni percorso attivo si guarda la sessione più
      // recente che porti una data vera (il campo a volte è "—" o testo libero):
      // se quella data non è ancora passata, l'appuntamento compare. Passata,
      // sparisce da solo. "Oggi" è il giorno italiano, non quello del server UTC.
      // ⭐ Dal 12/08 la regola sta in `appuntamenti.js`: due sorgenti (il report
      // e la mano del coach) e una regola sola, «vince l'ultima notizia». Sta
      // lì e non qui perché la usa anche la scheda cliente.
      appuntamenti.prossimi(),

      // ── Proposte lette dai documenti, in attesa di controllo ───────────────
      db.query(`SELECT id, name,
                       COALESCE(jsonb_array_length(bozza_anagrafica->'proposte'), 0)
                         + CASE WHEN (bozza_anagrafica->>'consenso')::boolean THEN 1 ELSE 0 END AS n
                  FROM clients WHERE bozza_anagrafica IS NOT NULL
                 ORDER BY name`),

      // ── Documentazione che manca, sui soli percorsi ATTIVI ─────────────────
      // Due situazioni diverse, e si distinguono da quello che l'automazione ha
      // già visto su Drive:
      //   · nessun modulo trovato          → il cliente non l'ha ancora mandata
      //   · trovati solo moduli "in bianco" → nella cartella c'è il modello
      //     vuoto e nient'altro
      // ⚠️ 11/08 — la frase diceva «da scansionare», dando per scontato che il
      // cliente l'avesse compilato a penna (era il caso di Davide Bozzoni). Ma
      // l'Hub non può saperlo: vede un PDF bianco, e basta. Su tre cartelle di
      // prova, dove il modello vuoto ci resterà per sempre, la frase era
      // semplicemente falsa. Ora dice solo quello che l'automazione ha visto.
      // Si guarda anche il consenso privacy, che è la cosa che conta di più.
      db.query(`
        SELECT c.id, c.name,
               COUNT(ml.id) FILTER (WHERE ml.esito <> 'in bianco') AS compilati,
               COUNT(ml.id) FILTER (WHERE ml.esito = 'in bianco')  AS bianchi,
               c.consenso_privacy
          FROM clients c
          JOIN percorsi p ON p.client_id = c.id AND p.stato = 'attivo'
          LEFT JOIN moduli_letti ml ON ml.client_id = c.id
         WHERE c.drive_url IS NOT NULL AND c.drive_url <> ''
         GROUP BY c.id, c.name, c.consenso_privacy
        HAVING COUNT(ml.id) FILTER (WHERE ml.esito <> 'in bianco') = 0
            OR c.consenso_privacy IS NOT TRUE
         ORDER BY c.name`),
      // Quanti sono di collaudo e quanti mai classificati: il cartello della home.
      db.query(`SELECT
          (SELECT count(*) FROM clients     WHERE di_collaudo IS TRUE)::int c_prova, (SELECT count(*) FROM clients     WHERE di_collaudo IS NULL)::int c_boh,
          (SELECT count(*) FROM committenti WHERE di_collaudo IS TRUE)::int k_prova, (SELECT count(*) FROM committenti WHERE di_collaudo IS NULL)::int k_boh,
          (SELECT count(*) FROM progetti    WHERE di_collaudo IS TRUE)::int p_prova, (SELECT count(*) FROM progetti    WHERE di_collaudo IS NULL)::int p_boh`),
      // ⭐ Fetta 2.2: l'ultima riga di ogni passata automatica.
      automazione.ultime(),
    ]);

    // ── Proforma create e non ancora spedite (13/08) ──────────────────────────
    // ⚠️ A differenza dei «Pagamenti da chiedere» qui sotto, questo gruppo NON è
    // legato al primo lunedì del mese: si vede SEMPRE. Una proforma ferma è
    // ferma anche il 14, e legarla al calendario vorrebbe dire nasconderla per
    // tre settimane. Chi decide cos'è «ferma» è `proforma.daMandare`.
    const fermeRows = await db.query(
      `SELECT pf.id, pf.numero, pf.data_emissione, pf.da_pagare, pf.drive_url, pf.stato,
              c.id AS client_id, COALESCE(c.di_collaudo, k.di_collaudo) AS di_collaudo,
              -- ⚠️ 17/08: chi riceve puo essere un COMMITTENTE. Il nome si legge
              -- dalla fotografia congelata nel documento, sempre giusta.
              COALESCE(pf.destinatario_dati->>'denominazione', c.name, k.denominazione) AS cliente
         FROM proforme pf LEFT JOIN clients c ON c.id = pf.client_id
         LEFT JOIN committenti k ON k.id = pf.committente_id
        WHERE pf.stato = 'emessa'
        ORDER BY pf.data_emissione, pf.anno, pf.progressivo`);
    const oggiIt = maturato.oggiRoma();
    const proformeFerme = fermeRows.rows.filter(proforma.daMandare).map(pf => ({
      ...pf, giorni: proforma.giorniFerma(pf, oggiIt),
    }));

    // ── ⭐ FETTA C4b — «Verifica se è arrivato» (18/08) ────────────────────────
    // Le proforma PARTITE e non ancora saldate, dal giorno della loro scadenza
    // (decisione di Germano). Chiude il giro cominciato con la Fase 3: chiedi →
    // mandi → **verifichi** → fatturi. Senza questa riga una proforma spedita e
    // mai pagata non la nominava più nessuno.
    // ⚠️ Il documento porta con sé quanto è già stato incassato: un acconto non
    // fa sparire la riga, la fa dire quanto manca ancora.
    const attesaRows = await db.query(
      `SELECT pf.id, pf.numero, pf.stato, pf.scadenza, pf.data_emissione, pf.da_pagare,
              COALESCE(c.di_collaudo, k.di_collaudo) AS di_collaudo,
              COALESCE(pf.destinatario_dati->>'denominazione', c.name, k.denominazione) AS cliente,
              COALESCE((SELECT SUM(i.importo) FROM incassi i
                         WHERE i.proforma_id = pf.id), 0) AS incassato
         FROM proforme pf LEFT JOIN clients c ON c.id = pf.client_id
         LEFT JOIN committenti k ON k.id = pf.committente_id
        WHERE pf.stato = 'inviata'`);
    const rateAttesa = await db.query(incassi.SQL_RATA_DEL_DOCUMENTO);
    const daVerificare = incassi.conScadenza(attesaRows.rows, rateAttesa.rows)
      .filter(pf => incassi.daVerificare(pf, pf.scadenzaVera, oggiIt))
      .map(pf => ({
        ...pf,
        giorni: incassi.giorniDiRitardo(pf.scadenzaVera, oggiIt),
        manca: incassi.residuo(pf),
        acconto: incassi.sommaIncassi([{ importo: pf.incassato }]),
      }))
      .sort((a, b) => b.giorni - a.giorni);   // i più vecchi in cima

    // ── Pagamenti da chiedere (Fase 3, Tappa 3) ───────────────────────────────
    // Il promemoria della chiusura del mese. Non è una mail e non è un lavoro
    // notturno: è una riga in più qui, che compare dal primo lunedì del mese e
    // sparisce da sola quando non c'è più niente da chiedere (scelta di Germano,
    // 12/08). Il calcolo non è scritto qui — è lo STESSO di `maturato.js` che
    // usano anche la pagina Proforma e la scheda cliente.
    const finestra = maturato.finestraPromemoria();
    let daChiedereRighe = [];
    if (finestra.attivo) {
      const tutti = await maturato.daChiedere();
      // Solo i mesi già FINITI: del mese in corso non si chiede niente, non è
      // ancora chiuso. Vale per il maturato e, con la stessa misura, per le bozze.
      daChiedereRighe = tutti.map(c => {
        const mesi  = c.mesi.filter(m => m.mese <= finestra.meseLimite);
        const bozze = c.bozze.filter(b => b.mese <= finestra.meseLimite);
        return {
          id: c.id, name: c.name, di_collaudo: c.di_collaudo, mesi, bozze,
          importo: mesi.reduce((s, m) => s + m.importo, 0),
          n: mesi.reduce((s, m) => s + m.n, 0),
          nBozze: bozze.reduce((s, b) => s + b.n, 0),
        };
      }).filter(c => c.n > 0 || c.nBozze > 0);
    }

    res.send(homePage({
      // ⚠️ Il nome per esteso, e non `daChiedere`: in questa stessa funzione c'è
      // già `daChiudere` (i percorsi da chiudere), e due parole che si
      // distinguono per una lettera sono un errore in attesa di succedere.
      pagamentiDaChiedere: daChiedereRighe,
      proformeFerme,
      incassiDaVerificare: daVerificare,
      nIndividuali: ind.rows[0].n,
      nProgetti: prog.rows[0].n, nProgettiAttivi: prog.rows[0].attivi,
      nCommittenti: comm.rows[0].n,
      nLead: lead.rows[0].n, nLeadAperti: lead.rows[0].aperti,
      // Fetta 2.2: cosa l'automazione non è riuscita a fare, con i nomi; e quando è passata l'ultima volta.
      automazione: { voci: automazione.perHome(passate), ultima: passate.length ? passate.map(p => p.quando).sort().slice(-1)[0] : null },
      classificazione: {
        collaudo:       { clienti: classif.rows[0].c_prova, committenti: classif.rows[0].k_prova, progetti: classif.rows[0].p_prova },
        nonClassificati:{ clienti: classif.rows[0].c_boh,   committenti: classif.rows[0].k_boh,   progetti: classif.rows[0].p_boh },
      },
      bozze: bozze.rows, daChiudere: daChiudere.rows,
      azioni: azioni.rows, richiami: richiami.rows,
      appuntamenti: appRows,
      anagrafiche: anagrafiche.rows,
      // (4.6: si chiamava `documenti` e oscurava il modulo con lo stesso nome)
      documenti: docsMancanti.rows.map(x => ({
        id: x.id, name: x.name,
        stato: Number(x.compilati) > 0
          ? 'manca il consenso privacy'
          : (Number(x.bianchi) > 1 ? 'trovati solo i moduli in bianco'
            : Number(x.bianchi) > 0 ? 'trovato solo il modulo in bianco'
            : 'documentazione non ancora arrivata'),
      })),
    }, req));
  } catch (err) {
    console.error('[home]', err);
    res.status(500).send('Errore nel caricamento della home');
  }
}

// `/dashboard` è la HOME. L'elenco dei clienti vive in `/dashboard/individuali`.
// `/dashboard/home` resta come alias: era l'indirizzo di prova, e un vecchio
// segnalibro non deve finire su una pagina che non c'è.
router.get('/dashboard', requireCoach, mostraHome);

router.get('/dashboard/home', requireCoach, mostraHome);

// ── Diagnosi Google Drive (Fase 3a) ────────────────────────────────
// Pagina protetta che prova, dall'Hub ONLINE, a raggiungere il Drive con le
// chiavi impostate su Railway. Solo LETTURA: non tocca database né schede.
// Serve come prova che la Fase 1 (chiavi in produzione) è davvero a posto.
router.get('/dashboard/diag/drive', requireCoach, async (req, res) => {
  const steps = [];
  let root = null, children = [];
  try {
    const missing = drive.missingEnv();
    if (missing.length) {
      steps.push({ ok: false, txt: 'Variabili mancanti su Railway: ' + missing.join(', ') });
    } else {
      steps.push({ ok: true, txt: 'Le tre variabili Google sono presenti.' });
      await drive.getAccessToken();
      steps.push({ ok: true, txt: 'Rinnovo del token riuscito: le chiavi sono valide.' });
      root = await drive.findNoesysRoot();
      if (root) {
        steps.push({ ok: true, txt: 'Trovata la cartella «Noesys» (id ' + root.id + ').' });
        children = await drive.listChildren(root.id);
        steps.push({ ok: true, txt: 'Letto il contenuto: ' + children.length + ' elementi in cima.' });
      } else {
        steps.push({ ok: false, txt: 'Chiavi valide, ma la cartella «Noesys» non è stata trovata.' });
      }
    }
  } catch (err) {
    steps.push({ ok: false, txt: err.message });
  }
  res.send(driveDiagPage(steps, root, children, req));
});

// Diagnosi SCRITTURA: crea (idempotente) una cartella di prova sotto «Noesys».
// Serve solo a verificare che le credenziali possano scrivere; poi la si cancella a mano.
// ⭐ 0.4 (03/09/2026) — era una GET: bastava un link (anche un'immagine in una
// pagina aperta col coach loggato) per far scrivere l'Hub su Drive. Una scrittura
// si fa con un pulsante, cioè con un POST; il pulsante sta nella pagina di diagnosi.
router.post('/dashboard/diag/drive/test-create', requireCoach, async (req, res) => {
  const steps = [];
  try {
    const missing = drive.missingEnv();
    if (missing.length) {
      steps.push({ ok: false, txt: 'Variabili mancanti su Railway: ' + missing.join(', ') });
    } else {
      const folder = await drive.findOrCreateFolder(drive.NOESYS_ROOT_ID, 'Test-Automazione');
      steps.push({ ok: true, txt: 'Cartella di prova pronta: «' + folder.name + '» (id ' + folder.id + ').' });
      steps.push({ ok: true, txt: 'Aprila e controlla su Drive: ' + drive.folderUrl(folder.id) });
      steps.push({ ok: true, txt: 'Se la vedi, la scrittura funziona. Ora cancella pure «Test-Automazione».' });
    }
  } catch (err) {
    steps.push({ ok: false, txt: err.message });
  }
  res.send(driveDiagPage(steps, null, [], req));
});

router.post('/dashboard/clients', requireCoach, express.json(), async (req, res) => {
  const { email, telefono, area, fonte, obiettivo, societa } = req.body;
  const cognome = (req.body.cognome || '').trim();
  const nome    = (req.body.nome || '').trim();
  if (!cognome) return res.status(400).json({ error: 'Cognome obbligatorio' });
  const name = [nome, cognome].filter(Boolean).join(' '); // display "Nome Cognome", tenuto in sync
  const id    = uuidv4();
  const token = uuidv4().replace(/-/g, '');
  try {
    await db.query(
      `INSERT INTO clients (id, name, nome, cognome, email, telefono, area, fonte, obiettivo, societa, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, name, nome, cognome, (email||'').trim(), (telefono||'').trim(),
       area||'Personal', fonte||'altro', (obiettivo||'').trim(), (societa||'').trim(), token]
    );
    // Cartelle Drive automatiche. Se Drive fallisce, il cliente resta creato lo stesso
    // (drive_url vuoto): il coach potrà riprovare col pulsante nella scheda. (opzione B)
    let driveOk = false;
    try {
      const f = await drive.createClientFolders({ area: area||'Personal', cognome, nome });
      await db.query('UPDATE clients SET drive_url=$1 WHERE id=$2', [f.url, id]);
      driveOk = true;
    } catch (e) {
      console.error('[drive] creazione cartelle cliente fallita:', e.message);
    }
    res.json({ id, token, driveOk });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore creazione cliente' });
  }
});

// Crea (o ripristina) le cartelle Drive di un cliente esistente. Usato dal pulsante
// nella scheda quando drive_url è vuoto (es. lead convertito, o creazione con Drive giù).
// Non tocca chi ha già un link, per non fare doppioni delle cartelle dei 7 storici.
router.post('/dashboard/clients/:id/drive-folders', requireCoach, async (req, res) => {
  try {
    const cr = await db.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    const c = cr.rows[0];
    if (!c) return res.status(404).json({ error: 'Cliente non trovato' });
    if (c.drive_url && c.drive_url.trim()) {
      return res.status(400).json({ error: 'Questo cliente ha già una cartella Drive. Per rifarla, svuota prima il campo link in «Modifica dati».' });
    }
    const f = await drive.createClientFolders({ area: c.area, cognome: c.cognome, nome: c.nome });
    await db.query('UPDATE clients SET drive_url=$1 WHERE id=$2', [f.url, c.id]);
    res.json({ ok: true, drive_url: f.url });
  } catch (e) {
    console.error('[drive] cartelle cliente:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard/clients/:id', requireCoach, async (req, res) => {
  try {
    const cr = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = cr.rows[0];
    if (!client) return res.redirect('/dashboard/individuali');
    const [sr, pr, payr, sedr, prjr, permr, modr] = await Promise.all([
      db.query('SELECT * FROM sessions WHERE client_id=$1 ORDER BY tool, created_at DESC', [req.params.id]),
      db.query(`SELECT p.*, prj.titolo AS progetto_titolo
                FROM percorsi p LEFT JOIN progetti prj ON prj.id = p.progetto_id
                WHERE p.client_id=$1
                   OR EXISTS (SELECT 1 FROM percorso_partecipanti pp WHERE pp.percorso_id=p.id AND pp.client_id=$1)
                ORDER BY p.created_at ASC`, [req.params.id]),
      db.query('SELECT * FROM payments WHERE client_id=$1 ORDER BY created_at DESC', [req.params.id]),
      db.query('SELECT * FROM sedute WHERE client_id=$1 ORDER BY data ASC NULLS LAST, created_at ASC', [req.params.id]),
      // Progetti di cui il coachee fa parte: SOLA LETTURA, per riflettere la sua
      // quota business sulla scheda. Il pagamento vive sul progetto (payments non toccata).
      db.query(`SELECT pa.id AS part_id, pa.quota_coachee,
                       pr.id AS progetto_id, pr.titolo, c.denominazione AS committente_nome,
                       pr.data_inizio, pr.data_meta, pr.data_fine
                FROM partecipazioni pa
                JOIN progetti pr ON pr.id = pa.progetto_id
                JOIN committenti c ON c.id = pr.committente_id
                WHERE pa.client_id=$1 ORDER BY pr.titolo`, [req.params.id]),
      // Permessi a termine sugli strumenti. La scadenza la calcola la vista
      // `permessi_validi` (una sola verità, la legge anche Coaching-Tools).
      // Se la lettura fallisse, la scheda cliente si deve aprire lo stesso: è la
      // pagina che Germano usa tutti i giorni, non la si blocca per un elenco.
      db.query(`SELECT id, tool, durata_ore, primo_accesso, attende_sessione, fine,
                       (fine >= NOW()) AS valido
                  FROM permessi_validi WHERE client_id=$1
                 ORDER BY fine DESC`, [req.params.id]).catch(() => ({ rows: [] })),
      // I moduli già letti da Drive (scheda anagrafica, contratto). Servono a dire
      // com'è messa DAVVERO l'anagrafica nel riquadro «Aggiornamento dati»: prima
      // lì c'era una frase fissa che diceva «non ancora acquisita» a tutti, sempre.
      db.query(`SELECT tipo, esito, created_at FROM moduli_letti
                 WHERE client_id=$1 ORDER BY created_at ASC`, [req.params.id])
        .catch(() => ({ rows: [] })),
    ]);
    // Fatturazione (Fase 3): le proforma di questo cliente, quanto c'è da
    // chiedergli, e i dati di chi emette (servono a dire perché non si può
    // emettere, invece di mostrare un pulsante che poi non funziona).
    // ⭐ Il «da chiedere» arriva da `maturato.js`, lo stesso modulo che risponde
    // alla home e alla pagina Proforma: la regola è scritta una volta sola.
    const [pfr, mat, emr, app, trr, trp, trc] = await Promise.all([
      db.query(`SELECT * FROM proforme WHERE client_id=$1
                 ORDER BY anno DESC, progressivo DESC`, [req.params.id]),
      maturato.daChiedere(req.params.id),
      db.query('SELECT * FROM emittente WHERE id = 1'),
      appuntamenti.perCliente(req.params.id),
      // Fetta C (15/08) — le rate dei percorsi a Pacchetto. Stessa tabella delle
      // rate dei progetti: una rata vive in un posto solo, e dice a chi
      // appartiene. Qui si guardano quelle legate a un PERCORSO di questo cliente.
      db.query(`SELECT t.* FROM tranche_progetto t
                  JOIN percorsi p ON p.id = t.percorso_id
                 WHERE p.client_id=$1
                 ORDER BY t.percorso_id, t.ordine`, [req.params.id]),
      // Fetta C2 (15/08) — le rate che questa persona paga DENTRO un progetto.
      // ⚠️ Prima qui si leggeva `stato_pag_coachee`, un interruttore acceso/spento
      // sull'INTERA quota che dal 12/08 non scrive più nessuno (i pulsanti che lo
      // accendevano sono spariti quando è arrivato il piano a rate). Restava un
      // numero congelato a prima di allora: finché tutto è «da chiedere» dice il
      // vero per caso, ma il giorno che segni incassata una rata sulla pagina del
      // progetto, qui continuerebbe a comparire «Da incassare» per l'intera quota.
      // ⭐ Una sola verità: la rata.
      db.query(`SELECT t.* FROM tranche_progetto t
                  JOIN partecipazioni pa ON pa.id = t.partecipazione_id
                 WHERE pa.client_id=$1
                 ORDER BY t.partecipazione_id, t.ordine`, [req.params.id]),
      // ⭐ C3 — quali rate di questa persona sono GIÀ STATE CHIESTE. Non è una
      // colonna: è il fatto di stare dentro una proforma viva. Da qui esce sia
      // l'etichetta «Chiesta» sia il motivo per cui il pulsante sparisce.
      // ⭐ C4 — le colonne le detta `incassi.SQL_COLONNE`: la stessa domanda la
      // fanno anche la pagina del progetto e la home, e scriverla tre volte
      // vorrebbe dire tre occasioni di divergere.
      db.query(`SELECT ${incassi.SQL_COLONNE}
                  FROM proforma_righe r
                  JOIN proforme pf ON pf.id = r.proforma_id
                  JOIN tranche_progetto t ON t.id = r.tranche_id
                  LEFT JOIN percorsi pc ON pc.id = t.percorso_id
                  LEFT JOIN partecipazioni pa ON pa.id = t.partecipazione_id
                 WHERE pf.stato <> 'annullata'
                   AND (pc.client_id = $1 OR pa.client_id = $1)`, [req.params.id]),
    ]);
    // Fetta 6a — a che punto è la bozza di contratto dei percorsi di questo
    // cliente. «Da redigere» non c'è nel database: è l'assenza della riga.
    const contrCli = await db.query(
      `SELECT c.percorso_id, c.stato FROM contratti c
         JOIN percorsi p ON p.id = c.percorso_id
        WHERE c.tipo = 'cliente' AND p.client_id = $1`, [req.params.id]);
    res.send(clientDetailPage(client, sr.rows, pr.rows, payr.rows, sedr.rows, prjr.rows, permr.rows, req, {
      statiContratti: new Map(contrCli.rows.map(c => [c.percorso_id, c.stato])),
      moduliLetti: modr.rows,
      proforme: pfr.rows,
      maturato: mat[0] || null,
      emittente: emr.rows[0] || {},
      appuntamenti: app,
      tranchePercorsi: trr.rows,
      tranchePartecipazioni: trp.rows,
      // ⭐ 17/08 — non un elenco di «chieste» ma una MAPPA rata → stato del suo
      // documento: fra «creata» e «mandata» c'e un momento vero, e chiamarli
      // tutti e due «chiesta» era la bugia che Germano ha visto subito.
      rateChieste: incassi.mappaRate(trc.rows),
    }));
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

// Aggiornamento dati anagrafici cliente
router.post('/dashboard/clients/:id', requireCoach, express.json(), async (req, res) => {
  const b = req.body;
  const cognome = (b.cognome || '').trim();
  const nome    = (b.nome || '').trim();
  if (!cognome) return res.status(400).json({ error: 'Cognome obbligatorio' });
  const name = [nome, cognome].filter(Boolean).join(' '); // display "Nome Cognome", tenuto in sync
  try {
    // Se il consenso è appena stato dato e non c'era una data, la impostiamo a oggi.
    // ⭐ 0.4 (03/09/2026) — togliere la spunta NON cancella più la data: è un dato
    //    legale (quando è stato dato il consenso) e si conserva. Quello che manca
    //    ancora è la data della REVOCA: vuole una colonna nuova, e le modifiche
    //    all'impianto del database sono rimandate a ottobre (decisione di Germano).
    //    Nel frattempo la scheda mostra il consenso come «No» e tiene la data.
    const consenso = !!b.consenso_privacy;
    await db.query(
      `UPDATE clients SET
        name=$1, nome=$22, cognome=$23, societa=$24, email=$2, telefono=$3, altro_recapito=$4, social_tipo=$5,
        via=$6, cap=$7, citta=$8, provincia=$9, data_nascita=$10,
        professione=$11, area=$12, fonte=$13, obiettivo=$14, stato_cliente=$15,
        prossima_azione=$16, prossima_azione_data=$17, drive_url=$18, note_preliminari=$19,
        luogo_nascita=$25, codice_fiscale=$26, pec=$27, codice_sdi=$28,
        partita_iva=$29, regime=$30, natura_giuridica=$31, paese=$32, identificativo_estero=$33,
        consenso_privacy=$20,
        consenso_data = CASE WHEN $20 AND consenso_data IS NULL THEN CURRENT_DATE
                             ELSE consenso_data END
       WHERE id=$21`,
      [name, (b.email||'').trim(), moduli.normalizzaTelefono((b.telefono||'').trim()), (b.altro_recapito||'').trim(),
       (b.social_tipo||'').trim(), (b.via||'').trim(), (b.cap||'').trim(), (b.citta||'').trim(),
       (b.provincia||'').trim(), b.data_nascita||null, (b.professione||'').trim(),
       b.area||'Personal', b.fonte||'altro', (b.obiettivo||'').trim(), b.stato_cliente||'attivo',
       (b.prossima_azione||'').trim(), b.prossima_azione_data||null, (b.drive_url||'').trim(),
       (b.note_preliminari||'').trim(), consenso, req.params.id, nome, cognome, (b.societa||'').trim(),
       // dal contratto firmato, ma correggibili a mano
       (b.luogo_nascita||'').trim(), (b.codice_fiscale||'').trim().toUpperCase(),
       (b.pec||'').trim(), (b.codice_sdi||'').trim(),
       // Dati fiscali (11/08). Il regime accetta solo i due valori previsti: se
       // arrivasse altro si salva vuoto, perché un regime inventato farebbe
       // sbagliare la ritenuta in silenzio. Il paese vuoto vale Italia.
       (b.partita_iva||'').trim(),
       ['ordinario','forfettario'].includes(b.regime) ? b.regime : '',
       b.natura_giuridica === 'persona_giuridica' ? 'persona_giuridica' : 'persona_fisica',
       ((b.paese||'').trim().toUpperCase() || 'IT'),
       (b.identificativo_estero||'').trim().toUpperCase()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore salvataggio' });
  }
});

// L'interruttore generale acceso/spento è stato tolto il 31/07: nessuno legge
// più `clients.active`, a decidere chi entra sono i permessi a termine. Tolta
// anche la rotta che lo spegneva — se restasse, basterebbe un vecchio
// segnalibro per bloccare un cliente con un interruttore che non si vede più.
// La colonna resta nel database: non si buttano dati, semplicemente è inerte.

// ── Bozza di anagrafica letta dai moduli: approva / scarta (08/08) ────
// L'automazione propone, il coach decide. All'approvazione si scrive in
// anagrafica e SOLO ALLORA si eliminano i moduli rimasti in bianco: finché la
// proposta non è accettata non si tocca niente, né nel database né su Drive.
router.post('/dashboard/clients/:id/bozza-anagrafica/:azione', requireCoach, express.json(), async (req, res) => {
  try {
    const r = await db.query('SELECT id, name, bozza_anagrafica FROM clients WHERE id = $1', [req.params.id]);
    const cl = r.rows[0];
    if (!cl || !cl.bozza_anagrafica) return res.status(404).json({ ok: false, error: 'Nessuna proposta da approvare' });
    const b = typeof cl.bozza_anagrafica === 'string' ? JSON.parse(cl.bozza_anagrafica) : cl.bozza_anagrafica;

    if (req.params.azione === 'scarta') {
      await db.query('UPDATE clients SET bozza_anagrafica = NULL WHERE id = $1', [cl.id]);
      return res.json({ ok: true, scartata: true });
    }
    if (req.params.azione !== 'approva') return res.status(400).json({ ok: false, error: 'Azione sconosciuta' });

    // Si applicano SOLO i campi che il coach ha lasciato spuntati.
    // `campi` arriva come [{campo, valore}]: il valore è quello che il coach ha
    // sotto gli occhi, corretto se l'ha corretto. Si riapplica lo standard di
    // scrittura anche a quello che scrive lui, così il dato entra nello stesso
    // modo comunque sia arrivato.
    const scelti = new Map((req.body.campi || [])
      .filter(x => x && x.campo).map(x => [x.campo, x.valore]));
    const set = [], vals = [];
    for (const p of (b.proposte || [])) {
      if (!scelti.has(p.campo)) continue;
      const grezzo = scelti.get(p.campo);
      const valore = moduli.normalizzaCampo(p.campo, grezzo == null || grezzo === '' ? p.dopo : grezzo);
      vals.push(valore); set.push(`${p.campo} = $${vals.length}`);
    }
    if (b.consenso && req.body.consenso !== false) {
      set.push('consenso_privacy = TRUE');
      if (b.dataConsenso) { vals.push(b.dataConsenso); set.push(`consenso_data = $${vals.length}`); }
    }
    if (set.length) {
      vals.push(cl.id);
      await db.query(`UPDATE clients SET ${set.join(', ')} WHERE id = $${vals.length}`, vals);
    }

    // Ora che i dati sono al sicuro, via i moduli rimasti in bianco.
    let eliminati = 0;
    const avvisi = [];
    for (const v of (b.daEliminare || [])) {
      try { await drive.deleteFileForever(v.id); eliminati++; }
      catch (e) { avvisi.push(`«${v.nome}» non si è potuto eliminare: ${e.message}`); }
    }
    await db.query('UPDATE clients SET bozza_anagrafica = NULL WHERE id = $1', [cl.id]);
    res.json({ ok: true, scritti: set.length, eliminati, avvisi });
  } catch (err) {
    console.error('[bozza-anagrafica]', err);
    res.status(500).json({ ok: false, error: 'Errore: ' + err.message });
  }
});

// ── Permessi a termine sugli strumenti (2026-07-31) ────
// Il coach sceglie lo strumento (o «il portale») e per quanto vale, l'Hub apre il
// permesso e restituisce il link da mandare. Il link è sempre lo stesso indirizzo:
// a decidere se si apre è il permesso, non l'indirizzo.
router.post('/dashboard/clients/:id/permessi', requireCoach, express.json(), async (req, res) => {
  try {
    const cr = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = cr.rows[0];
    if (!client) return res.status(404).json({ ok: false, error: 'Cliente non trovato' });

    const tool = req.body.tool ? String(req.body.tool) : null;
    if (tool && !STRUMENTI.some(t => t.key === tool)) {
      return res.status(400).json({ ok: false, error: 'Strumento sconosciuto' });
    }
    const durata = req.body.durata === 'sessione' ? 'sessione' : 'ore';
    const pid = uuidv4();

    if (durata === 'sessione') {
      // Aprire TUTTO fino alla sessione successiva non è previsto: il portale
      // intero è il link della sessione in corso, il compito è su uno strumento.
      if (!tool) return res.status(400).json({ ok: false, error: 'Fino alla prossima sessione vale per un solo strumento, non per tutto il portale.' });
      // La data non la digita il coach: è quella che i report hanno già scritto.
      // Stessa regola della home: la seduta confermata più recente che porti una
      // data vera, e solo se quella data non è già passata.
      const sr = await db.query(
        `SELECT s.scadenza FROM sedute s
          WHERE s.client_id = $1 AND s.stato = 'confermata'
            AND s.scadenza ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ORDER BY s.data DESC NULLS LAST LIMIT 1`, [req.params.id]);
      const scad = sr.rows[0] && sr.rows[0].scadenza;
      const oggiRoma = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
      if (!scad || scad < oggiRoma) {
        // Regola di Germano (31/07): se la prossima sessione non è ancora
        // pianificata, il permesso NON si rifiuta — resta libero finché la data
        // non viene decisa, e allora si aggancia da sé a quel giorno.
        await db.query(
          `INSERT INTO permessi_strumenti (id, client_id, tool, attende_sessione)
           VALUES ($1, $2, $3, TRUE)`, [pid, client.id, tool]);
      } else {
        // Fine giornata di quel giorno, ora italiana: durante la sessione successiva
        // il lavoro si deve poter ancora aprire, per guardarlo insieme.
        await db.query(
          `INSERT INTO permessi_strumenti (id, client_id, tool, scade_il)
           VALUES ($1, $2, $3, ((($4::date + INTERVAL '1 day') - INTERVAL '1 second') AT TIME ZONE 'Europe/Rome'))`,
          [pid, client.id, tool, scad]);
      }
    } else {
      // A ore: scade_il resta vuoto, il conto parte alla prima apertura (lo segna
      // Coaching-Tools). Vedi la vista `permessi_validi`.
      await db.query(
        `INSERT INTO permessi_strumenti (id, client_id, tool, durata_ore) VALUES ($1, $2, $3, $4)`,
        [pid, client.id, tool, PERMESSO_ORE_SESSIONE]);
    }

    const url = PLATFORM_URL + '/c/' + client.token + (tool ? '/tool/' + tool : '');

    // Invio per email (solo per gli strumenti singoli). Il permesso è già aperto:
    // se la mail non parte lo si dice, ma il link resta valido e copiabile — non
    // si butta via il permesso per un guasto della posta.
    const mail = req.body.email;
    if (mail && mail.to) {
      if (!tool) return res.status(400).json({ ok: false, error: 'La mail si manda per un singolo strumento, non per il portale.' });
      try {
        await mailer.sendMail({
          to: String(mail.to).trim(),
          subject: String(mail.subject || '').trim() || (STRUMENTI.find(t => t.key === tool) || {}).nome,
          text: String(mail.body || ''),
        });
        return res.json({ ok: true, link: url, inviata: true });
      } catch (e) {
        console.error('[permessi/mail]', e);
        return res.json({ ok: true, link: url, inviata: false, avviso: 'Il permesso è aperto, ma la mail non è partita: ' + e.message });
      }
    }
    res.json({ ok: true, link: url });
  } catch (err) {
    console.error('[permessi]', err);
    res.status(500).json({ ok: false, error: 'Non sono riuscito a creare il permesso.' });
  }
});

// Chiudere un permesso prima della sua scadenza. Non si cancella la riga: resta
// la traccia di cosa era stato aperto e quando lo si è chiuso.
router.post('/dashboard/clients/:id/permessi/:pid/chiudi', requireCoach, async (req, res) => {
  try {
    await db.query(
      'UPDATE permessi_strumenti SET revocato_il = NOW() WHERE id = $1 AND client_id = $2',
      [req.params.pid, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[permessi]', err);
    res.status(500).json({ ok: false, error: 'Errore' });
  }
});

router.get('/dashboard/clients/:id/data', requireCoach, async (req, res) => {
  try {
    const cr = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = cr.rows[0];
    if (!client) return res.status(404).json({ error: 'Non trovato' });
    const sr = await db.query('SELECT * FROM sessions WHERE client_id = $1', [req.params.id]);
    res.json({ client, sessions: sr.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/clients/:id', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// ═══════════════════════════════════════════════════════
// PERCORSI
// ═══════════════════════════════════════════════════════

// Le quattro modalità di un percorso (decise con Germano il 10/08/2026). Il campo
// `prezzo` resta UNO SOLO e cambia significato con la modalità:
//   Standard        → si paga ogni sessione: `prezzo` è il costo DI UNA SESSIONE
//   Pacchetto       → cifra unica per N sessioni: `prezzo` è il TOTALE
//   Scambio servizi → nessuna cifra (senza valore dichiarato)
//   Pro bono        → nessuna cifra
// È il numero che finirà scritto nell'articolo sul compenso del contratto, quindi
// nelle due modalità senza cifra il prezzo va azzerato: un numero orfano rimasto lì
// da una modalità precedente verrebbe stampato su un contratto vero.
const MODALITA_PERCORSO = ['Standard', 'Pacchetto', 'Scambio servizi', 'Pro bono'];

const MODALITA_SENZA_PREZZO = ['Scambio servizi', 'Pro bono'];

// La prestazione in cambio ha senso in UNA modalità sola. Fuori da quella si
// azzera, per la stessa ragione per cui si azzera il prezzo: un valore orfano
// finirebbe stampato su un contratto vero.
function prestazionePerModalita(modalita, testo) {
  if (modalita !== 'Scambio servizi') return null;
  const s = (testo == null ? '' : String(testo)).trim();
  return s || null;
}

function prezzoPerModalita(modalita, prezzo) {
  if (MODALITA_SENZA_PREZZO.includes(modalita)) return null;
  return (prezzo === '' || prezzo === undefined) ? null : prezzo;
}

router.post('/dashboard/clients/:id/percorsi', requireCoach, express.json(), async (req, res) => {
  const { tipo, n_sessioni_previste, n_sessioni_fatte, promo, sconto_note,
          data_inizio, data_fine, modalita, ore_fatte, stato, progetto_id } = req.body;
  const prezzo = prezzoPerModalita(modalita || 'Standard', req.body.prezzo);
  const prestazione = prestazionePerModalita(modalita || 'Standard', req.body.prestazione_scambio);
  try {
    const pid = uuidv4();
    await db.query(
      `INSERT INTO percorsi (id,client_id,tipo,n_sessioni_previste,n_sessioni_fatte,prezzo,promo,sconto_note,data_inizio,data_fine,modalita,ore_fatte,stato,progetto_id,prestazione_scambio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [pid, req.params.id, tipo||'Individuale', n_sessioni_previste||8, n_sessioni_fatte||0,
       prezzo||null, promo||false, sconto_note||'', data_inizio||null, data_fine||null,
       modalita||'Standard', ore_fatte||0, stato||'attivo', progetto_id||null, prestazione]
    );
    // Cartelle Drive del percorso: Percorsi/{gg-mm-aaaa}/{Intake,Ongoing,Final}.
    // Servono: cartella cliente (drive_url) + data inizio. Se manca l'una o l'altra,
    // o Drive fallisce, il percorso resta creato lo stesso e avvisiamo il coach.
    let driveWarning = null;
    try {
      const cr = await db.query('SELECT drive_url FROM clients WHERE id=$1', [req.params.id]);
      const clientFolderId = drive.folderIdFromUrl(cr.rows[0] && cr.rows[0].drive_url);
      const folderName = itFolderDate(data_inizio);
      if (!clientFolderId) {
        driveWarning = 'Il cliente non ha ancora una cartella Drive: crea prima quella (pulsante «🔄 Crea cartelle Drive» nella scheda), poi ricrea il percorso.';
      } else if (!folderName) {
        driveWarning = 'Percorso creato, ma senza data d\'inizio non ho potuto creare le cartelle Intake/Ongoing/Final su Drive.';
      } else {
        await drive.createPercorsoFolders(clientFolderId, folderName);
      }
    } catch (e) {
      console.error('[drive] cartelle percorso fallite:', e.message);
      driveWarning = 'Percorso creato, ma le cartelle Drive non sono state create: ' + e.message;
    }
    // Fetta 1a — documentazione nuovo cliente: copia i modelli "uguali per tutti"
    // (Scheda Anagrafica + Codice Etico ICF) nella cartella Documentazione del cliente.
    // Idempotente: se ci sono già, non li duplica (percorsi successivi = nessun doppione).
    try {
      const cr2 = await db.query('SELECT drive_url FROM clients WHERE id=$1', [req.params.id]);
      const clientFolderId = drive.folderIdFromUrl(cr2.rows[0] && cr2.rows[0].drive_url);
      if (clientFolderId) {
        const r = await drive.copiaModelliBase(clientFolderId);
        if (r.mancanti.length) {
          driveWarning = (driveWarning ? driveWarning + ' · ' : '')
            + 'Documenti non copiati (nomi non trovati in Modelli): ' + r.mancanti.join(', ');
        }
      }
    } catch (e) {
      console.error('[drive] copia modelli fallita:', e.message);
      driveWarning = (driveWarning ? driveWarning + ' · ' : '')
        + 'Copia documenti non riuscita: ' + e.message;
    }
    // Fetta 1b — lettera di benvenuto personalizzata: genera il PDF (nome nel saluto,
    // scelta Benvenuto/Benvenuta dal nome) e lo salva nella Documentazione del cliente.
    try {
      const cr3 = await db.query('SELECT nome, name, drive_url FROM clients WHERE id=$1', [req.params.id]);
      const row = cr3.rows[0] || {};
      const clientFolderId = drive.folderIdFromUrl(row.drive_url);
      const nome = (row.nome && row.nome.trim()) || String(row.name || '').trim().split(/\s+/)[0];
      if (clientFolderId && nome) {
        const docFolder = await drive.findOrCreateFolder(clientFolderId, 'Documentazione');
        const letter = await documenti.generaLetteraBenvenuto({ nome });
        await drive.uploadFileToFolder(letter.fileName, 'application/pdf', letter.bytes, docFolder.id);
      }
    } catch (e) {
      console.error('[lettera] generazione fallita:', e.message);
      driveWarning = (driveWarning ? driveWarning + ' · ' : '')
        + 'Lettera di benvenuto non creata: ' + e.message;
    }
    res.json({ ok: true, id: pid, driveWarning });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Fetta 1c — invio Mail 1 di benvenuto (lettera + scheda anagrafica + Codice Etico ICF).
// Azionata dal coach dal pannello "Rivedi e invia" nella scheda cliente. Rigenera la
// lettera col genere scelto (così l'allegato è coerente con la scelta del pannello) e
// allega i due modelli base scaricati da Drive. Alla riuscita segna la data in anagrafica.
router.post('/dashboard/clients/:id/mail1/invia', requireCoach, express.json(), async (req, res) => {
  try {
    if (!mailer.mailerReady()) {
      return res.status(400).json({ error: 'Invio email non configurato sul server (GMAIL_USER/GMAIL_PASS).' });
    }
    const to = String(req.body.to || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    const genere = req.body.genere === 'femminile' ? 'femminile'
                 : req.body.genere === 'maschile' ? 'maschile' : null;
    if (!to) return res.status(400).json({ error: 'Manca il destinatario.' });
    if (!subject) return res.status(400).json({ error: "Manca l'oggetto." });

    const cr = await db.query('SELECT nome, name FROM clients WHERE id=$1', [req.params.id]);
    const row = cr.rows[0];
    if (!row) return res.status(404).json({ error: 'Cliente non trovato.' });
    const nome = (row.nome && row.nome.trim()) || String(row.name || '').trim().split(/\s+/)[0];
    if (!nome) return res.status(400).json({ error: 'Il cliente non ha un nome per la lettera.' });

    // Allegati: lettera personalizzata (rigenerata col genere scelto) + i 2 modelli base.
    const attachments = [];
    const letter = await documenti.generaLetteraBenvenuto({ nome, genere });
    attachments.push({ filename: letter.fileName, content: letter.bytes, contentType: 'application/pdf' });

    const modelli = await drive.findModelliFolder();
    if (!modelli) return res.status(500).json({ error: 'Cartella "Modelli" non trovata su Drive.' });
    const mancanti = [];
    for (const nomeFile of drive.MODELLI_BASE) {
      const f = await drive.findFileByName(modelli.id, nomeFile);
      if (!f) { mancanti.push(nomeFile); continue; }
      const buf = await drive.downloadFileBuffer(f.id);
      // Nome allegato pulito per il cliente: togli il " OK" tecnico dai modelli.
      attachments.push({ filename: nomeFile.replace(/ OK\.pdf$/i, '.pdf'), content: buf, contentType: 'application/pdf' });
    }
    if (mancanti.length) return res.status(500).json({ error: 'Modelli non trovati su Drive: ' + mancanti.join(', ') });

    await mailer.sendMail({ to, subject, text: body, attachments });
    await db.query('UPDATE clients SET mail1_inviata_data = NOW() WHERE id=$1', [req.params.id]);
    res.json({ ok: true, to, allegati: attachments.map(a => a.filename) });
  } catch (err) {
    console.error('[mail1]', err);
    res.status(500).json({ error: 'Invio non riuscito: ' + err.message });
  }
});

// Fetta 2 — invio Mail 2 (contratto + agenda), dopo la seduta di Intake.
// Il CONTRATTO si allega tale e quale (il cliente compila i dati a mano e firma);
// l'AGENDA viene personalizzata col solo nome di battesimo. Invio via Gmail API.
router.post('/dashboard/clients/:id/mail2/invia', requireCoach, express.json(), async (req, res) => {
  try {
    const to = String(req.body.to || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    const percorsoId = String(req.body.percorso_id || '').trim();
    // ⭐ Fetta 3.3 (04/09): si sceglie cosa allegare. Senza indicazione partono
    //    tutti e tre, come prima. Un nome sconosciuto è un errore, non un silenzio.
    const ALLEGATI = ['contratto', 'informativa', 'agenda'];
    const scelti = Array.isArray(req.body.allegati) ? req.body.allegati.map(String) : ALLEGATI.slice();
    if (!scelti.length) return res.status(400).json({ error: 'Spunta almeno un allegato.' });
    const ignoto = scelti.find(a => !ALLEGATI.includes(a));
    if (ignoto) return res.status(400).json({ error: 'Allegato sconosciuto: ' + ignoto });
    const conContratto = scelti.includes('contratto');
    if (!to) return res.status(400).json({ error: 'Manca il destinatario.' });
    if (!subject) return res.status(400).json({ error: "Manca l'oggetto." });

    const cr = await db.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    const cliente = cr.rows[0];
    if (!cliente) return res.status(404).json({ error: 'Cliente non trovato.' });
    const nome = (cliente.nome && cliente.nome.trim()) || String(cliente.name || '').trim().split(/\s+/)[0];
    if (!nome) return res.status(400).json({ error: "Il cliente non ha un nome per l'agenda." });

    // 🔴 03/09 — PRIMA QUI SI SCARICAVA `Contratto Coaching OK.pdf` DA DRIVE:
    //    il modello GENERICO, uguale per tutti, che non nomina né il cliente né
    //    la sua modalità né il suo prezzo. Nel frattempo l'Hub sapeva già
    //    costruire il contratto vero, ma quello restava un'anteprima che moriva
    //    nel browser. Germano se n'è accorto usandolo: «il contratto viene bene,
    //    ma una volta aperto non succede niente».
    // ⛔ Fetta 0.5 (04/09) — IL PERCORSO LO DICE LA FINESTRELLA, non lo sceglie
    //    questa rotta. Fino al 03/09 la scheda sceglieva il percorso per
    //    l'anteprima e questa rotta lo risceglieva per conto suo con la stessa
    //    regola: due scelte in due momenti diversi, e con due percorsi
    //    individuali (o uno creato nel frattempo) il PDF spedito poteva non
    //    essere quello guardato. Ora la finestrella manda l'id del percorso di
    //    cui ha aperto l'anteprima, e qui si controlla solo che sia davvero un
    //    percorso individuale di QUESTO cliente. Senza id non si manda niente:
    //    scegliere da soli sarebbe tornare al difetto.
    let percorso = null;
    if (conContratto) {
      if (!percorsoId) {
        return res.status(400).json({ error: 'Manca il percorso del contratto: riapri la scheda del cliente e la finestrella della Mail 2.' });
      }
      const pq = await db.query('SELECT * FROM percorsi WHERE id=$1 AND client_id=$2 AND progetto_id IS NULL', [percorsoId, req.params.id]);
      percorso = pq.rows[0];
      if (!percorso) {
        return res.status(404).json({
          error: 'Quel percorso non è un percorso individuale di questo cliente: il contratto non ' +
                 'saprebbe dire né la modalità né il prezzo. ⛔ Non mando il modello generico al suo posto.',
        });
      }
    }
    // La posta si controlla DOPO il percorso: così un difetto nel percorso si
    // vede anche dove la posta non c'è (la prova gira senza chiavi Gmail).
    if (!mailer.mailerReady()) {
      return res.status(400).json({ error: 'Invio email non configurato sul server.' });
    }

    const attachments = [];
    // ⭐ Lo STESSO PDF dell'anteprima: si manda quello che si è guardato.
    if (conContratto) attachments.push({
      filename: nomeFilePulito('Contratto', cliente),
      content: await pdfContrattoCliente(cliente, percorso),
      contentType: 'application/pdf',
    });
    // L'informativa privacy: il testo c'era dal 27/08, ma non la allegava nessuno.
    if (scelti.includes('informativa')) attachments.push({
      filename: nomeFilePulito('Informativa privacy', cliente),
      content: await pdfLetteraPrivacy(),
      contentType: 'application/pdf',
    });
    // Agenda: personalizzata col nome.
    if (scelti.includes('agenda')) {
      const agenda = await documenti.generaAgenda({ nome });
      attachments.push({ filename: 'Agenda di sessione.pdf', content: agenda.bytes, contentType: 'application/pdf' });
    }

    await mailer.sendMail({ to, subject, text: body, attachments });
    // La Mail 2 «è inviata» quando parte il CONTRATTO, che è la sua sostanza: una
    // mail con la sola agenda non chiude il passo.
    if (conContratto) await db.query('UPDATE clients SET mail2_inviata_data = NOW() WHERE id=$1', [req.params.id]);

    // ⭐ MANDARE È UN FATTO, e lo stato del contratto si ricava dai fatti: se la
    //    mail è partita, quel contratto è «in attesa di approvazione». Prima
    //    bisognava ricordarsi di spostarlo a mano, cioè ricordarsi di dire alla
    //    macchina una cosa che la macchina aveva appena fatto.
    // ⚠️ Dopo l'invio: se questo passo fallisce la mail è comunque partita, e
    //    non si annulla una mail. Perciò non butta all'aria la risposta.
    if (conContratto) try {
      const agg = await db.query(
        `UPDATE contratti SET stato='in_attesa', data_invio=CURRENT_DATE, updated_at=NOW()
          WHERE tipo='cliente' AND percorso_id=$1 AND stato <> 'approvata'`, [percorso.id]);
      if (!agg.rowCount) {
        await db.query(
          `INSERT INTO contratti (id, tipo, percorso_id, stato, data_invio)
           VALUES ($1,'cliente',$2,'in_attesa',CURRENT_DATE)
           ON CONFLICT DO NOTHING`, [uuidv4(), percorso.id]);
      }
    } catch (e) { console.error('[mail2] stato contratto non aggiornato:', e.message); }

    res.json({ ok: true, to, allegati: attachments.map(a => a.filename) });
  } catch (err) {
    console.error('[mail2]', err);
    res.status(500).json({ error: 'Invio non riuscito: ' + err.message });
  }
});

// Diagnostica: elenca i file dentro Noesys/Modelli (nome + tipo). Serve a confermare
// i nomi ESATTI dei modelli e che l'Hub raggiunga la cartella. Apri l'URL da loggato.
router.get('/dashboard/diag/modelli', requireCoach, async (req, res) => {
  try {
    const modelli = await drive.findModelliFolder();
    if (!modelli) return res.json({ ok: false, error: 'Cartella "Modelli" non trovata sotto la radice Noesys.' });
    const top = await drive.listChildren(modelli.id);
    const fileRientri = top.filter(f => !drive.isFolder(f)).map(f => ({ name: f.name, mimeType: f.mimeType }));
    // Sbircia UN livello dentro le sottocartelle (es. "Per Claude").
    const sottocartelle = [];
    for (const f of top.filter(drive.isFolder)) {
      const kids = await drive.listChildren(f.id);
      sottocartelle.push({ cartella: f.name, files: kids.filter(k => !drive.isFolder(k)).map(k => ({ name: k.name, mimeType: k.mimeType })) });
    }
    res.json({ ok: true, attesi: drive.MODELLI_BASE, in_modelli: fileRientri, sottocartelle });
  } catch (err) { console.error('[diag/modelli]', err); res.status(500).json({ error: err.message }); }
});

// Modifica un percorso già creato. Serve perché il contratto si redige DOPO la seduta
// di Intake (Germano, 10/08/2026): modalità di pagamento e prezzo si sanno solo allora,
// mentre il percorso esiste già da prima. Prima di questa rotta l'unico rimedio era
// cancellare il percorso e rifarlo, perdendo le sedute collegate.
// Non tocca: stato, data_fine, progetto_id, e soprattutto ore_fatte/n_sessioni_fatte —
// quelli li ricalcolano le sedute, e riscriverli da qui cancellerebbe ore vere.
router.post('/dashboard/clients/:id/percorsi/:pid', requireCoach, express.json(), async (req, res) => {
  const { tipo, n_sessioni_previste, promo, sconto_note, data_inizio, modalita } = req.body;
  const prezzo = prezzoPerModalita(modalita || 'Standard', req.body.prezzo);
  const prestazione = prestazionePerModalita(modalita || 'Standard', req.body.prestazione_scambio);
  try {
    const r = await db.query(
      `UPDATE percorsi SET tipo=$3, n_sessioni_previste=$4, prezzo=$5, promo=$6,
              sconto_note=$7, data_inizio=$8, modalita=$9, prestazione_scambio=$10
         WHERE id=$1 AND client_id=$2`,
      [req.params.pid, req.params.id, tipo || 'Individuale', n_sessioni_previste || 8,
       prezzo, promo || false, sconto_note || '', data_inizio || null,
       modalita || 'Standard', prestazione]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Percorso non trovato' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[percorso/modifica]', err);
    res.status(500).json({ error: 'Modifica non riuscita: ' + err.message });
  }
});

// Chiude il percorso. `data_fine` nel corpo è FACOLTATIVA: la manda la proposta che
// nasce dall'approvazione di una Final (data della sessione). Senza, vale la data di
// oggi, come prima — chi chiama senza corpo si comporta esattamente come sempre.
router.post('/dashboard/clients/:id/percorsi/:pid/chiudi', requireCoach, express.json(), async (req, res) => {
  try {
    const d = req.body && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.data_fine || '')) ? req.body.data_fine : null;
    // ⭐ 0.3 — anche il cliente nel filtro: le rotte gemelle di modifica e
    // cancellazione lo avevano, questa no, e chiudeva il percorso di chiunque.
    const r = await db.query(
      "UPDATE percorsi SET stato='concluso', data_fine=COALESCE($3::date, data_fine, CURRENT_DATE) WHERE id=$1 AND client_id=$2",
      [req.params.pid, req.params.id, d]);
    if (!r.rowCount) return res.status(404).json({ error: 'Percorso non trovato in questa scheda.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/clients/:id/percorsi/:pid', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM percorsi WHERE id=$1 AND client_id=$2', [req.params.pid, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// ═══════════════════════════════════════════════════════
// SEDUTE (diario sessioni di coaching)
// La scheda = riepilogo salienti (testo unico Markdown). Ore automatiche per tipo
// (Intake 2h · Ongoing 1h · Final = inserita a mano). Quando un percorso ha sedute,
// ore_fatte e n_sessioni_fatte si ricalcolano dalla somma/conteggio delle sedute.
// ═══════════════════════════════════════════════════════

function normTipo(t) { return ['Intake', 'Ongoing', 'Final'].includes(t) ? t : 'Ongoing'; }

function oreForTipo(tipo, ore) {
  // Il valore esplicito (coach o automazione) ha SEMPRE la priorità: le ore per
  // tipo sono solo un default (es. Intake interrotto = 2h+1h, durata anomala…).
  if (ore !== undefined && ore !== null && String(ore).trim() !== '') {
    const n = parseFloat(String(ore).replace(',', '.'));
    if (!isNaN(n) && n >= 0) return n;
  }
  const auto = ORE_TIPO[tipo];
  return auto != null ? auto : 0;
}

async function recomputePercorso(pid) {
  // Le BOZZE (report automatici non ancora approvati) NON contano le ore/sessioni ICF.
  // Alle sessioni registrate si SOMMA sempre lo storico anteriore all'automazione
  // dei report (ore_storiche/sessioni_storiche, vedi db.js): quelle ore sono vere
  // ma non hanno una seduta che le documenti, e senza questa somma il ricalcolo
  // le cancellerebbe dall'Estratto ICF.
  await db.query(
    `UPDATE percorsi SET
       n_sessioni_fatte = COALESCE(sessioni_storiche, 0) + (SELECT COUNT(*)             FROM sedute WHERE percorso_id = $1 AND stato <> 'bozza'),
       ore_fatte        = COALESCE(ore_storiche, 0)      + (SELECT COALESCE(SUM(ore),0) FROM sedute WHERE percorso_id = $1 AND stato <> 'bozza')
     WHERE id = $1`, [pid]);
}

function sedutaFields(b) {
  b = b || {};
  const val = k => { const v = b[k]; return (v == null || String(v).trim() === '') ? null : String(v).trim(); };
  return {
    obiettivo: val('obiettivo'), argomenti: val('argomenti'), attivita: val('attivita'),
    scadenza: val('scadenza'), eseguita: val('eseguita'), note: val('note'),
    // L'ora del prossimo appuntamento: si accetta solo se è davvero un orario
    // (il campo del browser dà HH:MM; l'estrattore può scrivere "—").
    prossima_ora: /^\d{1,2}:\d{2}$/.test(String((b.prossima_ora || '')).trim()) ? String(b.prossima_ora).trim() : null,
  };
}

// Crea una seduta (riga della Scheda Cliente)
// ⭐ Fetta 4.2 (04/09/2026): LE ROTTE DELLE SEDUTE SONO SCRITTE UNA VOLTA. Prima
//    erano copiate: individuali (cliente) e collettive (percorso condiviso di un
//    progetto), e le copie avevano già divergito (il bug 0.3 nasceva qui). Ora
//    quattro gestori, ognuno registrato su due vie. L'unica differenza vera: una
//    seduta individuale porta il client_id, quella collettiva no (client_id NULL:
//    è del percorso condiviso). La via dice quale delle due è.
const collettiva = (req) => req.path.startsWith('/dashboard/progetti/');

async function rottaCreaSeduta(req, res) {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    const sid = uuidv4();
    await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, obiettivo, argomenti, attivita, scadenza, prossima_ora, eseguita, note, stato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [sid, req.params.pid, collettiva(req) ? null : req.params.id, t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note,
       // Una sessione con data nel futuro è FISSATA, non fatta: nasce in bozza, così
       // non conta ore né sessioni finché non avviene, e quando arriva il suo report
       // è questa riga a riempirsi (server/scan.js → rigaDaRiempire).
       // ⭐ 0.3 — la regola sta in sedute.js. (Prima la copia collettiva non
       //    passava lo stato e valeva il default 'confermata': una sessione di team
       //    fissata per il mese prossimo contava già ore e sessioni ICF.)
       sedute.statoDallaData(req.body.data, oggiIso())]
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true, id: sid });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
}
router.post('/dashboard/clients/:id/percorsi/:pid/sedute', requireCoach, express.json(), rottaCreaSeduta);
router.post('/dashboard/progetti/:id/percorsi/:pid/sedute', requireCoach, express.json(), rottaCreaSeduta);

// Modifica una seduta
async function rottaModificaSeduta(req, res) {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    await db.query(
      // ⭐ 0.3 — spostare la data ricalcola lo stato, ma SOLO su una riga scritta a
      // mano: una riga con un report dietro (source_file_id) sta in bozza perché
      // aspetta l'approvazione del coach, e correggerle la data non deve approvarla.
      // La regola è sedute.statoDopoModifica; qui è scritta in SQL per farla in un
      // colpo solo, senza rileggere la riga prima.
      `UPDATE sedute SET tipo=$1, data=$2, ore=$3, obiettivo=$4, argomenti=$5, attivita=$6, scadenza=$7, prossima_ora=$8, eseguita=$9, note=$10,
              stato = CASE WHEN source_file_id IS NULL THEN $13 ELSE stato END
       WHERE id=$11 AND percorso_id=$12`,
      [t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note, req.params.sid, req.params.pid,
       sedute.statoDallaData(req.body.data, oggiIso())]
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
}
router.post('/dashboard/clients/:id/percorsi/:pid/sedute/:sid', requireCoach, express.json(), rottaModificaSeduta);
router.post('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid', requireCoach, express.json(), rottaModificaSeduta);

// Elimina una seduta
async function rottaEliminaSeduta(req, res) {
  try {
    await db.query('DELETE FROM sedute WHERE id=$1 AND percorso_id=$2', [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
}
router.delete('/dashboard/clients/:id/percorsi/:pid/sedute/:sid', requireCoach, rottaEliminaSeduta);
router.delete('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid', requireCoach, rottaEliminaSeduta);

// Approva una BOZZA (report automatico rivisto dal coach): diventa 'confermata' e
// solo ora le ore/sessioni entrano nel conteggio ICF. Stessa proposta di chiusura
// nelle due pagine in cui vive.
async function rottaApprovaSeduta(req, res) {
  try {
    await db.query("UPDATE sedute SET stato='confermata' WHERE id=$1 AND percorso_id=$2",
      [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    res.json({ ok: true, ...await proponiChiusura(req.params.sid, req.params.pid) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
}
router.post('/dashboard/clients/:id/percorsi/:pid/sedute/:sid/approva', requireCoach, rottaApprovaSeduta);
router.post('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid/approva', requireCoach, rottaApprovaSeduta);

// Se la sessione appena approvata è una FINAL e il percorso risulta ancora attivo,
// dice alla pagina di PROPORRE la chiusura, con la data della Final (non quella di
// oggi: il percorso è finito il giorno dell'ultima sessione). Proposta, non
// automatismo: stato della relazione e stato del percorso restano cose distinte,
// è il coach a decidere. Se qualcosa non torna non propone nulla e tace.
async function proponiChiusura(sid, pid) {
  try {
    const r = await db.query(
      `SELECT s.tipo, s.data, p.stato
         FROM sedute s JOIN percorsi p ON p.id = s.percorso_id
        WHERE s.id = $1 AND s.percorso_id = $2`, [sid, pid]);
    const x = r.rows[0];
    if (!x || x.tipo !== 'Final' || x.stato !== 'attivo' || !x.data) return {};
    const iso = new Date(x.data).toISOString().slice(0, 10);
    return { proponiChiusura: true, dataFine: iso, dataFineIt: itDate(x.data) };
  } catch (err) { console.error('[proponiChiusura]', err); return {}; }
}

// Lancio MANUALE dell'automazione report→scheda (oltre al controllo automatico ogni
// 8h). Coach-only: legge i report nuovi da Drive e crea le bozze. client_id opzionale.
router.post('/dashboard/scan-drive', requireCoach, express.json(), async (req, res) => {
  try {
    // Fetta 2.2: anche la lettura dal pulsante lascia la sua riga (passata «manuale»).
    const r = await automazione.esegui('report-clienti (manuale)',
      () => scan.scanClientReports({ onlyClientId: (req.body && req.body.client_id) || undefined }));
    if (!r.ok) return res.status(500).json({ error: r.errore });
    res.json({ ok: true, ...r.out });
  } catch (err) { console.error('[scan-drive]', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// IL CONTRATTO — l'Hub lo costruisce da zero, lo mostra, e lo ALLEGA alla Mail 2.
//
// ⭐ Germano (09/08): «il contratto è una VISTA sui dati dell'Hub, non un foglio
//    da riempire». Quindi qui non si corregge niente: se un dato è sbagliato si
//    corregge DOVE VIVE (anagrafica o percorso) e si rigenera. Un secondo posto
//    dove scrivere il prezzo sarebbe un secondo posto dove sbagliarlo.
//
// 🔴 CAMBIATO IL 03/09/2026, e il motivo lo ha detto Germano provandolo:
//    «il contratto viene bene, ma una volta aperto non succede niente. Non si
//    salva, non si può inviare. L'ho salvato io sulla mia scrivania.»
//    Aveva ragione, ed era per costruzione: questa rotta apriva un'anteprima e
//    basta. Intanto la Mail 2 mandava sì un contratto, ma il MODELLO GENERICO
//    scaricato da Drive — non quello costruito per QUESTO cliente.
//    ➜ Adesso il contratto nasce in UN SOLO POSTO (le funzioni qui sotto) e da
//      lì lo prendono sia l'anteprima sia la Mail 2. Se fossero due strade, un
//      giorno manderemmo al cliente un documento diverso da quello guardato.
// ⭐ E la distinzione che ha sciolto il nodo, sempre sua: **il meccanismo è
//    lavoro nostro, i testi sono del commercialista e del legale.** Le due cose
//    erano rimaste legate insieme, e teneva fermo il lavoro sbagliato.
// ⚠️ La banda «BOZZA NON VALIDATA» resta un interruttore in `contratto.js`
//    (`BOZZA_NON_VALIDATA`): si spegne quando lo decide Germano, non è una
//    conseguenza tecnica di questa modifica.

/** Il PDF del contratto di un cliente individuale, già firmato da Germano. */
async function pdfContrattoCliente(cliente, percorso) {
  const trq = await db.query(
    'SELECT ordine, etichetta, importo, innesco, giorni FROM tranche_progetto WHERE percorso_id=$1 ORDER BY ordine',
    [percorso.id]
  );
  const blocchi = contrattoTesti.personaFisica({ cliente, percorso, rate: trq.rows });
  return contratto.costruisci(blocchi, { firmato: true });
}

/**
 * Il PDF dell'informativa privacy del cliente individuale.
 * 🔴 Il testo esisteva dal 27/08 (`letteraPrivacy`), ma NESSUNA pagina lo
 *    chiamava: l'unico a usarlo era lo script delle bozze per il commercialista.
 *    Germano il 03/09: «si dovrebbe creare in automatico anche la lettera per la
 *    privacy. Non è successo.» Non era rotta — non era mai stata attaccata a
 *    niente. ⭐ Una funzione senza chiamanti può essere morta o NON ANCORA NATA:
 *    qui era la seconda.
 */
async function pdfLetteraPrivacy() {
  return contratto.costruisci(contrattoTesti.letteraPrivacy(), { firmato: true });
}

/** Il nome del file che arriva al cliente. Niente caratteri che rompono la posta. */
const nomeFilePulito = (base, cliente) =>
  base + ' - ' + String(cliente.name || 'cliente').replace(/[^\w àèéìòù]/gi, '').trim() + '.pdf';

router.get('/dashboard/clients/:id/percorsi/:pid/contratto', requireCoach, async (req, res) => {
  try {
    // Le rate le legge `pdfContrattoCliente`, che è l'unico posto dove il
    // contratto nasce: leggerle anche qui vorrebbe dire due query per lo stesso
    // dato, e un giorno due risposte diverse.
    const [cq, pq] = await Promise.all([
      db.query('SELECT * FROM clients WHERE id=$1', [req.params.id]),
      db.query('SELECT * FROM percorsi WHERE id=$1 AND client_id=$2', [req.params.pid, req.params.id]),
    ]);
    const cliente = cq.rows[0];
    const percorso = pq.rows[0];
    if (!cliente || !percorso) return res.status(404).send('Cliente o percorso non trovato');

    // ⭐ Lo stesso identico PDF che allegherà la Mail 2: una strada sola.
    const pdf = await pdfContrattoCliente(cliente, percorso);
    // inline: si apre nel browser. È l'anteprima — si guarda PRIMA di mandare,
    // ed è il passo che ha senso tenere: si manda ciò che si è visto.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      'inline; filename="' + nomeFilePulito('Contratto', cliente) + '"');
    res.send(pdf);
  } catch (err) {
    console.error('[contratto]', err);
    res.status(500).send('Non sono riuscito a preparare il contratto: ' + err.message);
  }
});

// L'informativa privacy del cliente individuale — anteprima, come il contratto.
// Non dipende dal percorso: parla di come tratto i dati, non di quanto si paga.
router.get('/dashboard/clients/:id/lettera-privacy', requireCoach, async (req, res) => {
  try {
    const cq = await db.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    const cliente = cq.rows[0];
    if (!cliente) return res.status(404).send('Cliente non trovato');
    const pdf = await pdfLetteraPrivacy();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      'inline; filename="' + nomeFilePulito('Informativa privacy', cliente) + '"');
    res.send(pdf);
  } catch (err) {
    console.error('[lettera-privacy]', err);
    res.status(500).send("Non sono riuscito a preparare l'informativa: " + err.message);
  }
});

// L'agenda, per guardarla prima di mandarla. È lo stesso file che finisce in
// allegato: col nome del cliente già dentro.
// ⚠️ Per ora si prende dal modello e ci si scrive il nome; un giorno l'Hub la
//    genererà per intero (Germano, 03/09: «è un altro pezzo»).
router.get('/dashboard/clients/:id/agenda', requireCoach, async (req, res) => {
  try {
    const cq = await db.query('SELECT nome, name FROM clients WHERE id=$1', [req.params.id]);
    const row = cq.rows[0];
    if (!row) return res.status(404).send('Cliente non trovato');
    const nome = (row.nome && row.nome.trim()) || String(row.name || '').trim().split(/\s+/)[0];
    if (!nome) return res.status(400).send("Il cliente non ha un nome da scrivere sull'agenda.");
    const agenda = await documenti.generaAgenda({ nome });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Agenda di sessione.pdf"');
    res.send(agenda.bytes);
  } catch (err) {
    console.error('[agenda]', err);
    res.status(500).send("Non sono riuscito a preparare l'agenda: " + err.message);
  }
});

// ── I CONTRATTI DI UN PROGETTO ───────────────────────────────────────────
// Legge progetto, committente e partecipazioni. Il contratto del Committente
// sceglie da sé fra le due versioni confrontando quota_totale con
// quota_committente: nessuno digita una percentuale.
async function datiProgetto(progettoId) {
  const [pq, paq, peq, trq] = await Promise.all([
    db.query(`SELECT p.*, to_jsonb(c) AS committente
                FROM progetti p JOIN committenti c ON c.id = p.committente_id
               WHERE p.id = $1`, [progettoId]),
    db.query(`SELECT pa.id AS part_id, pa.quota_coachee, cl.*
                FROM partecipazioni pa JOIN clients cl ON cl.id = pa.client_id
               WHERE pa.progetto_id = $1
               ORDER BY cl.cognome NULLS LAST, cl.nome`, [progettoId]),
    // Fetta 5b — quante sessioni prevede il percorso. Serve ai contratti, che
    // fino al 29/08 non lo dicevano: il Committente leggeva «per un percorso
    // rivolto a 4 partecipanti» senza sapere di quante sedute.
    db.query(`SELECT pe.id, pe.client_id, pe.n_sessioni_previste,
                     cl.name, cl.nome, cl.cognome
                FROM percorsi pe LEFT JOIN clients cl ON cl.id = pe.client_id
               WHERE pe.progetto_id = $1
               ORDER BY cl.cognome NULLS LAST, cl.nome`, [progettoId]),
    // Fetta «tranche nel contratto» (30/08): il piano di CHI PAGA. Quello del
    // Committente ha `partecipazione_id` vuoto; ogni partecipante ha il suo.
    db.query(`SELECT id, partecipazione_id, ordine, etichetta, importo, innesco, giorni
                FROM tranche_progetto WHERE progetto_id = $1 ORDER BY ordine`, [progettoId]),
  ]);
  if (!pq.rows.length) return null;
  const progetto = pq.rows[0];
  const partecipanti = paq.rows;
  const percorsi = peq.rows;
  const sommaCoachee = partecipanti.reduce((s, x) => s + (Number(x.quota_coachee) || 0), 0);

  // ⭐ DUE FORME, e le separa la stessa cosa che separa tutto il resto: il
  //    percorso è UNO e condiviso (team/group), oppure è UNO PER PERSONA
  //    (individuale, individuale-multiplo). Il contratto le racconta diverse.
  // ⚠️ `null` quando il numero non c'è: un contratto non inventa un perimetro.
  const cond = percorsi.find(x => !x.client_id);
  const intero = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const sessioni = cond
    ? { condivise: intero(cond.n_sessioni_previste) }
    : { individuali: percorsi.filter(x => x.client_id).map(x => ({
        client_id: x.client_id,
        nome: (x.name || [x.nome, x.cognome].filter(Boolean).join(' ') || '').trim(),
        n: intero(x.n_sessioni_previste),
      })) };

  const rate = trq.rows;
  const rateCommittente = rate.filter(t => !t.partecipazione_id);
  const ratePartecipante = (partId) => rate.filter(t => t.partecipazione_id === partId);

  return { progetto, committente: progetto.committente || {}, partecipanti, sommaCoachee, percorsi, sessioni,
           rateCommittente, ratePartecipante };
}

// 🔴 IL GUARDIANO DELLE QUOTE. Senza, si stampa al Committente un contratto che
// dice «3.000 li mettono i partecipanti» e ai partecipanti contratti che ne
// sommano 2.800: due documenti firmati che si contraddicono, e nessuno se ne
// accorge finché non arriva la fattura. Il conto lo fa una funzione che
// nell'Hub esiste già (`fiscale.quoteProgetto`): non se ne scrive una seconda.
function quoteNonTornano(d) {
  if (d.progetto.quota_totale == null) return 'Il valore del progetto non è ancora stato impostato.';
  const q = fiscale.quoteProgetto({
    quota_totale: d.progetto.quota_totale,
    quota_committente: d.progetto.quota_committente,
    somma_coachee: d.sommaCoachee,
  });
  if (q.quadra) return null;
  return q.scarto > 0
    ? `Le quote non tornano: mancano € ${fiscale.euro(q.scarto)} all'appello fra la quota del Committente e quelle dei partecipanti.`
    : `Le quote non tornano: superano il valore del progetto di € ${fiscale.euro(-q.scarto)}.`;
}

router.get('/dashboard/progetti/:id/contratto', requireCoach, async (req, res) => {
  try {
    const d = await datiProgetto(req.params.id);
    if (!d) return res.status(404).send('Progetto non trovato');
    const guasto = quoteNonTornano(d);
    if (guasto) return res.status(400).send(guasto + ' Il contratto non viene preparato: correggi il piano e riprova.');
    const blocchi = contrattoTesti.personaGiuridica({
      committente: d.committente, progetto: d.progetto, nPartecipanti: d.partecipanti.length,
      sessioni: d.sessioni, rate: d.rateCommittente,
    });
    const pdf = await contratto.costruisci(blocchi, { firmato: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Contratto committente.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('[contratto-committente]', err);
    res.status(500).send('Non sono riuscito a preparare il contratto: ' + err.message);
  }
});

// Il contratto del PARTECIPANTE: esiste solo se una quota ce l'ha. Se il
// progetto è interamente a carico del Committente il partecipante non firma un
// contratto, firma la liberatoria privacy (Germano, 27/08).
router.get('/dashboard/progetti/:id/partecipanti/:partId/contratto', requireCoach, async (req, res) => {
  try {
    const d = await datiProgetto(req.params.id);
    if (!d) return res.status(404).send('Progetto non trovato');
    const pt = d.partecipanti.find(x => x.part_id === req.params.partId);
    if (!pt) return res.status(404).send('Partecipante non trovato in questo progetto');
    const quota = Number(pt.quota_coachee) || 0;
    if (quota <= 0) return res.status(400).send('Questo partecipante non ha una quota a proprio carico: quello che firma è l\'informativa privacy, non un contratto.');
    const guasto = quoteNonTornano(d);
    if (guasto) return res.status(400).send(guasto + ' Il contratto non viene preparato: correggi il piano e riprova.');
    // Quante sedute vede QUESTA persona: quelle del percorso condiviso se il
    // progetto è di gruppo, altrimenti quelle del suo percorso individuale.
    const suo = (d.sessioni.individuali || []).find(x => x.client_id === pt.id);
    const nSessioni = d.sessioni.condivise != null ? d.sessioni.condivise : (suo ? suo.n : null);
    const blocchi = contrattoTesti.partecipanteProgetto({
      cliente: pt, progetto: d.progetto, committente: d.committente, quota, nSessioni,
      rate: d.ratePartecipante(pt.part_id),
    });
    const pdf = await contratto.costruisci(blocchi, { firmato: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Contratto partecipante.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('[contratto-partecipante]', err);
    res.status(500).send('Non sono riuscito a preparare il contratto: ' + err.message);
  }
});

router.get('/dashboard/progetti/:id/partecipanti/:partId/liberatoria', requireCoach, async (req, res) => {
  try {
    const d = await datiProgetto(req.params.id);
    if (!d) return res.status(404).send('Progetto non trovato');
    const pt = d.partecipanti.find(x => x.part_id === req.params.partId);
    if (!pt) return res.status(404).send('Partecipante non trovato in questo progetto');
    const blocchi = contrattoTesti.liberatoriaPartecipante({
      progetto: d.progetto, committente: d.committente,
    });
    const pdf = await contratto.costruisci(blocchi, { firmato: true });
    // Il nome del file segue il documento: in un team/group non è più soltanto
    // un'informativa privacy, porta dentro le regole di riservatezza del gruppo.
    const collettivo = ['team', 'group'].includes(String(d.progetto.tipo || '').trim());
    const nomeFile = collettivo ? 'Informativa Privacy e Regole di Riservatezza.pdf' : 'Informativa privacy.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeFile}"`);
    res.send(pdf);
  } catch (err) {
    console.error('[liberatoria]', err);
    res.status(500).send('Non sono riuscito a preparare l\'informativa: ' + err.message);
  }
});

// Lancio MANUALE della lettura dei moduli (scheda anagrafica + contratto) su UN
// cliente. L'automazione la fa già da sé alle 07/15/23: questa serve quando la
// scheda è appena arrivata e non si vuole aspettare la passata successiva.
// Il motore è lo stesso: onlyClientId era già previsto, mancava solo chi lo chiama.
router.post('/dashboard/clients/:id/scan-moduli', requireCoach, express.json(), async (req, res) => {
  try {
    const out = await scanModuli.scanModuliClienti({ onlyClientId: req.params.id });
    res.json({ ok: true, ...out });
  } catch (err) { console.error('[scan-moduli-manuale]', err); res.status(500).json({ error: err.message }); }
});

// Reportistica A / mattone 3 — scan dei report di PROGETTO: legge le sottocartelle di fase
// (Pre-Intake/Intake/Kick-Off/Final Open/Final) e crea le righe-fase in bozza.
router.post('/dashboard/progetti/:id/scan-drive', requireCoach, express.json(), async (req, res) => {
  try {
    const out = await scan.scanProjectReports({ onlyProjectId: req.params.id });
    res.json({ ok: true, ...out });
  } catch (err) { console.error('[scan-progetto]', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
// Fetta B (Mattone 2) — SESSIONI COLLETTIVE (team/group). Le sedute del percorso CONDIVISO
// (client_id NULL) sono di proprietà del progetto: stesse operazioni della Scheda Cliente
// (crea/modifica/elimina/approva/scan) ma su rotte lato-progetto. Riusano recomputePercorso,
// sedutaFields, oreForTipo, normTipo. Le bozze non contano le ore ICF finché non approvate.
// ═══════════════════════════════════════════════════════
router.post('/dashboard/progetti/:id/scan-collettivo', requireCoach, express.json(), async (req, res) => {
  try {
    const out = await scan.scanCollectiveReports({ onlyProjectId: req.params.id });
    res.json({ ok: true, ...out });
  } catch (err) { console.error('[scan-collettivo]', err); res.status(500).json({ error: err.message }); }
});

// Crea una sessione collettiva (riga a mano). client_id NULL (proprietà del progetto).
// (le rotte delle sedute collettive stanno sopra, con le individuali: fetta 4.2)

// Chiudi/concludi il percorso CONDIVISO (team/group). Come l'individuale: una via, stato→concluso.
router.post('/dashboard/progetti/:id/percorsi/:pid/chiudi', requireCoach, express.json(), async (req, res) => {
  try {
    const d = req.body && /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.data_fine || '')) ? req.body.data_fine : null;
    await db.query(
      "UPDATE percorsi SET stato='concluso', data_fine=COALESCE($3::date, data_fine, CURRENT_DATE) WHERE id=$1 AND progetto_id=$2 AND client_id IS NULL",
      [req.params.pid, req.params.id, d]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MUOVERE LO STATO DI UNA BOZZA DI CONTRATTO — Fetta 6a (30/08).
// Una rotta sola per tutti e tre i tipi: cliente individuale, Committente,
// partecipante. Le parole degli stati e le transizioni stanno in
// `contratti-stato.js`, che è l'unico posto dove sono scritte.
//
// 🔴 «DA REDIGERE» È L'ASSENZA DELLA RIGA: la riga nasce al primo passo avanti.
// ⚠️ Il SOGGETTO si controlla che esista davvero prima di scrivere: senza,
//    bastava un identificativo inventato per creare stati di contratti che non
//    esistono, e quelli sarebbero poi comparsi nell'elenco di Amministrazione.
// ⚠️ Tornando a «da inviare» le due date si AZZERANO: il documento sta per
//    cambiare, quindi «inviato il 3 settembre» diventerebbe una data falsa
//    riferita a un foglio che nessuno ha più.
// ⛔ Fetta 0.5 (04/09/2026): IL PASSO LO VERIFICA IL SERVER. Fino al 03/09 la
//    rotta controllava che lo stato esistesse, non che il passaggio fosse
//    ammesso: da «da redigere» si poteva andare dritti ad «approvata» — cioè
//    congelare un progetto con una chiamata — e si poteva scrivere in tabella
//    «da_redigere», che per definizione è l'assenza della riga. Ora si accetta
//    solo il passo che AVANTI/INDIETRO prevedono da dove si sta (gli stessi
//    pulsanti che la cella mostra): `contrattiStato.passaggioAmmesso`.
//    ⚠️ La Mail 2 NON passa di qui: mandare è un fatto, e il fatto porta il
//       contratto a «in attesa» anche se nessuno ha premuto «l'ho preparata».
// ═══════════════════════════════════════════════════════════════════════════
router.post('/dashboard/contratti/stato', requireCoach, express.json(), async (req, res) => {
  const { tipo, soggetto_id: soggetto, stato } = req.body || {};
  const t = contrattiStato.TIPI[tipo];
  if (!t) return res.status(400).json({ error: 'Tipo di contratto sconosciuto.' });
  if (!contrattiStato.valido(stato)) return res.status(400).json({ error: 'Stato di contratto sconosciuto.' });
  if (!soggetto) return res.status(400).json({ error: 'Manca il soggetto del contratto.' });
  // Da quale tabella arriva il soggetto: è la stessa che la colonna referenzia.
  const TABELLA = { percorso_id: 'percorsi', progetto_id: 'progetti', partecipazione_id: 'partecipazioni' };
  try {
    const c = await db.query(`SELECT 1 FROM ${TABELLA[t.colonna]} WHERE id=$1`, [soggetto]);
    if (!c.rows.length) return res.status(404).json({ error: 'Il soggetto di questo contratto non esiste.' });

    // Da dove si sta: la riga, o la sua assenza («da redigere»).
    const cur = await db.query(`SELECT stato FROM contratti WHERE tipo=$1 AND ${t.colonna}=$2`, [tipo, soggetto]);
    const daStato = cur.rows.length ? cur.rows[0].stato : null;
    if (!contrattiStato.passaggioAmmesso(daStato, stato)) {
      return res.status(400).json({
        error: `Da «${contrattiStato.stato(daStato || 'da_redigere').label}» non si passa a «${contrattiStato.stato(stato).label}»: i passaggi si fanno uno alla volta, con i pulsanti della cella.`,
      });
    }

    const invio = stato === 'in_attesa' ? 'CURRENT_DATE' : (stato === 'da_inviare' ? 'NULL' : 'data_invio');
    const appr  = stato === 'approvata' ? 'CURRENT_DATE' : (stato === 'da_inviare' ? 'NULL' : 'data_approvazione');
    if (cur.rows.length) {
      // ⚠️ `AND stato=$4`: se nel frattempo qualcun altro l'ha mosso, il passo
      //    che avevamo verificato non vale più, e non si scrive.
      const agg = await db.query(
        `UPDATE contratti SET stato=$1, data_invio=${invio}, data_approvazione=${appr}, updated_at=NOW()
          WHERE tipo=$2 AND ${t.colonna}=$3 AND stato=$4`, [stato, tipo, soggetto, daStato]);
      if (!agg.rowCount) return res.status(409).json({ error: 'Lo stato del contratto è cambiato nel frattempo: ricarica la pagina.' });
    } else {
      await db.query(
        `INSERT INTO contratti (id, tipo, ${t.colonna}, stato, data_invio, data_approvazione)
         VALUES ($1,$2,$3,$4,${stato === 'in_attesa' ? 'CURRENT_DATE' : 'NULL'},${stato === 'approvata' ? 'CURRENT_DATE' : 'NULL'})`,
        [uuidv4(), tipo, soggetto, stato]);
    }
    res.json({ ok: true, stato });
  } catch (err) { console.error('[contratti/stato]', err); res.status(500).json({ error: 'Errore' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// IL CONGELAMENTO — Fetta 6b (30/08). Parole di Germano: «la firma del contratto
// congela tutte le caratteristiche del Progetto».
//
// ⭐ A congelare è SOLO il contratto del COMMITTENTE, e solo quando è
//    «approvata» — che vuol dire firmata dalla controparte, non approvata dal
//    coach. I contratti dei partecipanti hanno il loro stato e non bloccano
//    niente. Nei percorsi individuali il congelamento non esiste.
//
// 🔒 CHE COSA SI CONGELA: quello che finisce SCRITTO nel contratto — tipologia,
//    partecipanti, sessioni previste, valore e quote, parametri, data d'inizio,
//    e il piano delle tranche (Germano, 30/08: «deve essere nel contratto; se non
//    c'è è un errore» — il testo va ancora scritto, ma il dato è già suo).
// ✅ CHE COSA NON SI CONGELA: i FATTI. Registrare una seduta avvenuta, una fase
//    fatta, un pagamento ricevuto resta sempre possibile — quelli non cambiano
//    l'accordo, lo raccontano.
//
// ⛔ IL LUCCHETTO STA QUI, NON SUI PULSANTI. Nascondere un bottone lasciando
//    aperta la rotta non è un blocco: è un blocco per chi guarda.
// ↩️ Si riapre con «Modifica contratto approvato», che riporta a «da inviare».
// ═══════════════════════════════════════════════════════════════════════════
async function progettoCongelato(progettoId) {
  const r = await db.query(
    "SELECT 1 FROM contratti WHERE tipo='committente' AND progetto_id=$1 AND stato='approvata'", [progettoId]);
  return r.rows.length > 0;
}

/**
 * Risponde 409 e restituisce true se il progetto è congelato.
 * Chi la chiama deve fermarsi: `if (await bloccaSeCongelato(id, res)) return;`
 */
async function bloccaSeCongelato(progettoId, res) {
  if (!await progettoCongelato(progettoId)) return false;
  res.status(409).json({ error: 'Il contratto del Committente è firmato: le specifiche del progetto sono congelate. Per cambiarle usa «Modifica contratto approvato» nella card Contratti.' });
  return true;
}

/** Gli stati dei contratti di un progetto, pronti da mettere in pagina. */
async function statiContrattiProgetto(progettoId) {
  const r = await db.query(
    `SELECT tipo, progetto_id, partecipazione_id, stato FROM contratti
      WHERE progetto_id=$1
         OR partecipazione_id IN (SELECT id FROM partecipazioni WHERE progetto_id=$1)`, [progettoId]);
  const mappa = new Map();
  for (const c of r.rows) mappa.set(c.tipo + ':' + (c.progetto_id || c.partecipazione_id), c.stato);
  return mappa;
}

// ═══════════════════════════════════════════════════════════════════════════
// LA TIPOLOGIA DEL PROGETTO — Fetta 6b (30/08). Prima si cambiava solo
// dall'elenco progetti, un link lontano dalla pagina dove si lavora.
//
// 🔒 DUE LUCCHETTI, e il secondo è più severo del primo:
//  1. il CONGELAMENTO: contratto del Committente firmato → non si tocca più;
//  2. le SEDUTE: se ne esiste anche una sola, la tipologia è chiusa per sempre.
//     ⭐ Regola di Germano, 30/08: «non si può modificare da collettivo a
//       individuale un percorso già cominciato: è un caso impossibile».
//     Non è una cautela: cambiare tipologia cambia la STRUTTURA dei percorsi —
//     un team ha UN percorso condiviso con dentro le sedute, un
//     individuale-multiplo ne ha uno per persona. Lasciar passare il cambio
//     significherebbe abbandonare le sedute su un percorso che nessuno guarda
//     più. Le sedute sono lavoro vero: non si perdono.
// ⚠️ Il buco esisteva GIÀ, aperto, dall'elenco progetti: questa rotta e il
//    guardiano sulla rotta generale lo chiudono da tutte e due le parti.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/dashboard/progetti/:id/tipo', requireCoach, express.json(), async (req, res) => {
  const tipo = String((req.body && req.body.tipo) || '').trim();
  if (!TIPI_PROGETTO.includes(tipo)) return res.status(400).json({ error: 'Tipologia sconosciuta.' });
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    const pr = await db.query('SELECT tipo FROM progetti WHERE id=$1', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Progetto non trovato' });
    if (pr.rows[0].tipo === tipo) return res.json({ ok: true, invariato: true });
    const sed = await db.query(
      `SELECT count(*)::int AS n FROM sedute s
         JOIN percorsi p ON p.id = s.percorso_id WHERE p.progetto_id = $1`, [req.params.id]);
    if (sed.rows[0].n > 0) {
      return res.status(409).json({ error: `Il percorso è già cominciato: ci sono ${sed.rows[0].n} ${sed.rows[0].n === 1 ? 'sessione registrata' : 'sessioni registrate'}. La tipologia non si cambia più — cambierebbe la struttura dei percorsi e le sessioni resterebbero senza casa.` });
    }
    await db.query('UPDATE progetti SET tipo=$1, updated_at=NOW() WHERE id=$2', [tipo, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error('[progetti/tipo]', err); res.status(500).json({ error: 'Errore' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUANTE SESSIONI PREVEDE IL PERCORSO CONDIVISO — Fetta 4, punto 1 (29/08).
//
// 🔴 IL BUCO CHE CHIUDE. Il percorso condiviso di un progetto team/group nasce
//    così: `INSERT INTO percorsi (id, client_id, tipo, area, progetto_id, stato)`
//    — `n_sessioni_previste` non viene nemmeno passato, quindi prende il valore
//    di riserva del database, che è 8. E le uniche due righe che lo scrivevano
//    dopo stanno sotto /dashboard/clients/:id/… e finiscono con `AND client_id
//    = $2`, che su un percorso condiviso (client_id vuoto) non è mai vera.
//    ➜ Risultato in produzione: Flamingo dice «8 sessioni» non perché qualcuno
//      l'abbia deciso, ma perché nessuno l'ha mai potuto scegliere.
//    È la terza delle sette variabili di Germano, ed è il numero che alla Fetta
//    5b finisce dentro la frase del contratto: «un percorso di N sessioni».
//
// ⚠️ TOCCA UN CAMPO SOLO. `n_sessioni_fatte` e `ore_fatte` non si sfiorano: li
//    ricalcolano le sedute, e riscriverli da qui cancellerebbe ore vere. È la
//    stessa avvertenza che sta sulla rotta gemella dei percorsi individuali.
// ⚠️ Il filtro è quello già usato da «chiudi»: id + progetto + client_id VUOTO.
//    Così questa rotta non può toccare per sbaglio il percorso di un cliente.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/dashboard/progetti/:id/percorsi/:pid/previste', requireCoach, express.json(), async (req, res) => {
  const n = Number(req.body && req.body.n_sessioni_previste);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return res.status(400).json({ error: 'Il numero di sessioni previste dev\'essere un intero fra 1 e 100.' });
  }
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    const r = await db.query(
      'UPDATE percorsi SET n_sessioni_previste=$3 WHERE id=$1 AND progetto_id=$2 AND client_id IS NULL',
      [req.params.pid, req.params.id, n]);
    if (!r.rowCount) return res.status(404).json({ error: 'Percorso condiviso non trovato in questo progetto.' });
    res.json({ ok: true });
  } catch (err) { console.error('[previste]', err); res.status(500).json({ error: 'Errore' }); }
});

// ⛔ 03/09/2026 (fetta 0.3) — TOLTA `POST /api/sedute`, l'unica rotta senza login.
// Era il gancio pensato per un'automazione «da fuori» che non è mai nata: dal 9
// luglio l'automazione dei report gira DENTRO il server (scan.js), la chiave
// AUTOMATION_SECRET non è mai stata configurata su Railway e nessuno la chiamava
// nei due repository. Finché esisteva, bastava impostare quella chiave per creare
// sedute «confermate» senza report e senza controllare che il cliente fosse del
// percorso. (La prova viva controlla che risponda 404.)

// ⛔ 31/08 — TOLTE LE TRE ROTTE DEI PAGAMENTI A MANO (POST payments, /ricevuto,
// DELETE). Non erano raggiungibili da nessuna pagina: il pulsante «+ Pagamento»
// era già sparito il 15/08 su richiesta di Germano («qui non dovrebbe servire»),
// perché da quando ogni cifra concordata ha le sue rate non resta niente da
// segnare a mano. ⚠️ La TABELLA payments e le sue 7 righe NON si toccano: sono
// clienti veri (scambio servizi a 0,00 €) e la scheda cliente le mostra ancora,
// in sola lettura, sotto «Registrazioni di prima».
// ⛔ Non ricostruirle: lo stato dei soldi si ricava dai fatti, non da un
// interruttore acceso a mano.

// ═══════════════════════════════════════════════════════
// LEAD
// ═══════════════════════════════════════════════════════

router.get('/dashboard/leads', requireCoach, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM leads ORDER BY created_at DESC');
    res.send(leadsPage(result.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

router.post('/dashboard/leads', requireCoach, express.json(), async (req, res) => {
  const { nome, cognome, email, telefono, fonte, stato, note, data_prossimo_contatto } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obbligatorio' });
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO leads (id,nome,cognome,email,telefono,fonte,stato,note,data_prossimo_contatto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, nome.trim(), (cognome||'').trim(), (email||'').trim(), (telefono||'').trim(),
       fonte||'altro', stato||'nuovo', (note||'').trim(), data_prossimo_contatto||null]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/leads/:id', requireCoach, express.json(), async (req, res) => {
  const { nome, cognome, email, telefono, fonte, stato, note, data_prossimo_contatto } = req.body;
  try {
    await db.query(
      `UPDATE leads SET nome=$1,cognome=$2,email=$3,telefono=$4,fonte=$5,stato=$6,note=$7,
       data_prossimo_contatto=$8,updated_at=NOW() WHERE id=$9`,
      [nome, cognome||'', email||'', telefono||'', fonte||'altro', stato||'nuovo',
       note||'', data_prossimo_contatto||null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/leads/:id/convert', requireCoach, express.json(), async (req, res) => {
  try {
    const lr = await db.query('SELECT * FROM leads WHERE id=$1', [req.params.id]);
    const lead = lr.rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead non trovato' });
    // L'area arriva dal menù di conversione. La conversione la riceve come "ingrediente"
    // già pronto: oggi la sceglie il coach, domani la fonte può cambiare senza toccare qui.
    const ALLOWED_AREE = ['Personal', 'Business', 'Young'];
    const area = ALLOWED_AREE.includes(req.body.area) ? req.body.area : 'Personal';
    const clientId = uuidv4();
    const token    = uuidv4().replace(/-/g, '');
    const nome     = (lead.nome || '').trim();
    const cognome  = (lead.cognome || '').trim();
    const name     = [nome, cognome].filter(Boolean).join(' '); // display, tenuto in sync
    // Portiamo con noi nome/cognome + fonte e note del lead nel nuovo cliente.
    await db.query(
      `INSERT INTO clients (id,name,nome,cognome,email,telefono,area,fonte,note_preliminari,token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [clientId, name, nome, cognome, lead.email||'', lead.telefono||'', area, lead.fonte||'altro', lead.note||'', token]
    );
    await db.query("UPDATE leads SET stato='convertito',updated_at=NOW() WHERE id=$1", [lead.id]);
    // Cartelle Drive subito, nello stesso momento della conversione (chiude il doppio
    // passaggio). Stesso schema della creazione cliente: se Drive è giù il cliente resta
    // creato con drive_url vuoto e il coach può riprovare col pulsante nella scheda.
    let driveOk = false;
    try {
      const f = await drive.createClientFolders({ area, cognome, nome });
      await db.query('UPDATE clients SET drive_url=$1 WHERE id=$2', [f.url, clientId]);
      driveOk = true;
    } catch (e) {
      console.error('[drive] cartelle cliente da conversione fallite:', e.message);
    }
    res.json({ ok: true, clientId, token, driveOk });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore conversione' });
  }
});

router.delete('/dashboard/leads/:id', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// ═══════════════════════════════════════════════════════
// ESTRATTO ICF — log ore per la certificazione
// Un percorso = una riga. Le ore contano come "pagate" salvo modalità Pro bono
// (lo Scambio servizi vale come pagato per l'ICF). Vista + download CSV.
// ═══════════════════════════════════════════════════════

// Carica i percorsi con il cliente e calcola ore pagate/pro bono per ognuno,
// più i totali di riepilogo. Condiviso tra la pagina e l'export CSV.
// REGOLA DI CONTEGGIO (2026-07-29): entra nell'estratto solo un percorso con
// ALMENO UNA SESSIONE FATTA. Nessuna clausola sullo stato del percorso: le ore di
// un percorso interrotto sono state erogate davvero e valgono per la certificazione.
// Due modi di avere ore, ed entrambi contano:
//   • ore_fatte > 0 → comprende le ore scritte a mano (ore_storiche, pulsanti ✎ ore),
//     senza cui sparirebbero i percorsi storici (Sudano, Rappo, Ros);
//   • almeno una seduta CONFERMATA → copre la sessione appena registrata a 0 ore.
// Le sedute in bozza non contano (come ovunque nel conteggio ore).
// È sicura per i totali: un percorso a 0 ore aggiunge 0 a ogni somma, quindi
// togliendolo nessun numero cambia — si pulisce solo l'elenco dai gusci di prova.
async function loadIcf() {
  const result = await db.query(`
    SELECT p.*, c.name AS client_name, c.email, c.telefono
    FROM percorsi p
    JOIN clients c ON c.id = p.client_id
    -- ⚗️ Fetta 1.4: l'Estratto ICF non può contenere ore di persone inventate.
    WHERE ${collaudo.filtro('c')}
      AND (COALESCE(p.ore_fatte, 0) > 0
       OR EXISTS (SELECT 1 FROM sedute s WHERE s.percorso_id = p.id AND s.stato <> 'bozza'))
    ORDER BY c.name, p.data_inizio NULLS LAST, p.created_at
  `);
  const rows = result.rows.map(p => {
    const ore = Number(p.ore_fatte) || 0;
    const proBono = (p.modalita === 'Pro bono') ? ore : 0;   // Standard + Scambio servizi = pagate
    const pagate  = ore - proBono;
    const gruppo  = (p.tipo || 'Individuale') !== 'Individuale';
    return { ...p, ore, pagate, proBono, gruppo };
  });
  const clientiUnici = new Set(rows.map(r => r.client_id)).size;
  const tot = rows.reduce((a, r) => {
    a.ore += r.ore; a.pagate += r.pagate; a.proBono += r.proBono;
    if (r.gruppo) { a.gruppoN++; a.gruppoOre += r.ore; }
    else          { a.indivN++;  a.indivOre  += r.ore; }
    return a;
  }, { ore:0, pagate:0, proBono:0, indivN:0, indivOre:0, gruppoN:0, gruppoOre:0 });
  return { rows, tot, clientiUnici };
}

// RICERCA (fase 1c). Funzione trasversale: la casella vive nell'header, quindi
// si cerca da qualsiasi pagina. Sola lettura — nessuna scrittura, nessuna azione
// sui risultati: si guarda e si va alla scheda.
// Serve soprattutto da quando la home mostra in "Percorsi Individuali" solo chi
// ha percorsi fuori dai progetti: chi sta solo dentro un progetto si trova qui.
router.get('/dashboard/cerca', requireCoach, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.send(cercaPage(q, null, req));
  const like = `%${q}%`;
  try {
    const [clienti, committenti, progetti, leads] = await Promise.all([
      db.query(`SELECT id, name, nome, cognome, email, area, societa, stato_cliente
                  FROM clients
                 WHERE name ILIKE $1 OR nome ILIKE $1 OR cognome ILIKE $1
                    OR email ILIKE $1 OR societa ILIKE $1
                 ORDER BY cognome NULLS LAST, nome NULLS LAST, name LIMIT 30`, [like]),
      db.query(`SELECT id, denominazione, referente, ruolo, email, telefono, tipo
                  FROM committenti
                 WHERE denominazione ILIKE $1 OR referente ILIKE $1 OR email ILIKE $1
                 ORDER BY denominazione LIMIT 30`, [like]),
      db.query(`SELECT p.id, p.titolo, p.stato, p.area, p.tipo, k.denominazione
                  FROM progetti p JOIN committenti k ON k.id = p.committente_id
                 WHERE p.titolo ILIKE $1 OR k.denominazione ILIKE $1
                 ORDER BY p.titolo LIMIT 30`, [like]),
      db.query(`SELECT id, nome, cognome, email, telefono, stato
                  FROM leads
                 WHERE nome ILIKE $1 OR cognome ILIKE $1 OR email ILIKE $1
                 ORDER BY cognome NULLS LAST, nome LIMIT 30`, [like]),
    ]);
    res.send(cercaPage(q, {
      clienti: clienti.rows, committenti: committenti.rows,
      progetti: progetti.rows, leads: leads.rows,
    }, req));
  } catch (err) {
    console.error('[cerca]', err);
    res.status(500).send(cercaPage(q, { errore: true, clienti: [], committenti: [], progetti: [], leads: [] }, req));
  }
});

router.get('/dashboard/icf', requireCoach, async (req, res) => {
  try {
    const { rows, tot, clientiUnici } = await loadIcf();
    res.send(icfPage(rows, tot, clientiUnici, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento estratto ICF');
  }
});

router.get('/dashboard/icf/export.csv', requireCoach, async (req, res) => {
  try {
    const { rows, tot, clientiUnici } = await loadIcf();
    const cell = v => {
      const s = String(v == null ? '' : v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const line = arr => arr.map(cell).join(';');   // ';' → Excel IT apre in colonne
    const out = [];
    out.push(line(['Cliente', 'Contatto', 'Tipo', 'Modalità', 'Data inizio', 'Data fine', 'Ore pagate', 'Ore pro bono', 'Ore totali']));
    for (const r of rows) {
      out.push(line([
        r.client_name, r.email || r.telefono || '',
        r.tipo || 'Individuale', r.modalita || 'Standard',
        itDate(r.data_inizio), itDate(r.data_fine),
        fmtOre(r.pagate), fmtOre(r.proBono), fmtOre(r.ore),
      ]));
    }
    out.push('');
    out.push(line(['TOTALI', `${clientiUnici} clienti · ${rows.length} percorsi`, '', '', '', '', fmtOre(tot.pagate), fmtOre(tot.proBono), fmtOre(tot.ore)]));
    out.push(line(['Individuali', `${tot.indivN}`, '', '', '', '', '', '', fmtOre(tot.indivOre)]));
    out.push(line(['Gruppo', `${tot.gruppoN}`, '', '', '', '', '', '', fmtOre(tot.gruppoOre)]));
    const csv = '﻿' + out.join('\r\n');   // BOM → accenti corretti in Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="estratto-ICF-${dateIt.oggiRoma()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore export CSV');
  }
});

// ═══════════════════════════════════════════════════════
// COMMITTENTI / SPONSOR (Fase 1) — il terzo che commissiona/paga un percorso.
// Contatto a sé (azienda o persona). CRUD semplice, sul modello dei Lead.
// I collegamenti a clienti/progetti arrivano nelle fasi successive.
// ═══════════════════════════════════════════════════════

const TIPI_COMMITTENTE = ['azienda', 'persona'];

router.get('/dashboard/committenti', requireCoach, async (req, res) => {
  try {
    // `quota_totale` serve solo a decidere se mostrare il verdetto «pronto per
    // fatturare»: si segnala cosa manca a chi deve davvero pagare qualcosa,
    // non a un committente registrato per prova (stessa regola dei clienti).
    const result = await db.query(`
      SELECT c.*,
             COALESCE((SELECT SUM(p.quota_committente) FROM progetti p
                        WHERE p.committente_id = c.id), 0) AS quota_totale
        FROM committenti c
       ORDER BY c.denominazione`);
    res.send(committentiPage(result.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

// I dati fiscali di un committente, ripuliti (11/08). Una funzione sola per la
// creazione e per la modifica: se fossero due, prima o poi direbbero cose diverse.
// Un regime non previsto si salva vuoto invece di essere preso per buono: un
// valore inventato farebbe sbagliare la ritenuta senza che nessuno se ne accorga.
// La natura giuridica, se non indicata, la deduce dal tipo — che il committente ha
// già dal giorno uno — così non c'è niente da ricompilare.
function fiscaliCommittente(b, tipo) {
  const natura = ['persona_fisica', 'persona_giuridica'].includes(b.natura_giuridica)
    ? b.natura_giuridica
    : (tipo === 'persona' ? 'persona_fisica' : 'persona_giuridica');
  return [
    ['ordinario', 'forfettario'].includes(b.regime) ? b.regime : '',
    natura,
    (b.cap||'').trim(), (b.citta||'').trim(), (b.provincia||'').trim().toUpperCase(),
    (b.pec||'').trim(), (b.codice_sdi||'').trim().toUpperCase(),
    ((b.paese||'').trim().toUpperCase() || 'IT'),
    (b.identificativo_estero||'').trim().toUpperCase(),
  ];
}

router.post('/dashboard/committenti', requireCoach, express.json(), async (req, res) => {
  const { tipo, denominazione, referente, ruolo, email, telefono,
          codice_fiscale, partita_iva, indirizzo, note } = req.body;
  if (!denominazione || !denominazione.trim()) return res.status(400).json({ error: 'Denominazione obbligatoria' });
  const tipoOk = TIPI_COMMITTENTE.includes(tipo) ? tipo : 'azienda';
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO committenti (id,tipo,denominazione,referente,ruolo,email,telefono,
         codice_fiscale,partita_iva,indirizzo,note,
         regime,natura_giuridica,cap,citta,provincia,pec,codice_sdi,paese,identificativo_estero)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, tipoOk, denominazione.trim(),
       (referente||'').trim(), (ruolo||'').trim(), (email||'').trim(), (telefono||'').trim(),
       (codice_fiscale||'').trim(), (partita_iva||'').trim(), (indirizzo||'').trim(),
       (note||'').trim(), ...fiscaliCommittente(req.body, tipoOk)]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/committenti/:id', requireCoach, express.json(), async (req, res) => {
  const { tipo, denominazione, referente, ruolo, email, telefono,
          codice_fiscale, partita_iva, indirizzo, note } = req.body;
  if (!denominazione || !denominazione.trim()) return res.status(400).json({ error: 'Denominazione obbligatoria' });
  const tipoOk = TIPI_COMMITTENTE.includes(tipo) ? tipo : 'azienda';
  try {
    // `pec_sdi` non compare più: il vecchio campo unico resta nel database com'è,
    // non si aggiorna e non si cancella. Toglierlo dalla scrittura è quello che
    // impedisce a una modifica qualsiasi di svuotarlo.
    await db.query(
      `UPDATE committenti SET tipo=$1,denominazione=$2,referente=$3,ruolo=$4,email=$5,telefono=$6,
         codice_fiscale=$7,partita_iva=$8,indirizzo=$9,note=$10,
         regime=$11,natura_giuridica=$12,cap=$13,citta=$14,provincia=$15,
         pec=$16,codice_sdi=$17,paese=$18,identificativo_estero=$19,updated_at=NOW()
       WHERE id=$20`,
      [tipoOk, denominazione.trim(),
       (referente||'').trim(), (ruolo||'').trim(), (email||'').trim(), (telefono||'').trim(),
       (codice_fiscale||'').trim(), (partita_iva||'').trim(), (indirizzo||'').trim(),
       (note||'').trim(), ...fiscaliCommittente(req.body, tipoOk), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/committenti/:id', requireCoach, async (req, res) => {
  try {
    const used = await db.query('SELECT 1 FROM progetti WHERE committente_id=$1 LIMIT 1', [req.params.id]);
    if (used.rows.length) return res.status(409).json({ error: 'Ha progetti collegati: elimina o riassegna prima i progetti.' });
    await db.query('DELETE FROM committenti WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// ═══════════════════════════════════════════════════════
// AMMINISTRAZIONE (quarto mondo, 11/08) — prima pagina: le ANOMALIE.
//
// Chi non si può fatturare, e perché. È la sezione B della spec (§7.1), che
// nel report finale starà in cima: si sistemano prima le anomalie, poi si
// fattura. Qui vive da sola perché serve già adesso, mesi prima del report.
//
// ⚠️ Le tre query filtrano per SOLDI VERI (decisione B2 dell'11/08): solo
// clienti con un percorso a pagamento, solo committenti e progetti con una
// quota. Chi non ha niente da fatturare non ha niente da sistemare, e riempire
// la pagina di gusci di prova la renderebbe inutile.
// ═══════════════════════════════════════════════════════
router.get('/dashboard/amministrazione', requireCoach, async (req, res) => {
  try {
    const [cl, km, pj] = await Promise.all([
      db.query(`
        SELECT c.* FROM clients c
         WHERE EXISTS (SELECT 1 FROM percorsi p WHERE p.client_id = c.id AND p.prezzo > 0)
         ORDER BY c.cognome, c.nome`),
      db.query(`
        SELECT k.* FROM committenti k
         WHERE EXISTS (SELECT 1 FROM progetti p
                        WHERE p.committente_id = k.id AND p.quota_committente > 0)
         ORDER BY k.denominazione`),
      db.query(`
        SELECT p.id, p.titolo, p.quota_totale, p.quota_committente,
               (SELECT COALESCE(SUM(pa.quota_coachee), 0) FROM partecipazioni pa
                 WHERE pa.progetto_id = p.id) AS somma_coachee,
               (SELECT COUNT(*) FROM partecipazioni pa
                 WHERE pa.progetto_id = p.id) AS n_partecipanti
          FROM progetti p
         WHERE p.quota_totale > 0
         ORDER BY p.titolo`),
    ]);
    res.send(anomaliePage(
      fiscale.anomalie({ clienti: cl.rows, committenti: km.rows, progetti: pj.rows }),
      // ⚗️ Fetta 1.4: i conteggi non contano i record di collaudo; le righe restano.
      { nClienti: cl.rows.filter(x => x.di_collaudo !== true).length,
        nCommittenti: km.rows.filter(x => x.di_collaudo !== true).length,
        nProgetti: pj.rows.filter(x => x.di_collaudo !== true).length },
      req));
  } catch (err) {
    console.error('[anomalie]', err);
    res.status(500).send('Errore nel caricamento delle anomalie');
  }
});

// ── Le proforma (Fatturazione, Fase 3) ─────────────────
// Il prossimo progressivo dell'anno, letto DENTRO la transazione che lo scrive.
// Due richieste insieme leggerebbero lo stesso numero: la seconda si ferma sul
// vincolo UNIQUE(anno, progressivo) e la sua transazione torna indietro — è la
// stessa rete di prima, quando il numero lo componeva l'SQL.
async function prossimoProgressivo(q, anno) {
  const r = await q('SELECT COALESCE(MAX(progressivo), 0) + 1 AS n FROM proforme WHERE anno = $1::int', [anno]);
  return Number(r.rows[0].n);
}

/**
 * SALVA UNA PROFORMA — fetta 4.2 (04/09/2026). Era scritto due volte (sessioni di
 * un mese, rata di un piano) e le due copie divergevano. Documento e righe nascono
 * insieme o non nascono: senza le righe resterebbe un numero bruciato su un foglio
 * vuoto. Il progressivo si legge e si scrive nella stessa transazione, e il
 * vincolo UNIQUE(anno, progressivo) è la rete.
 * @param d           il documento composto da proforma.componiProforma
 * @param o.legame    da una riga composta a { seduta_id | tranche_id, percorso_id }
 */
async function salvaProforma(d, { anno, oggi, clientId = null, committenteId = null, progettoId = null, scadenza = null, legame }) {
  return db.transazione(async (q) => {
    const n = await prossimoProgressivo(q, anno);
    const ins = await q(`
      INSERT INTO proforme (id, numero, anno, progressivo, client_id, committente_id,
        progetto_id, data_emissione, periodo_da, periodo_a, categoria_fiscale,
        emittente_dati, destinatario_dati,
        imponibile, iva, ritenuta, bollo, totale_documento, da_pagare, scadenza)
      VALUES ($1, $19, $2::int, $20, $3, $4, $5,
             $6::date, $7::date, $8::date, $9, $10::jsonb, $11::jsonb,
             $12, $13, $14, $15, $16, $17, $18::date)
      RETURNING id, numero`,
      [uuidv4(), anno, clientId, committenteId, progettoId, oggi,
       d.periodoDa, d.periodoA, d.categoria,
       JSON.stringify(d.emittenteDati), JSON.stringify(d.destinatarioDati),
       d.conti.imponibile, d.conti.iva, d.conti.ritenuta, d.conti.bollo,
       d.conti.totaleDocumento, d.conti.daPagare, scadenza,
       proforma.numeroProforma(anno, n), n]);
    const pf = ins.rows[0];
    for (const r of d.righe) {
      const l = legame(r);
      await q(`INSERT INTO proforma_righe
        (id, proforma_id, seduta_id, tranche_id, percorso_id, data, descrizione, quantita, prezzo_unitario, importo, ordine)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [uuidv4(), pf.id, l.seduta_id || null, l.tranche_id || null, l.percorso_id || null, r.data, r.descrizione,
         r.quantita, r.prezzo_unitario, r.importo, r.ordine]);
    }
    return pf;
  });
}

// Una proforma raccoglie TUTTE le sessioni a pagamento non ancora chieste, non
// solo quelle di un mese (scelta di Germano): un mese rimasto indietro non deve
// sparire. Il perno è `proforma_righe.seduta_id` — una sessione che sta già in
// una proforma viva non compare più fra quelle da chiedere.
router.post('/dashboard/clients/:id/proforma', requireCoach, async (req, res) => {
  try {
    const [cl, em] = await Promise.all([
      db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]),
      db.query('SELECT * FROM emittente WHERE id = 1'),
    ]);
    const cliente = cl.rows[0];
    if (!cliente) return res.status(404).json({ error: 'Cliente non trovato' });
    const emittente = em.rows[0] || {};

    // Le sedute da chiedere: confermate, a pagamento, mai finite in una proforma
    // viva. `p.client_id = $1` lascia fuori i percorsi condivisi, i cui soldi
    // vivono sul progetto — è la stessa regola del maturato.
    const sed = await db.query(`
      SELECT s.id, s.data, s.tipo, s.percorso_id, p.prezzo
        FROM sedute s JOIN percorsi p ON p.id = s.percorso_id
       WHERE p.client_id = $1 AND s.stato = 'confermata' AND s.data IS NOT NULL
         AND p.modalita = 'Standard' AND p.prezzo > 0
         AND NOT EXISTS (
           SELECT 1 FROM proforma_righe r JOIN proforme pf ON pf.id = r.proforma_id
            WHERE r.seduta_id = s.id AND pf.stato <> 'annullata')
       ORDER BY s.data`, [req.params.id]);

    const righe = proforma.righeDaSedute(sed.rows);
    // ⭐ C3 — al modulo si passa il SOGGETTO già normalizzato, non il cliente:
    // così la stessa strada serve anche un committente (fiscale.daCommittente).
    const soggetto = fiscale.daCliente(cliente || {});
    const motivi = proforma.motiviCheImpediscono({ emittente, soggetto, righe });
    if (motivi.length) return res.status(400).json({ error: motivi.join(' ') });

    // ⭐ 4.3: il giorno ITALIANO, non quello di Greenwich (di notte è ancora ieri).
    const oggi = dateIt.oggiRoma();
    const d = proforma.componiProforma({ righe, soggetto, email: cliente.email,
      emittente, dataEmissione: oggi });
    if (!d.conti) return res.status(400).json({ error: 'Non si riesce a stabilire la categoria fiscale del cliente.' });
    const anno = Number(oggi.slice(0, 4));

    // Documento e righe nascono insieme o non nascono: senza le righe resterebbe
    // un numero bruciato su un foglio vuoto. Il progressivo si legge e si scrive
    // nella stessa transazione, e il vincolo UNIQUE(anno, progressivo) è la rete.
    // 🔴 Fetta 1.2 (04/09/2026): il numero lo compone `proforma.numeroProforma`,
    //    non più l'SQL con lpad(n, 3, '0') — che oltre 999 TRONCA (Postgres:
    //    lpad('1000', 3, '0') = '100'). La regola del numero sta in un posto solo,
    //    quello che `prova-proforma` copre già.
    // ⭐ C4 — la scadenza di un mese di sessioni è il giorno stesso: chi paga
    // per sé lo fa a RIMESSA DIRETTA (modello dei soldi, 10/08). Il promemoria
    // parte quindi da subito, ed è giusto così — non c'è nessun termine da
    // aspettare.
    const creata = await salvaProforma(d, { anno, oggi, clientId: cliente.id, scadenza: oggi,
      legame: r => ({ seduta_id: r.seduta_id, percorso_id: r.percorso_id }) });
    res.json({ ok: true, id: creata.id, numero: creata.numero });
  } catch (err) {
    console.error('[proforma/crea]', err);
    res.status(500).json({ error: 'Errore nella creazione della proforma' });
  }
});

// ── «CHIEDI QUESTA RATA» — fetta C3b (17/08/2026) ────────────────────────
// La stessa strada di sopra, ma il documento contiene UNA RATA invece delle
// sessioni di un mese. Chi la riceve dipende da chi paga, e sono tre casi:
//   · rata di un PACCHETTO        → la paga il cliente del percorso
//   · rata di una PARTECIPAZIONE  → la paga quel coachee
//   · rata senza partecipazione   → è del COMMITTENTE del progetto
// ⚠️ La cifra concordata cambia con il caso, e serve: è il denominatore della
// percentuale scritta sulla riga.
router.post('/dashboard/tranche/:id/proforma', requireCoach, async (req, res) => {
  try {
    const tr = await db.query(`
      SELECT t.*,
             pa.client_id      AS part_client_id, pa.quota_coachee,
             prj.id            AS prj_id,   prj.titolo AS prj_titolo,
             prj.quota_committente, prj.committente_id,
             prj.data_inizio   AS prj_inizio, prj.data_fine AS prj_fine,
             prj.data_meta     AS prj_meta,
             pc.id             AS perc_id,  pc.client_id AS perc_client_id,
             pc.prezzo         AS perc_prezzo,
             pc.data_inizio    AS perc_inizio, pc.data_fine AS perc_fine,
             pc.data_meta      AS perc_meta
        FROM tranche_progetto t
        LEFT JOIN partecipazioni pa ON pa.id = t.partecipazione_id
        LEFT JOIN progetti      prj ON prj.id = COALESCE(t.progetto_id, pa.progetto_id)
        LEFT JOIN percorsi      pc  ON pc.id = t.percorso_id
       WHERE t.id = $1`, [req.params.id]);
    const t = tr.rows[0];
    if (!t) return res.status(404).json({ error: 'Rata non trovata' });

    // ⭐ Una rata si chiede UNA volta sola, e non per una casella spuntata: si
    // guarda se sta già dentro una proforma viva. È la stessa regola delle
    // sessioni, e regala l'annullamento — annullata la proforma, la rata torna
    // da sola fra quelle da chiedere.
    const gia = await db.query(`
      SELECT pf.numero FROM proforma_righe r JOIN proforme pf ON pf.id = r.proforma_id
       WHERE r.tranche_id = $1 AND pf.stato <> 'annullata'`, [req.params.id]);
    if (gia.rows.length) {
      return res.status(400).json({
        error: 'Questa rata è già stata chiesta con la proforma n. ' + gia.rows[0].numero
             + '. Per rifarla, annulla quel documento.' });
    }
    if ((t.stato || 'da_chiedere') === 'incassata') {
      return res.status(400).json({ error: 'Questa rata risulta già incassata.' });
    }

    // Chi paga, quanto ha concordato, e di che cosa si parla.
    let clientId = null, committenteId = null, progettoId = t.prj_id || null;
    let quota = 0, titolo = '', periodo = {};
    // Le tre date da cui si conta la scadenza della rata (C4): sono quelle del
    // percorso per un pacchetto, quelle del progetto negli altri casi.
    let riferimento = {};
    if (t.perc_id) {
      clientId = t.perc_client_id;
      quota    = Math.round(Number(t.perc_prezzo) || 0);
      titolo   = 'Pacchetto di coaching';
      periodo  = { da: t.perc_inizio, a: t.perc_fine };
      riferimento = { data_inizio: t.perc_inizio, data_meta: t.perc_meta, data_fine: t.perc_fine };
      progettoId = null;
    } else if (t.part_client_id) {
      clientId = t.part_client_id;
      quota    = Math.round(Number(t.quota_coachee) || 0);
      titolo   = nomeProgetto(t.prj_titolo);
      periodo  = { da: t.prj_inizio, a: t.prj_fine };
      riferimento = { data_inizio: t.prj_inizio, data_meta: t.prj_meta, data_fine: t.prj_fine };
    } else {
      committenteId = t.committente_id;
      quota    = Math.round(Number(t.quota_committente) || 0);
      titolo   = nomeProgetto(t.prj_titolo);
      periodo  = { da: t.prj_inizio, a: t.prj_fine };
      riferimento = { data_inizio: t.prj_inizio, data_meta: t.prj_meta, data_fine: t.prj_fine };
    }

    const [dest, em] = await Promise.all([
      clientId
        ? db.query('SELECT * FROM clients WHERE id = $1', [clientId])
        : db.query('SELECT * FROM committenti WHERE id = $1', [committenteId]),
      db.query('SELECT * FROM emittente WHERE id = 1'),
    ]);
    const chiRiceve = dest.rows[0];
    if (!chiRiceve) return res.status(400).json({ error: 'Non si capisce a chi vada chiesta questa rata.' });
    const emittente = em.rows[0] || {};
    const soggetto = clientId ? fiscale.daCliente(chiRiceve) : fiscale.daCommittente(chiRiceve);

    const righe = proforma.righeDaTranche([t], { titolo, quota });
    const motivi = proforma.motiviCheImpediscono({ emittente, soggetto, righe,
      nienteDaChiedere: 'Questa rata non ha un importo.' });
    if (motivi.length) return res.status(400).json({ error: motivi.join(' ') });

    // ⭐ 4.3: il giorno ITALIANO, non quello di Greenwich (di notte è ancora ieri).
    const oggi = dateIt.oggiRoma();
    const d = proforma.componiProforma({ righe, soggetto, email: chiRiceve.email,
      emittente, dataEmissione: oggi, periodo });
    if (!d.conti) {
      return res.status(400).json({ error: 'Non si riesce a stabilire la categoria fiscale di chi deve pagare.' });
    }
    const anno = Number(oggi.slice(0, 4));
    // ⭐ C4 — la scadenza si congela nel documento: è il giorno da cui il
    // promemoria «verifica se è arrivato» comincia a chiedere. Per una rata è la
    // sua (innesco + giorni concordati); se quel giorno non si sa ancora — è il
    // caso di «metà percorso» senza data — resta vuota e si ripiegherà sul
    // giorno dell'invio, che è comunque un momento vero.
    const scadenza = tranche.scadenza(t, riferimento);

    const creata = await salvaProforma(d, { anno, oggi, clientId, committenteId, progettoId, scadenza,
      legame: r => ({ tranche_id: r.tranche_id, percorso_id: t.perc_id || null }) });
    res.json({ ok: true, id: creata.id, numero: creata.numero });
  } catch (err) {
    console.error('[proforma/rata]', err);
    res.status(500).json({ error: 'Errore nella creazione della proforma' });
  }
});

// «Progetto Flamingo Revolution», ma senza scrivere «Progetto» due volte se il
// titolo già comincia così.
function nomeProgetto(titolo) {
  const s = String(titolo || '').trim();
  if (!s) return 'Progetto';
  return /^progetto\b/i.test(s) ? s : 'Progetto ' + s;
}

// Il PDF si RIGENERA ogni volta dai dati congelati: non si conserva un file, e
// due stampe dello stesso documento sono identiche anche fra due anni.
router.get('/dashboard/proforma/:id/pdf', requireCoach, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM proforme WHERE id = $1', [req.params.id]);
    const pf = r.rows[0];
    if (!pf) return res.status(404).send('Proforma non trovata');
    const righe = await db.query(
      'SELECT * FROM proforma_righe WHERE proforma_id = $1 ORDER BY ordine', [pf.id]);
    const bytes = await proforma.generaPdf({ ...pf, righe: righe.rows });
    const nome = proforma.nomeFile(pf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      "inline; filename*=UTF-8''" + encodeURIComponent(nome));
    res.send(bytes);
  } catch (err) {
    console.error('[proforma/pdf]', err);
    res.status(500).send('Non si riesce a produrre il PDF: ' + err.message);
  }
});

// ── Il piano di pagamento del committente (12/08) ──────
// Si salva TUTTO IL PIANO in un colpo, non riga per riga: le tranche hanno senso
// solo insieme (devono sommare la quota concordata), e salvarne una alla volta
// vorrebbe dire lasciare il piano in stati che non tornano.
// ⭐ FETTA 0.1 (03/09/2026) — i documenti vivi che contengono le rate di un
// contenitore (progetto, pacchetto o partecipazione). Serve alle tre rotte del
// piano per sapere quali rate sono FERME: la regola sta in `tranche.riconcilia`,
// la mappa è la stessa che leggono le pagine (`incassi.mappaRate`).
async function documentiDelleRate(filtro, params) {
  const r = await db.query(`
    SELECT ${incassi.SQL_COLONNE}
      FROM proforma_righe r
      JOIN proforme pf ON pf.id = r.proforma_id
      JOIN tranche_progetto t ON t.id = r.tranche_id
     WHERE pf.stato <> 'annullata' AND ${filtro}`, params);
  return incassi.mappaRate(r.rows);
}

// Il messaggio comune alle tre rotte quando una rata ferma viene toccata.
const NOTA_RATE_FERME = ' Una rata già in un documento non si tocca: si cambiano le altre.'
  + ' (Se nella finestrella non la vedi bloccata, ricarica la pagina.)';

// Riscrive le rate LIBERE di un contenitore e lascia stare quelle FERME (al
// massimo ne aggiorna l'ordine). `inserisci(q, r)` è la INSERT di quella rotta.
async function riscriviRateLibere(q, dove, id, righe, esito, inserisci) {
  const idsFermi = esito.ferme.map(t => String(t.id));
  await q(`DELETE FROM tranche_progetto WHERE ${dove} = $1 AND NOT (id = ANY($2::text[]))`, [id, idsFermi]);
  for (const r of righe) {
    if (r.id && idsFermi.includes(String(r.id))) {
      await q('UPDATE tranche_progetto SET ordine = $2 WHERE id = $1', [r.id, r.ordine]);
    } else {
      await inserisci(q, r);
    }
  }
}

router.post('/dashboard/progetti/:id/piano', requireCoach, express.json(), async (req, res) => {
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    const b = req.body || {};
    const pr = await db.query('SELECT id, quota_committente FROM progetti WHERE id = $1', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Progetto non trovato' });
    const totale = Number(pr.rows[0].quota_committente) || 0;

    // ⭐ Dal 12/08 (secondo giro) il piano è di CHI PAGA: arriva un piano per il
    // committente e uno per ogni partecipante che ha una quota. Ognuno deve
    // sommare la SUA quota — un piano che torna sul totale ma non sul singolo
    // pagatore produrrebbe proforma sbagliate una per una.
    const quote = new Map();                 // partecipazione_id → quota
    const pq = await db.query(
      'SELECT id, quota_coachee FROM partecipazioni WHERE progetto_id = $1', [req.params.id]);
    pq.rows.forEach(r => quote.set(r.id, Number(r.quota_coachee) || 0));

    const piani = Array.isArray(b.piani) ? b.piani : [];
    const preparati = [];
    for (const pi of piani) {
      const pid = pi.partecipazione_id || null;
      const suo = pid === null ? totale : quote.get(pid);
      if (pid !== null && suo === undefined) {
        return res.status(400).json({ error: 'Un piano si riferisce a un partecipante che non è in questo progetto.' });
      }
      const righe = (Array.isArray(pi.righe) ? pi.righe : []).map((r, i) => ({
        // ⭐ 0.1 — l'id viaggia con la riga: è così che una rata ferma si riconosce.
        id: r.id ? String(r.id) : null,
        ordine: i,
        etichetta: String(r.etichetta || '').trim() || ('Tranche ' + (i + 1)),
        importo: Math.round(Number(r.importo) || 0),
        innesco: String(r.innesco || 'firma'),
        giorni: Math.round(Number(r.giorni) || 0),
        stato: tranche.STATI[r.stato] ? r.stato : 'da_chiedere',
        data_incasso: r.data_incasso || null,
      }));
      // Un pagatore senza quota non ha niente da pianificare: si salta invece di
      // pretendere un piano che sommi zero.
      if (!suo && !righe.length) continue;
      const guai = tranche.problemi(righe, suo);
      if (guai.length) {
        const chi = pid === null ? 'Committente' : 'Partecipante';
        return res.status(400).json({ error: chi + ': ' + guai.join(' ') });
      }
      preparati.push({ pid, righe });
    }

    const meta = String(b.data_meta || '').trim();
    const fine = String(b.data_fine || '').trim();
    const dataOk = d => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!dataOk(meta)) return res.status(400).json({ error: 'La data di metà percorso non è valida.' });
    if (!dataOk(fine)) return res.status(400).json({ error: 'La data di fine non è valida.' });

    // ⭐ 0.1 — le rate già in un documento (di QUALUNQUE pagatore del progetto:
    // questa rotta riscrive anche le rate dei partecipanti) devono arrivare
    // identiche, o il salvataggio si ferma qui, prima di toccare niente.
    const salvate = await db.query('SELECT * FROM tranche_progetto WHERE progetto_id = $1', [req.params.id]);
    const documenti = await documentiDelleRate('t.progetto_id = $1', [req.params.id]);
    const esito = tranche.riconcilia({ salvate: salvate.rows, documenti,
      righe: preparati.flatMap(pi => pi.righe) });
    if (esito.problemi.length) return res.status(400).json({ error: esito.problemi.join(' ') + NOTA_RATE_FERME });

    // Il piano si riscrive dentro una transazione: o c'è quello nuovo o resta
    // quello di prima, mai mezzo vecchio e mezzo nuovo. Le rate ferme non si
    // toccano (al massimo cambia il loro ordine).
    await db.transazione(async (q) => {
      await q('UPDATE progetti SET data_meta = $2, data_fine = $3, updated_at = NOW() WHERE id = $1',
        [req.params.id, meta || null, fine || null]);
      // Ogni riga si ricorda di che pagatore è, così una INSERT sola basta per tutti.
      const tutte = preparati.flatMap(pi => pi.righe.map(r => ({ ...r, pid: pi.pid })));
      await riscriviRateLibere(q, 'progetto_id', req.params.id, tutte, esito, (qq, r) =>
        qq(`INSERT INTO tranche_progetto
              (id, progetto_id, partecipazione_id, ordine, etichetta,
               importo, innesco, giorni, stato, data_incasso)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv4(), req.params.id, r.pid, r.ordine, r.etichetta,
           r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]));
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[piano]', err);
    res.status(500).json({ error: 'Errore nel salvataggio del piano' });
  }
});

// ── Il piano di pagamento di un PACCHETTO — fetta C (15/08) ──────────────
// Stessa idea della rotta qui sopra, su un contenitore diverso: qui il pagatore
// è uno solo (il cliente) e la cifra concordata è il prezzo del percorso, che in
// un Pacchetto è il TOTALE e non il prezzo di una sessione.
// ⚠️ Si salva anche il prezzo: nella finestrella è lo stesso campo su cui si
// controlla che le rate tornino, e farlo salvare altrove vorrebbe dire poter
// chiudere la finestrella con un piano che non torna più con la cifra.
router.post('/dashboard/percorsi/:id/piano', requireCoach, express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const pr = await db.query('SELECT id, modalita FROM percorsi WHERE id = $1', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Percorso non trovato' });
    if (pr.rows[0].modalita !== 'Pacchetto') {
      // Un percorso Standard si paga a sessione: un piano di rate lì dentro
      // sarebbe un secondo modo di dire quanto deve, e due modi litigano.
      return res.status(400).json({ error: 'Il piano a rate vale solo per i percorsi a Pacchetto.' });
    }

    const prezzo = Math.round(Number(b.prezzo) || 0);
    if (prezzo <= 0) return res.status(400).json({ error: 'Scrivi il prezzo del pacchetto.' });

    const righe = (Array.isArray(b.righe) ? b.righe : []).map((r, i) => ({
      id: r.id ? String(r.id) : null,   // ⭐ 0.1 — così una rata ferma si riconosce
      ordine: i,
      etichetta: String(r.etichetta || '').trim() || ('Rata ' + (i + 1)),
      importo: Math.round(Number(r.importo) || 0),
      innesco: String(r.innesco || 'firma'),
      giorni: Math.round(Number(r.giorni) || 0),
      stato: tranche.STATI[r.stato] ? r.stato : 'da_chiedere',
      data_incasso: r.data_incasso || null,
    }));
    // Le stesse regole delle rate di un progetto, dallo stesso modulo: un piano
    // che non somma la cifra concordata produrrebbe proforma sbagliate una per
    // una, senza che nessun documento sembri storto.
    const guai = tranche.problemi(righe, prezzo);
    if (guai.length) return res.status(400).json({ error: guai.join(' ') });

    const meta = String(b.data_meta || '').trim();
    const fine = String(b.data_fine || '').trim();
    const dataOk = d => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!dataOk(meta)) return res.status(400).json({ error: 'La data di metà percorso non è valida.' });
    if (!dataOk(fine)) return res.status(400).json({ error: 'La data di fine non è valida.' });

    // ⭐ 0.1 — le rate già in un documento devono arrivare identiche.
    const salvate = await db.query('SELECT * FROM tranche_progetto WHERE percorso_id = $1', [req.params.id]);
    const documenti = await documentiDelleRate('t.percorso_id = $1', [req.params.id]);
    const esito = tranche.riconcilia({ salvate: salvate.rows, documenti, righe });
    if (esito.problemi.length) return res.status(400).json({ error: esito.problemi.join(' ') + NOTA_RATE_FERME });

    await db.transazione(async (q) => {
      await q('UPDATE percorsi SET prezzo = $2, data_meta = $3, data_fine = $4 WHERE id = $1',
        [req.params.id, prezzo, meta || null, fine || null]);
      await riscriviRateLibere(q, 'percorso_id', req.params.id, righe, esito, (qq, r) =>
        qq(`INSERT INTO tranche_progetto
              (id, percorso_id, ordine, etichetta, importo, innesco, giorni, stato, data_incasso)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuidv4(), req.params.id, r.ordine, r.etichetta,
           r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]));
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[piano-percorso]', err);
    res.status(500).json({ error: 'Errore nel salvataggio del piano' });
  }
});

// ── Le rate di UN partecipante, dalla scheda del cliente (15/08) ─────────
// Germano: «gli importi dei clienti dei progetti andrebbero gestiti come i
// pacchetti dei percorsi singoli… una quota di un progetto costa come o più di
// un pacchetto». Ha ragione, ed è già così nel modello: la quota di un
// partecipante è già fatta di rate dal 12/08. Mancava solo la PORTA — dalla sua
// scheda si vedevano e non si toccavano.
// 🔴 PERCHÉ UNA ROTTA NUOVA E NON QUELLA DEL PROGETTO: quella riscrive il piano
// dell'INTERO progetto (`DELETE ... WHERE progetto_id`), quindi chiamarla con il
// solo partecipante cancellerebbe il piano del committente. Qui si tocca **solo**
// il pagatore nominato.
// ⚠️ La QUOTA non si cambia da qui: è un pezzo dell'aritmetica del progetto
// (totale = committente + partecipanti) e cambiarla da un'altra pagina lo
// farebbe smettere di quadrare senza che nessuno lo veda. Da qui si decide
// soltanto **in quante volte** si paga.
router.post('/dashboard/partecipazioni/:id/piano', requireCoach, express.json(), async (req, res) => {
  try {
    const suoProg = await db.query('SELECT progetto_id FROM partecipazioni WHERE id=$1', [req.params.id]);
    if (suoProg.rows.length && await bloccaSeCongelato(suoProg.rows[0].progetto_id, res)) return;
    const pa = await db.query(
      'SELECT id, progetto_id, quota_coachee FROM partecipazioni WHERE id = $1', [req.params.id]);
    if (!pa.rows.length) return res.status(404).json({ error: 'Partecipazione non trovata' });
    const quota = Math.round(Number(pa.rows[0].quota_coachee) || 0);
    if (quota <= 0) {
      return res.status(400).json({ error: 'Questa persona non ha ancora una quota: si scrive nel progetto.' });
    }

    const righe = (Array.isArray((req.body || {}).righe) ? req.body.righe : []).map((r, i) => ({
      id: r.id ? String(r.id) : null,   // ⭐ 0.1 — così una rata ferma si riconosce
      ordine: i,
      etichetta: String(r.etichetta || '').trim() || ('Rata ' + (i + 1)),
      importo: Math.round(Number(r.importo) || 0),
      innesco: String(r.innesco || 'firma'),
      giorni: Math.round(Number(r.giorni) || 0),
      stato: tranche.STATI[r.stato] ? r.stato : 'da_chiedere',
      data_incasso: r.data_incasso || null,
    }));
    const guai = tranche.problemi(righe, quota);
    if (guai.length) return res.status(400).json({ error: guai.join(' ') });

    // ⭐ 0.1 — le rate già in un documento devono arrivare identiche.
    const salvate = await db.query('SELECT * FROM tranche_progetto WHERE partecipazione_id = $1', [req.params.id]);
    const documenti = await documentiDelleRate('t.partecipazione_id = $1', [req.params.id]);
    const esito = tranche.riconcilia({ salvate: salvate.rows, documenti, righe });
    if (esito.problemi.length) return res.status(400).json({ error: esito.problemi.join(' ') + NOTA_RATE_FERME });

    await db.transazione(async (q) => {
      await riscriviRateLibere(q, 'partecipazione_id', req.params.id, righe, esito, (qq, r) =>
        qq(`INSERT INTO tranche_progetto
              (id, progetto_id, partecipazione_id, ordine, etichetta,
               importo, innesco, giorni, stato, data_incasso)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv4(), pa.rows[0].progetto_id, req.params.id, r.ordine, r.etichetta,
           r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]));
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[piano-partecipazione]', err);
    res.status(500).json({ error: 'Errore nel salvataggio del piano' });
  }
});

// Segnare una tranche incassata (o tornare indietro). È l'azione che prende il
// posto dell'interruttore «Incassato / Da incassare» che stava sull'intera
// quota: adesso lo stato è di ogni rata, non del pagatore.
// ⚠️ Si salva DA SOLA, senza passare dal «Salva il piano»: segnare un incasso è
// un gesto, non una modifica al piano.
router.post('/dashboard/tranche/:id/stato', requireCoach, express.json(), async (req, res) => {
  try {
    const stato = String((req.body || {}).stato || '');
    if (!tranche.STATI[stato]) return res.status(400).json({ error: 'Stato non valido' });
    // La data dell'incasso si scrive quando diventa incassata e si cancella se
    // si torna indietro: una data d'incasso su una rata non incassata sarebbe
    // una bugia che resta lì.
    // 🔴 15/08 — ADESSO LA DATA ARRIVA DA CHI SEGNA, non è più «oggi» d'ufficio.
    // Era `COALESCE(data_incasso, CURRENT_DATE)`: registrando un bonifico di tre
    // settimane prima, l'Hub scriveva oggi. Non è un dettaglio — è l'incasso a
    // far nascere la fattura (decisione 2 dell'11/08), quindi una data sbagliata
    // manda la fattura nel mese sbagliato. Se non la mandano, si ripiega su oggi
    // com'era: meglio una data che nessuna.
    const grezza = String((req.body || {}).data_incasso || '').slice(0, 10);
    const dataIncasso = /^\d{4}-\d{2}-\d{2}$/.test(grezza) ? grezza : null;
    const r = await db.query(
      `UPDATE tranche_progetto
          SET stato = $2,
              data_incasso = CASE WHEN $2 = 'incassata'
                                  THEN COALESCE($3::date, data_incasso, CURRENT_DATE)
                                  ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 RETURNING id`, [req.params.id, stato, dataIncasso]);
    if (!r.rows.length) return res.status(404).json({ error: 'Tranche non trovata' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[tranche/stato]', err);
    res.status(500).json({ error: "Errore nel salvataggio dello stato" });
  }
});

// ── L'appuntamento, scritto a mano (12/08) ─────────────
// Una riga per percorso: salvare è sempre un solo comando, senza il ramo
// «esiste o non esiste ancora?». Serve a due cose che prima non si potevano
// fare: spostare un incontro senza riscrivere il verbale di una sessione
// passata, e segnarne uno che dai report non arriverà mai (la sessione saltata).
//
// ⚠️ Data vuota NON è un errore: vuol dire «tolgo l'appuntamento», e resta
// scritto. Cancellare la riga invece farebbe riaffiorare quello del report.
router.post('/dashboard/percorsi/:pid/appuntamento', requireCoach, express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const data = String(b.data || '').trim();
    const ora  = String(b.ora || '').trim();
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ error: 'La data non è valida.' });
    }
    if (ora && !/^\d{1,2}:\d{2}$/.test(ora)) {
      return res.status(400).json({ error: "L'ora va scritta come 15:00." });
    }
    // Un'ora senza data non vuol dire niente, e in home non comparirebbe:
    // meglio dirlo che salvarla e lasciare il coach a chiedersi dov'è finita.
    if (!data && ora) {
      return res.status(400).json({ error: "Senza data l'ora non basta: scrivi il giorno." });
    }
    const p = await db.query('SELECT id, client_id FROM percorsi WHERE id = $1', [req.params.pid]);
    if (!p.rows.length) return res.status(404).json({ error: 'Percorso non trovato' });

    await db.query(`
      INSERT INTO appuntamenti (id, percorso_id, client_id, data, ora, origine, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'mano', NOW())
      ON CONFLICT (percorso_id) DO UPDATE
        SET data = EXCLUDED.data, ora = EXCLUDED.ora,
            origine = 'mano', updated_at = NOW()`,
      [uuidv4(), req.params.pid, p.rows[0].client_id, data || null, ora || null]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[appuntamento]', err);
    res.status(500).json({ error: "Errore nel salvataggio dell'appuntamento" });
  }
});

// ── Amministrazione → Proforma (Fase 3, Tappa 3) ───────
// La pagina è una SEQUENZA DI PASSAGGI, non un prospetto: chiedi → rileggi →
// manda. Qui si raccolgono i dati dei tre passaggi; a metterli in fila ci pensa
// `proformaPage()`.
router.get('/dashboard/amministrazione/proforma', requireCoach, async (req, res) => {
  try {
    const [daChiedere, emr, pfr] = await Promise.all([
      maturato.daChiedere(),
      db.query('SELECT * FROM emittente WHERE id = 1'),
      // ⭐ C3b — chi riceve NON è più per forza un cliente: una proforma di una
      // rata di progetto va al COMMITTENTE. Il nome si prende dalla fotografia
      // congelata dentro il documento, che è giusta per definizione e non
      // cambia se qualcuno si rinomina domani. `clients` resta solo per l'email
      // e per il link alla scheda.
      db.query(`SELECT pf.*,
                       COALESCE(pf.destinatario_dati->>'denominazione',
                                c.name, k.denominazione) AS cliente_nome,
                       COALESCE(c.di_collaudo, k.di_collaudo) AS di_collaudo,
                       COALESCE(c.email, k.email) AS cliente_email,
                       -- ⭐ C4 — quanto è stato incassato su ogni documento. Da
                       -- qui si ricava «saldata», che nessuno spunta a mano.
                       COALESCE((SELECT SUM(i.importo) FROM incassi i
                                  WHERE i.proforma_id = pf.id), 0) AS incassato
                  FROM proforme pf
                  LEFT JOIN clients c ON c.id = pf.client_id
                  LEFT JOIN committenti k ON k.id = pf.committente_id
                 ORDER BY pf.anno DESC, pf.progressivo DESC`),
    ]);
    const emittente = emr.rows[0] || {};

    // Le singole righe d'incasso servono ai due passaggi nuovi: si vede QUANDO
    // è arrivato ogni soldo e si può togliere quello sbagliato. Un acconto e il
    // saldo sono due righe, e devono restare due righe distinte.
    const inc = await db.query(
      'SELECT * FROM incassi ORDER BY data_incasso, created_at');
    const incPerProforma = new Map();
    for (const r of inc.rows) {
      if (!incPerProforma.has(r.proforma_id)) incPerProforma.set(r.proforma_id, []);
      incPerProforma.get(r.proforma_id).push(r);
    }
    for (const p of pfr.rows) p.incassi = incPerProforma.get(p.id) || [];

    // ⭐ 18/08 — LA RATA CHE IL DOCUMENTO CONTIENE, con le date da cui si conta
    // la sua scadenza. Serve ai documenti nati PRIMA di C4a, che la casella
    // `scadenza` ce l'hanno vuota: senza questo, una rata a 30 giorni sembrava
    // scaduta il giorno dell'invio (segnalato da Germano sulla 2026/002).
    const rate = await db.query(incassi.SQL_RATA_DEL_DOCUMENTO);
    incassi.conScadenza(pfr.rows, rate.rows);

    // ⭐ C3b — le righe servono al TESTO della mail: una proforma che chiede una
    // rata non parla di «sessioni», e il testo deve nominare la rata. Si caricano
    // solo per i documenti ancora da mandare, che sono gli unici con una
    // finestrella d'invio da riempire.
    const daMandareIds = pfr.rows.filter(proforma.daMandare).map(p => p.id);
    if (daMandareIds.length) {
      const rr = await db.query(
        `SELECT * FROM proforma_righe WHERE proforma_id = ANY($1::text[]) ORDER BY ordine`,
        [daMandareIds]);
      const perProforma = new Map();
      for (const r of rr.rows) {
        if (!perProforma.has(r.proforma_id)) perProforma.set(r.proforma_id, []);
        perProforma.get(r.proforma_id).push(r);
      }
      for (const p of pfr.rows) p.righe = perProforma.get(p.id) || [];
    }

    // Perché NON si può chiedere: la ragione si calcola con lo STESSO modulo che
    // usa la rotta di creazione, così la pagina non può promettere un pulsante
    // che poi il server rifiuta. Servono i clienti per intero (i dati fiscali).
    const ids = daChiedere.map(c => c.id);
    const cl = ids.length
      ? await db.query('SELECT * FROM clients WHERE id = ANY($1::text[])', [ids])
      : { rows: [] };
    const perId = new Map(cl.rows.map(c => [c.id, c]));
    for (const c of daChiedere) {
      c.motivi = proforma.motiviCheImpediscono({
        emittente, soggetto: fiscale.daCliente(perId.get(c.id) || {}),
        righe: new Array(c.nSessioni),
      });
    }
    res.send(proformaPage(daChiedere, pfr.rows, req));
  } catch (err) {
    console.error('[proforma/pagina]', err);
    res.status(500).send('Errore nel caricamento delle proforma');
  }
});

// ── Mandare la proforma al cliente ─────────────────────
// Azionata dalla finestrella «Rivedi e manda», sullo schema di Mail 1 e Mail 2:
// il coach vede destinatario, testo e allegato, e conferma. Qui non si decide
// niente — si manda quello che ha davanti.
//
// L'ORDINE CONTA, e non è casuale:
//   1. il PDF (se non esce, non è successo niente)
//   2. la mail (da qui in poi non si torna indietro)
//   3. lo stato nel database
//   4. la copia su Drive — che è un archivio, non l'originale
// ⚠️ Se il passo 4 fallisce la mail è già partita: dirlo e basta. Far fallire
// tutto direbbe al coach che non è partita, mentre il cliente ce l'ha già.
router.post('/dashboard/proforma/:id/invia', requireCoach, express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const to = String(b.to || '').trim();
    if (!to) return res.status(400).json({ error: 'Serve un indirizzo destinatario.' });

    const r = await db.query('SELECT * FROM proforme WHERE id = $1', [req.params.id]);
    const pf = r.rows[0];
    if (!pf) return res.status(404).json({ error: 'Proforma non trovata' });
    if (pf.stato === 'annullata') {
      return res.status(400).json({ error: 'Questa proforma è annullata: non si manda.' });
    }

    const righe = await db.query(
      'SELECT * FROM proforma_righe WHERE proforma_id = $1 ORDER BY ordine', [pf.id]);
    const bytes = await proforma.generaPdf({ ...pf, righe: righe.rows });
    const nome = proforma.nomeFile(pf);

    await mailer.sendMail({
      to,
      subject: b.subject || proforma.testoMail(pf, righe.rows).subject,
      text: b.body || proforma.testoMail(pf, righe.rows).body,
      attachments: [{ filename: nome, content: bytes, contentType: 'application/pdf' }],
    });

    await db.query(
      `UPDATE proforme SET stato = 'inviata', inviata_data = NOW(), inviata_a = $2
        WHERE id = $1`, [pf.id, to]);

    let driveErrore = null;
    try {
      const su = await proforma.archiviaSuDrive(pf, bytes);
      await db.query('UPDATE proforme SET drive_file_id = $2, drive_url = $3 WHERE id = $1',
        [pf.id, su.id, su.url]);
    } catch (e) {
      console.error('[proforma/invia/drive]', e);
      driveErrore = e.message;
    }
    res.json({ ok: true, to, allegato: nome, driveErrore });
  } catch (err) {
    console.error('[proforma/invia]', err);
    res.status(500).json({ error: "Non si riesce a mandare la proforma: " + err.message });
  }
});

// Riprovare la sola copia su Drive, quando la mail è partita e l'archivio no.
// Senza questo, l'unico modo di rimediare sarebbe rimandare la mail al cliente.
router.post('/dashboard/proforma/:id/drive', requireCoach, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM proforme WHERE id = $1', [req.params.id]);
    const pf = r.rows[0];
    if (!pf) return res.status(404).json({ error: 'Proforma non trovata' });
    const righe = await db.query(
      'SELECT * FROM proforma_righe WHERE proforma_id = $1 ORDER BY ordine', [pf.id]);
    const bytes = await proforma.generaPdf({ ...pf, righe: righe.rows });
    const su = await proforma.archiviaSuDrive(pf, bytes);
    await db.query('UPDATE proforme SET drive_file_id = $2, drive_url = $3 WHERE id = $1',
      [pf.id, su.id, su.url]);
    res.json({ ok: true, url: su.url });
  } catch (err) {
    console.error('[proforma/drive]', err);
    res.status(500).json({ error: 'Copia su Drive non riuscita: ' + err.message });
  }
});

// Annullare una proforma. Il documento NON si cancella e il suo numero NON si
// riusa: resta lì con scritto ANNULLATA, che è come funziona ogni numerazione di
// documenti. Quello che torna indietro sono le SESSIONI — tutte le query
// guardano `stato <> 'annullata'`, quindi tornano da sole fra quelle da chiedere,
// senza che nessuno debba spuntare niente.
router.post('/dashboard/proforma/:id/annulla', requireCoach, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE proforme SET stato = 'annullata' WHERE id = $1 AND stato <> 'annullata'
       RETURNING numero`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Proforma non trovata, o già annullata' });
    res.json({ ok: true, numero: r.rows[0].numero });
  } catch (err) {
    console.error('[proforma/annulla]', err);
    res.status(500).json({ error: "Errore nell'annullamento" });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ⭐ FETTA C4 (18/08/2026) — L'INCASSO
// L'unico gesto che resta a un umano in tutta la catena: dire che i soldi sono
// arrivati. L'Hub non vede la banca. Tutto il resto — «chiesta», «incassata» —
// si ricava dai fatti e non si spunta.
// ══════════════════════════════════════════════════════════════════════════

// Quello che serve per decidere se un documento è saldato: quanto c'era da
// pagare e quanto è già stato registrato sopra.
async function documentoConIncassi(id) {
  const r = await db.query(`
    SELECT pf.*,
           COALESCE((SELECT SUM(i.importo) FROM incassi i WHERE i.proforma_id = pf.id), 0) AS incassato
      FROM proforme pf WHERE pf.id = $1`, [id]);
  return r.rows[0] || null;
}

router.post('/dashboard/proforma/:id/incasso', requireCoach, express.json(), async (req, res) => {
  try {
    const pf = await documentoConIncassi(req.params.id);
    if (!pf) return res.status(404).json({ error: 'Proforma non trovata' });
    if (pf.stato === 'annullata') {
      return res.status(400).json({ error: 'Questa proforma è annullata: non ci si registrano incassi.' });
    }
    // ⚠️ Un documento mai spedito non può essere stato pagato: se è arrivato un
    // soldo su una proforma ferma, è la proforma a essere in errore, non
    // l'incasso. Dirlo qui evita di scoprirlo fra due mesi guardando i conti.
    if (pf.stato !== 'inviata') {
      return res.status(400).json({ error: 'Questa proforma non è ancora stata mandata: prima si manda, poi si incassa.' });
    }
    const b = req.body || {};
    const importo = Math.round((Number(b.importo) || 0) * 100) / 100;
    const data = String(b.data_incasso || '').slice(0, 10);
    const manca = incassi.residuo(pf);
    const problemi = incassi.problemi({ importo, data, residuo: manca });
    if (problemi.length) return res.status(400).json({ error: problemi.join(' ') });

    await db.query(
      `INSERT INTO incassi (id, proforma_id, importo, data_incasso) VALUES ($1,$2,$3,$4::date)`,
      [uuidv4(), pf.id, importo, data]);

    // Si risponde con com'è messo ADESSO il documento: la pagina non deve
    // rifare il conto per conto suo, o prima o poi lo farebbe in modo diverso.
    const dopo = await documentoConIncassi(pf.id);
    res.json({
      ok: true,
      saldata: incassi.saldata(dopo),
      residuo: incassi.residuo(dopo),
      numero: pf.numero,
    });
  } catch (err) {
    console.error('[proforma/incasso]', err);
    res.status(500).json({ error: "Errore nella registrazione dell'incasso" });
  }
});

// Togliere un incasso sbagliato (data o importo). Non si «corregge»: si toglie e
// si rimette. Un incasso è un fatto, e un fatto o c'è o non c'è.
// ⭐ Tolto l'ultimo, il documento torna da sé fra quelli in attesa e la rata
// dentro torna «Chiesta»: nessuno stato da rimettere a posto a mano.
router.post('/dashboard/incassi/:id/togli', requireCoach, async (req, res) => {
  try {
    const r = await db.query('DELETE FROM incassi WHERE id = $1 RETURNING proforma_id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Incasso non trovato' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[incassi/togli]', err);
    res.status(500).json({ error: "Errore nel togliere l'incasso" });
  }
});

// Il numero della fattura emessa a mano in SuperBill. Finché non c'è, il
// documento saldato resta nella fila «da fatturare» — è quello che impedisce a
// un incasso di finire in un vicolo cieco.
// ⚠️ Si può anche CANCELLARE (campo vuoto): se lo scrivi sbagliato devi poterlo
// disfare, altrimenti la riga esce dalla fila con un numero che non esiste.
router.post('/dashboard/proforma/:id/fattura', requireCoach, express.json(), async (req, res) => {
  try {
    const numero = String((req.body || {}).numero || '').trim();
    const r = await db.query(
      `UPDATE proforme
          SET fattura_numero = $2,
              fattura_data = CASE WHEN $2::text IS NULL THEN NULL
                                  ELSE COALESCE(fattura_data, CURRENT_DATE) END
        WHERE id = $1 RETURNING numero`,
      [req.params.id, numero || null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Proforma non trovata' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[proforma/fattura]', err);
    res.status(500).json({ error: 'Errore nel salvataggio del numero di fattura' });
  }
});

// ── Chi emette (Fatturazione, Fase 3) ──────────────────
// La riga è UNA sola e nasce vuota con la migrazione: qui non si crea e non si
// cancella niente, si legge e si riscrive sempre quella.
const CAMPI_EMITTENTE = [
  'denominazione', 'nome', 'cognome', 'partita_iva', 'codice_fiscale', 'regime',
  'ateco', 'via', 'cap', 'citta', 'provincia', 'paese', 'iban', 'intestatario',
  'banca', 'email', 'telefono',
];

// ═══════════════════════════════════════════════════════════════════════════
// AMMINISTRAZIONE → CONTRATTI — Fetta 6a (30/08). Idea di Germano: «il posto più
// sensato sarebbe averle in amministrazione, è lì che dovrei avere tutto sotto
// controllo».
// ⭐ DUE ELENCHI SEPARATI, come ha chiesto lui: i percorsi singoli da una parte,
//    i progetti strutturati dall'altra. Sono due mestieri diversi e mescolarli
//    farebbe un elenco che non si legge.
// ⚠️ Qui si GUARDA. Lo stato si cambia dove il contratto si fa — la scheda del
//    cliente o la card del progetto — accanto al pulsante che genera il PDF.
// 🔴 «Da redigere» non sta nel database: è l'assenza della riga. Per questo si
//    parte dai SOGGETTI (percorsi, progetti, partecipazioni) e i contratti si
//    agganciano con un LEFT JOIN. Partendo dai contratti si vedrebbero solo
//    quelli già mossi — cioè si perderebbe di vista proprio quello che manca.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dashboard/amministrazione/contratti', requireCoach, async (req, res) => {
  try {
    const [singoli, progetti, partecipanti] = await Promise.all([
      db.query(`
        SELECT p.id AS percorso_id, p.tipo, p.stato AS stato_percorso, p.prezzo,
               cl.id AS client_id, cl.name, cl.consenso_privacy,
               c.stato AS stato_contratto
          FROM percorsi p
          JOIN clients cl ON cl.id = p.client_id
          LEFT JOIN contratti c ON c.tipo = 'cliente' AND c.percorso_id = p.id
         WHERE p.progetto_id IS NULL
         ORDER BY cl.cognome NULLS LAST, cl.nome, p.data_inizio DESC NULLS LAST`),
      db.query(`
        SELECT pr.id AS progetto_id, pr.titolo, pr.stato AS stato_progetto, pr.tipo,
               k.denominazione, c.stato AS stato_contratto
          FROM progetti pr
          JOIN committenti k ON k.id = pr.committente_id
          LEFT JOIN contratti c ON c.tipo = 'committente' AND c.progetto_id = pr.id
         ORDER BY pr.titolo`),
      db.query(`
        SELECT pa.id AS part_id, pa.progetto_id, pa.quota_coachee,
               cl.id AS client_id, cl.name, cl.consenso_privacy,
               c.stato AS stato_contratto
          FROM partecipazioni pa
          JOIN clients cl ON cl.id = pa.client_id
          LEFT JOIN contratti c ON c.tipo = 'partecipante' AND c.partecipazione_id = pa.id
         ORDER BY cl.cognome NULLS LAST, cl.nome`),
    ]);
    res.send(contrattiAmmPage(singoli.rows, progetti.rows, partecipanti.rows, req, req.query.tutti === '1'));
  } catch (err) {
    console.error('[amm/contratti]', err);
    res.status(500).send('Errore nel caricamento dei contratti');
  }
});

router.get('/dashboard/amministrazione/emittente', requireCoach, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM emittente WHERE id = 1');
    const e = r.rows[0] || {};
    res.send(emittentePage(e, fiscale.datiMancantiEmittente(e), !!req.query.salvato, req));
  } catch (err) {
    console.error('[emittente]', err);
    res.status(500).send('Errore nel caricamento dei dati di chi emette');
  }
});

router.post('/dashboard/amministrazione/emittente', requireCoach, express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    // L'elenco dei campi è scritto una volta sola e vale sia per il SET sia per i
    // valori: così aggiungerne uno domani non lascia indietro metà istruzione.
    const set = CAMPI_EMITTENTE.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const valori = CAMPI_EMITTENTE.map(c => String(b[c] == null ? '' : b[c]).trim() || null);
    await db.query(`UPDATE emittente SET ${set}, updated_at = NOW() WHERE id = 1`, valori);
    res.json({ ok: true });
  } catch (err) {
    console.error('[emittente/salva]', err);
    res.status(500).json({ error: 'Errore nel salvataggio' });
  }
});

// ═══════════════════════════════════════════════════════
// PROGETTI (Fase 2) — il percorso commissionato da un committente.
// In Business / Young-con-sponsor il progetto È il lead (nasce in pre-intake).
// I coachee si agganciano in Fase 3 (con le quote).
// ═══════════════════════════════════════════════════════

const AREE_PROGETTO  = ['Business', 'Young'];

const TIPI_PROGETTO  = ['individuale', 'individuale-multiplo', 'team', 'group'];

// Stato del progetto = stato della relazione (come per il cliente individuale).
const STATI_PROGETTO = ['attivo', 'in pausa', 'concluso'];

router.get('/dashboard/progetti', requireCoach, async (req, res) => {
  try {
    const progetti = await db.query(`
      SELECT p.*, c.denominazione AS committente_nome,
        (SELECT count(*) FROM partecipazioni pa WHERE pa.progetto_id = p.id) AS n_coachee
      FROM progetti p JOIN committenti c ON c.id = p.committente_id
      ORDER BY p.created_at DESC`);
    const committenti = await db.query('SELECT id, denominazione FROM committenti ORDER BY denominazione');
    res.send(progettiPage(progetti.rows, committenti.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

router.post('/dashboard/progetti', requireCoach, express.json(), async (req, res) => {
  const { committente_id, titolo, area, tipo, stato, obiettivi, note, data_inizio,
          referente_modo, referente_nome, referente_ruolo, referente_email } = req.body;
  if (!committente_id) return res.status(400).json({ error: 'Committente obbligatorio' });
  if (!titolo || !titolo.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
  const refModo  = referente_modo === 'altra' ? 'altra' : 'sponsor';
  const refNome  = refModo === 'altra' ? (referente_nome||'').trim()  : '';
  const refRuolo = refModo === 'altra' ? (referente_ruolo||'').trim() : '';
  const refEmail = refModo === 'altra' ? (referente_email||'').trim() : '';
  try {
    const c = await db.query('SELECT denominazione FROM committenti WHERE id=$1', [committente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Committente non valido' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO progetti (id,committente_id,titolo,area,tipo,stato,obiettivi,note,data_inizio,referente_modo,referente_nome,referente_ruolo,referente_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, committente_id, titolo.trim(),
       AREE_PROGETTO.includes(area) ? area : 'Business',
       TIPI_PROGETTO.includes(tipo) ? tipo : 'individuale',
       STATI_PROGETTO.includes(stato) ? stato : 'attivo',
       (obiettivi||'').trim(), (note||'').trim(), data_inizio||null,
       refModo, refNome, refRuolo, refEmail]
    );
    // Cartelle Drive automatiche del progetto. Se Drive fallisce, il progetto resta creato
    // lo stesso (drive_url vuoto): il coach riprova col pulsante «🔄 Crea cartelle Drive»
    // nella pagina del progetto. Mirror del comportamento del cliente.
    let driveOk = false;
    try {
      const f = await drive.createProjectFolders({ committente: c.rows[0].denominazione, titolo: titolo.trim() });
      await db.query('UPDATE progetti SET drive_url=$1 WHERE id=$2', [f.url, id]);
      driveOk = true;
    } catch (e) {
      console.error('[drive] creazione cartelle progetto fallita:', e.message);
    }
    res.json({ ok: true, id, driveOk });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Crea (o ripristina) le cartelle Drive di un progetto esistente. Usato dal pulsante nella
// pagina quando drive_url è vuoto (progetti nati prima di questa funzione, es. Flamingo).
// Non tocca chi ha già un link, per non fare doppioni.
router.post('/dashboard/progetti/:id/drive-folders', requireCoach, async (req, res) => {
  try {
    const pr = await db.query(
      `SELECT p.titolo, p.drive_url, c.denominazione AS committente_nome
         FROM progetti p JOIN committenti c ON c.id = p.committente_id WHERE p.id=$1`,
      [req.params.id]
    );
    const p = pr.rows[0];
    if (!p) return res.status(404).json({ error: 'Progetto non trovato' });
    if (p.drive_url && p.drive_url.trim()) {
      return res.status(400).json({ error: 'Questo progetto ha già una cartella Drive.' });
    }
    const f = await drive.createProjectFolders({ committente: p.committente_nome, titolo: p.titolo });
    await db.query('UPDATE progetti SET drive_url=$1 WHERE id=$2', [f.url, req.params.id]);
    res.json({ ok: true, drive_url: f.url });
  } catch (e) {
    console.error('[drive] cartelle progetto:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Fetta B / Mattone 1 — crea la cartella Drive del PERCORSO CONDIVISO (team/group) dentro
// la cartella del progetto: {Progetto}/Percorso {Team|Group}/{Intake,Ongoing,Final}. È la
// casa dei report delle sessioni collettive (da lì leggerà l'automazione, Mattone 2). Se il
// progetto non ha ancora la sua cartella, la crea prima. Idempotente: se il percorso ha già
// un drive_url, non fa doppioni. Pulsante sulla card "Percorsi" della pagina progetto.
router.post('/dashboard/progetti/:id/percorsi/:pid/drive-folders', requireCoach, async (req, res) => {
  try {
    const pr = await db.query(
      `SELECT p.titolo, p.drive_url, c.denominazione AS committente_nome
         FROM progetti p JOIN committenti c ON c.id = p.committente_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!pr.rows.length) return res.status(404).json({ error: 'Progetto non trovato' });
    const prog = pr.rows[0];

    const pc = await db.query(
      'SELECT id, tipo, drive_url FROM percorsi WHERE id=$1 AND progetto_id=$2 AND client_id IS NULL',
      [req.params.pid, req.params.id]
    );
    if (!pc.rows.length) return res.status(404).json({ error: 'Percorso condiviso non trovato' });
    if (pc.rows[0].drive_url && pc.rows[0].drive_url.trim()) {
      return res.json({ ok: true, drive_url: pc.rows[0].drive_url, already: true });
    }

    // La cartella del progetto deve esistere: se manca (progetto vecchio), creala prima.
    let projFolderId = drive.folderIdFromUrl(prog.drive_url);
    if (!projFolderId) {
      const pf = await drive.createProjectFolders({ committente: prog.committente_nome, titolo: prog.titolo });
      await db.query('UPDATE progetti SET drive_url=$1 WHERE id=$2', [pf.url, req.params.id]);
      projFolderId = pf.id;
    }

    const f = await drive.createPercorsoCondivisoFolders(projFolderId, pc.rows[0].tipo);
    await db.query('UPDATE percorsi SET drive_url=$1 WHERE id=$2', [f.url, req.params.pid]);
    res.json({ ok: true, drive_url: f.url });
  } catch (e) {
    console.error('[drive] cartelle percorso condiviso:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/dashboard/progetti/:id', requireCoach, express.json(), async (req, res) => {
  // ⚠️ Questa rotta scrive tipologia e data d'inizio, che stanno nel contratto.
  if (await bloccaSeCongelato(req.params.id, res)) return;
  const { committente_id, titolo, area, tipo, stato, obiettivi, note, data_inizio,
          referente_modo, referente_nome, referente_ruolo, referente_email } = req.body;
  if (!committente_id) return res.status(400).json({ error: 'Committente obbligatorio' });
  if (!titolo || !titolo.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
  const refModo  = referente_modo === 'altra' ? 'altra' : 'sponsor';
  const refNome  = refModo === 'altra' ? (referente_nome||'').trim()  : '';
  const refRuolo = refModo === 'altra' ? (referente_ruolo||'').trim() : '';
  const refEmail = refModo === 'altra' ? (referente_email||'').trim() : '';
  try {
    await db.query(
      `UPDATE progetti SET committente_id=$1,titolo=$2,area=$3,tipo=$4,stato=$5,
         obiettivi=$6,note=$7,data_inizio=$8,referente_modo=$9,referente_nome=$10,
         referente_ruolo=$11,referente_email=$12,updated_at=NOW() WHERE id=$13`,
      [committente_id, titolo.trim(),
       AREE_PROGETTO.includes(area) ? area : 'Business',
       TIPI_PROGETTO.includes(tipo) ? tipo : 'individuale',
       STATI_PROGETTO.includes(stato) ? stato : 'attivo',
       (obiettivi||'').trim(), (note||'').trim(), data_inizio||null,
       refModo, refNome, refRuolo, refEmail, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/progetti/:id', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM progetti WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Dettaglio progetto: dati + committente + elenco coachee collegati (Fase 3a).
router.get('/dashboard/progetti/:id', requireCoach, async (req, res) => {
  try {
    const pr = await db.query(`
      SELECT p.*, c.denominazione AS committente_nome, c.tipo AS committente_tipo, c.email AS committente_email
      FROM progetti p JOIN committenti c ON c.id = p.committente_id WHERE p.id=$1`, [req.params.id]);
    if (!pr.rows.length) return res.status(404).send('Progetto non trovato');
    const coachee = await db.query(`
      SELECT pa.id AS part_id, cl.id AS client_id, cl.name, cl.email, cl.token,
             pa.quota_coachee, pa.stato_pag_coachee, pa.data_pag_coachee,
             ${/* Fetta 6a — la firma dell'INFORMATIVA non è un contratto e non ha
                   stati: si spunta in anagrafica (`consenso_privacy`), e da lì la
                   leggiamo. Correzione di Germano del 30/08: avevo scritto che chi
                   non paga «non firma niente», e non è vero — firma l'informativa,
                   e quella spunta esiste già. ⛔ Non farne una seconda. */ ''}
             cl.consenso_privacy, cl.consenso_data
      FROM partecipazioni pa JOIN clients cl ON cl.id = pa.client_id
      WHERE pa.progetto_id=$1 ORDER BY cl.cognome NULLS LAST, cl.nome`, [req.params.id]);
    // Clienti già in anagrafica NON ancora in questo progetto: per collegarne uno
    // esistente senza crearne un doppione.
    const disponibili = await db.query(`
      SELECT id, name, cognome, area FROM clients
      WHERE id NOT IN (SELECT client_id FROM partecipazioni WHERE progetto_id=$1)
      ORDER BY cognome NULLS LAST, nome`, [req.params.id]);
    // Percorsi generati dal progetto (2b-2, panoramica sola lettura): per gli individuali
    // uno per persona (client_id valorizzato); per team/group il percorso condiviso
    // (client_id NULL) con i partecipanti aggregati da percorso_partecipanti.
    const percorsi = await db.query(`
      SELECT p.id, p.tipo, p.stato, p.n_sessioni_fatte, p.n_sessioni_previste, p.ore_fatte, p.client_id, p.drive_url,
             cl.name AS client_name,
             (SELECT string_agg(c2.name, ', ' ORDER BY c2.cognome NULLS LAST, c2.nome)
                FROM percorso_partecipanti pp JOIN clients c2 ON c2.id = pp.client_id
               WHERE pp.percorso_id = p.id) AS partecipanti
      FROM percorsi p LEFT JOIN clients cl ON cl.id = p.client_id
      WHERE p.progetto_id = $1
      ORDER BY p.created_at ASC`, [req.params.id]);
    // Fasi del progetto (3a): la timeline delle tappe con lo sponsor.
    const fasi = await db.query(
      'SELECT id, tipo, data, note, fatta, contenuto, stato, origine FROM fasi_progetto WHERE progetto_id=$1 ORDER BY created_at ASC',
      [req.params.id]);
    // Fetta B (Mattone 2): le sessioni COLLETTIVE del percorso condiviso (team/group).
    const seduteColl = await db.query(
      `SELECT s.* FROM sedute s JOIN percorsi p ON p.id = s.percorso_id
        WHERE p.progetto_id=$1 AND p.client_id IS NULL
        ORDER BY s.data ASC NULLS LAST, s.created_at ASC`, [req.params.id]);
    // Il piano di pagamento del committente (12/08). Se non c'è, la pagina ne
    // propone uno: non si salva niente da soli, la proposta la conferma il coach.
    const piano = await db.query(
      'SELECT * FROM tranche_progetto WHERE progetto_id=$1 ORDER BY ordine', [req.params.id]);
    // ⭐ C3 — quali rate di questo progetto sono già dentro una proforma viva.
    // È da qui che esce «Chiesta», e non da una colonna scritta a mano.
    const chieste = await db.query(`
      SELECT ${incassi.SQL_COLONNE} FROM proforma_righe r
        JOIN proforme pf ON pf.id = r.proforma_id
        JOIN tranche_progetto t ON t.id = r.tranche_id
        LEFT JOIN partecipazioni pa ON pa.id = t.partecipazione_id
       WHERE pf.stato <> 'annullata'
         AND COALESCE(t.progetto_id, pa.progetto_id) = $1`, [req.params.id]);
    // Fetta 6a — a che punto è la bozza di ciascun contratto di questo progetto.
    const statiContratti = await statiContrattiProgetto(req.params.id);
    res.send(progettoDettaglioPage(pr.rows[0], coachee.rows, req, disponibili.rows, percorsi.rows, fasi.rows, seduteColl.rows, piano.rows,
      incassi.mappaRate(chieste.rows), statiContratti));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

// Fetta 2a — il percorso individuale NASCE DA SOLO dal progetto (tipo + partecipante),
// come le schede cliente nascono dai partecipanti. Vale per i progetti individuale /
// individuale-multiplo (N persone → N percorsi separati). Team/group NON generano qui:
// usano la macchina percorso_partecipanti (fetta 2b). Guardia: niente doppioni se quel
// cliente ha già un percorso per quel progetto. L'area del percorso = area del progetto.
async function autoCreaPercorsoProgetto(progettoId, clientId, area, tipo) {
  // Individuale / individuale-multiplo → 1 percorso individuale per partecipante (2a).
  if (tipo === 'individuale' || tipo === 'individuale-multiplo') {
    const esiste = await db.query(
      'SELECT 1 FROM percorsi WHERE client_id=$1 AND progetto_id=$2', [clientId, progettoId]
    );
    if (esiste.rows.length) return;
    await db.query(
      `INSERT INTO percorsi (id, client_id, tipo, area, progetto_id, stato)
       VALUES ($1,$2,'Individuale',$3,$4,'attivo')`,
      [uuidv4(), clientId, area || 'Business', progettoId]
    );
    return;
  }
  // Team / group → UN solo percorso CONDIVISO per tutto il progetto (client_id NULL);
  // i partecipanti stanno in percorso_partecipanti (fetta 2b). Trova-o-crea il percorso
  // condiviso, poi aggancia la persona (guard: niente doppioni). La differenza team/group
  // (contenuti in comune vs per-persona) arriva con la reportistica (fetta 4).
  if (tipo === 'team' || tipo === 'group') {
    const label = tipo === 'team' ? 'Team' : 'Group';
    const cond = await db.query(
      'SELECT id FROM percorsi WHERE progetto_id=$1 AND client_id IS NULL LIMIT 1', [progettoId]
    );
    let percorsoId;
    if (cond.rows.length) {
      percorsoId = cond.rows[0].id;
    } else {
      percorsoId = uuidv4();
      await db.query(
        `INSERT INTO percorsi (id, client_id, tipo, area, progetto_id, stato)
         VALUES ($1,NULL,$2,$3,$4,'attivo')`,
        [percorsoId, label, area || 'Business', progettoId]
      );
    }
    await db.query(
      `INSERT INTO percorso_partecipanti (id, percorso_id, client_id)
       VALUES ($1,$2,$3) ON CONFLICT (percorso_id, client_id) DO NOTHING`,
      [uuidv4(), percorsoId, clientId]
    );
  }
}

// Aggiunge un cliente al progetto: o COLLEGANDO un cliente esistente (solo
// partecipazione), o CREANDO la persona nuova (client + partecipazione).
// In entrambi i casi, per i progetti individuali il percorso nasce da solo (2a).
// NB: qui NON creiamo cartelle Drive (dove va la cartella nei progetti è deciso dopo):
// il cliente nuovo nasce col suo token/link piattaforma, drive_url resta vuoto.
router.post('/dashboard/progetti/:id/coachee', requireCoach, express.json(), async (req, res) => {
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    const pr = await db.query('SELECT area, tipo FROM progetti WHERE id=$1', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Progetto non trovato' });
    const pArea = pr.rows[0].area || 'Business';
    const pTipo = pr.rows[0].tipo;

    // Caso A — cliente ESISTENTE: si crea solo il collegamento (partecipazione),
    // senza toccare i dati della persona. Se è già nel progetto, lo diciamo.
    const existingId = (req.body.clientId || '').trim();
    if (existingId) {
      const cl = await db.query('SELECT id FROM clients WHERE id=$1', [existingId]);
      if (!cl.rows.length) return res.status(404).json({ error: 'Cliente non trovato' });
      const dup = await db.query(
        'SELECT 1 FROM partecipazioni WHERE progetto_id=$1 AND client_id=$2',
        [req.params.id, existingId]
      );
      if (dup.rows.length) return res.status(409).json({ error: 'Questo cliente è già nel progetto.' });
      await db.query(
        `INSERT INTO partecipazioni (id,progetto_id,client_id) VALUES ($1,$2,$3)`,
        [uuidv4(), req.params.id, existingId]
      );
      await autoCreaPercorsoProgetto(req.params.id, existingId, pArea, pTipo);
      return res.json({ ok: true, clientId: existingId });
    }

    // Caso B — cliente NUOVO: nasce la persona (col suo token/link) + il collegamento.
    const cognome = (req.body.cognome || '').trim();
    const nome    = (req.body.nome || '').trim();
    const email   = (req.body.email || '').trim();
    if (!cognome) return res.status(400).json({ error: 'Cognome obbligatorio' });
    const area = pArea;
    const name = [nome, cognome].filter(Boolean).join(' ');
    const clientId = uuidv4();
    const token    = uuidv4().replace(/-/g, '');
    await db.query(
      `INSERT INTO clients (id,name,nome,cognome,email,area,fonte,token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [clientId, name, nome, cognome, email, area, 'altro', token]
    );
    await db.query(
      `INSERT INTO partecipazioni (id,progetto_id,client_id) VALUES ($1,$2,$3)`,
      [uuidv4(), req.params.id, clientId]
    );
    await autoCreaPercorsoProgetto(req.params.id, clientId, pArea, pTipo);
    res.json({ ok: true, clientId, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Toglie un coachee dal progetto ed ELIMINA la persona dall'anagrafica (scelta di
// Germano: chi si ritira potrebbe non aver firmato la privacy → non deve restare).
// Rete di sicurezza: se la persona ha GIÀ dati (sedute, percorsi, pagamenti, strumenti
// compilati), non la cancelliamo dal pulsante del progetto (sarebbe una perdita
// silenziosa): la togliamo solo dal progetto e resta in anagrafica; il coach la
// eliminerà di proposito dalla sua scheda.
router.delete('/dashboard/progetti/:id/coachee/:partId', requireCoach, async (req, res) => {
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    const pr = await db.query('SELECT client_id FROM partecipazioni WHERE id=$1 AND progetto_id=$2', [req.params.partId, req.params.id]);
    if (!pr.rows.length) return res.json({ ok: true }); // già rimosso
    const clientId = pr.rows[0].client_id;
    // Esce dal percorso condiviso del progetto (team/group), se c'è: il percorso resta
    // per gli altri. (Nei progetti individuali qui non c'è nulla da togliere.)
    await db.query(
      `DELETE FROM percorso_partecipanti WHERE client_id=$1
        AND percorso_id IN (SELECT id FROM percorsi WHERE progetto_id=$2)`,
      [clientId, req.params.id]
    );
    const hist = await db.query(`
      SELECT (SELECT count(*) FROM sedute   WHERE client_id=$1)
           + (SELECT count(*) FROM percorsi WHERE client_id=$1)
           + (SELECT count(*) FROM payments WHERE client_id=$1)
           + (SELECT count(*) FROM sessions WHERE client_id=$1) AS n`, [clientId]);
    if (Number(hist.rows[0].n) > 0) {
      await db.query('DELETE FROM partecipazioni WHERE id=$1', [req.params.partId]);
      return res.json({ ok: true, kept: true,
        message: 'Tolto dal progetto. Questa persona ha già dati (sessioni/pagamenti): resta in anagrafica. Per rimuoverla del tutto, eliminala dalla sua scheda.' });
    }
    // Nessuna storia → elimina la persona; il cascade toglie anche la partecipazione.
    await db.query('DELETE FROM clients WHERE id=$1', [clientId]);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Fase 3B — salva la quota del progetto: totale + quanto paga il committente.
// Il resto (totale − committente) lo dividono i coachee (Pezzo 2). Numeri in euro;
// campo vuoto = null (quota non ancora decisa). Guard: il committente non può
// pagare più del totale.
router.post('/dashboard/progetti/:id/quota', requireCoach, express.json(), async (req, res) => {
  const num = v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const totale = num(req.body.quota_totale);
  const committente = num(req.body.quota_committente);
  if (Number.isNaN(totale) || Number.isNaN(committente))
    return res.status(400).json({ error: 'Importi non validi' });
  if (totale !== null && committente !== null && committente > totale)
    return res.status(400).json({ error: 'Il committente non puo pagare piu della quota totale' });
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    await db.query(
      `UPDATE progetti SET quota_totale=$1, quota_committente=$2, updated_at=NOW() WHERE id=$3`,
      [totale, committente, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Fase 3B Pezzo 2 — salva le quote dei coachee (quota_coachee per partecipazione).
// Riceve un array {part_id, quota}; campo vuoto = null (non ancora deciso).
router.post('/dashboard/progetti/:id/quote-coachee', requireCoach, express.json(), async (req, res) => {
  const quote = Array.isArray(req.body.quote) ? req.body.quote : [];
  const num = v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  for (const q of quote) if (Number.isNaN(num(q.quota))) return res.status(400).json({ error: 'Importi non validi' });
  try {
    if (await bloccaSeCongelato(req.params.id, res)) return;
    for (const q of quote) {
      await db.query(
        `UPDATE partecipazioni SET quota_coachee=$1 WHERE id=$2 AND progetto_id=$3`,
        [num(q.quota), q.part_id, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Fase 3a — fasi del progetto. Un'unica POST fa create-o-update: senza `fid` crea una
// nuova tappa (ritorna l'id, per i pre-intake ripetibili e per la prima volta di una
// tappa singola); con `fid` aggiorna quella esistente. tipo accettato solo tra i 5.
// ⭐ Il sesto tipo nasce il 28/08 da una richiesta di Germano: «dovrà essere
// prevista la possibilità di inserire ulteriori sessioni intermedie con il
// Committente». Era l'unica delle sue sessioni che non aveva un tipo, e senza
// un tipo la rotta la rifiutava.
const FASI_TIPI = ['pre-intake','intake-sponsor','kick-off','sessione-committente','chiusura-open','chiusura-sponsor'];

router.post('/dashboard/progetti/:id/fasi', requireCoach, express.json(), async (req, res) => {
  try {
    const { fid, tipo } = req.body;
    const data  = req.body.data || null;
    const fatta = !!req.body.fatta;
    const contenuto = (req.body.contenuto && typeof req.body.contenuto === 'object') ? req.body.contenuto : null;
    const note  = contenuto ? (contenuto.note || '') : (req.body.note || '').trim();

    // Approva una riga nata in BOZZA dall'automazione (mattone 3).
    if (fid && req.body.approva) {
      await db.query(
        "UPDATE fasi_progetto SET stato='confermata' WHERE id=$1 AND progetto_id=$2",
        [fid, req.params.id]
      );
      return res.json({ ok: true, id: fid });
    }

    if (fid) {
      if (contenuto) {
        await db.query(
          'UPDATE fasi_progetto SET data=$1, note=$2, fatta=$3, contenuto=$4 WHERE id=$5 AND progetto_id=$6',
          [data, note, fatta, JSON.stringify(contenuto), fid, req.params.id]
        );
      } else {
        await db.query(
          'UPDATE fasi_progetto SET data=$1, note=$2, fatta=$3 WHERE id=$4 AND progetto_id=$5',
          [data, note, fatta, fid, req.params.id]
        );
      }
      // Obiettivo SMARTER + Parametri (voci dell'Intake) = verità del PROGETTO, una sola.
      // 🔒 Congelati col contratto (finiscono nell'art. «Come si misura il successo»),
      //    ma SOLO loro: registrare una fase avvenuta resta sempre possibile, anche a
      //    contratto firmato. Un fatto non è una modifica dell'accordo, lo racconta —
      //    e la Chiusura col Committente avviene per forza DOPO la firma.
      if ((req.body.obiettivo !== undefined || req.body.parametri !== undefined)
          && await progettoCongelato(req.params.id)) {
        return res.status(409).json({ error: 'Il contratto del Committente è firmato: obiettivo e parametri del progetto sono congelati. Per cambiarli usa «Modifica contratto approvato».' });
      }
      if (req.body.obiettivo !== undefined || req.body.parametri !== undefined) {
        await db.query(
          'UPDATE progetti SET obiettivo_smarter=$1, parametri=$2, updated_at=NOW() WHERE id=$3',
          [(req.body.obiettivo || '').trim(), (req.body.parametri || '').trim(), req.params.id]
        );
      }
      return res.json({ ok: true, id: fid });
    }

    if (!FASI_TIPI.includes(tipo)) return res.status(400).json({ error: 'Tipo fase non valido' });
    const id = uuidv4();
    await db.query(
      "INSERT INTO fasi_progetto (id, progetto_id, tipo, data, note, fatta, contenuto, stato, origine) VALUES ($1,$2,$3,$4,$5,$6,$7,'confermata','manuale')",
      [id, req.params.id, tipo, data, note, fatta, JSON.stringify(contenuto || {})]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/progetti/:id/fasi/:fid', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM fasi_progetto WHERE id=$1 AND progetto_id=$2', [req.params.fid, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

module.exports = router;

// ═══════════════════════════════════════════════════════
// STILE E COMPONENTI CONDIVISI (brand Noesys)
// ═══════════════════════════════════════════════════════
