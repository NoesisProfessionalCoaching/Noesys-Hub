const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('./db');
const { signToken, requireCoach, COOKIE_NAME } = require('./auth');
const { logoCompact, logoPicto } = require('./logo');
const drive = require('./google-drive');
const scan = require('./scan');
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

const router = express.Router();

// URL della piattaforma strumenti (app separata). Il link di accesso del cliente
// porta agli STRUMENTI, non all'Hub: qui gestiamo solo il CRM.
const PLATFORM_URL = process.env.PLATFORM_URL || 'https://coaching-tools-production.up.railway.app';

// Gli strumenti della piattaforma, NELL'ORDINE IN CUI LI VEDE IL CLIENTE nel suo
// portale: le tre famiglie decise da Germano il 28/07 — chi sei · cosa senti ·
// cosa fai. Le famiglie non hanno un titolo scritto nemmeno lì: a farle leggere
// sono l'ordine e lo stacco. Qui servono a due cose che devono restare d'accordo:
// la tendina «scegli lo strumento» (senza icone) e le etichette dello storico
// «Strumenti utilizzati» (con icone). Una lista sola, perciò, non due.
// Aggiungendo uno strumento in Coaching-Tools: aggiungerlo anche qui.
const STRUMENTI = [
  { key: 'valori',            nome: 'Scheda Valori',             icona: '💎' },
  { key: 'abilita',           nome: 'Scheda Abilità',            icona: '⭐' },
  { key: 'genogramma',        nome: 'Genogramma Relazionale',    icona: '🔗' },
  { key: 'lineavita',         nome: 'Linea della Vita',          icona: '📈' },
  { key: 'ruotavita',         nome: 'Ruota della Vita',          icona: '🎯' },
  { key: 'ruota-leadership',  nome: 'Ruota della Leadership',    icona: '👑' },
  { key: 'ruota-management',  nome: 'Ruota del Management',      icona: '📊' },
  { key: 'logica-cartesiana', nome: 'Logica Cartesiana',         icona: '🧭' },
  { key: 'swot',              nome: 'SWOT Analysis',             icona: '⚖️' },
  { key: 'covey-eisenhower',  nome: 'Matrice Covey/Eisenhower',  icona: '⏳' },
  { key: 'brainstorming',     nome: 'Brainstorming',             icona: '💡' },
];
const TOOL_LABEL = Object.fromEntries(STRUMENTI.map(t => [t.key, `${t.icona} ${t.nome}`]));

// Quante ore dura il permesso "per oggi" (il link dell'intake, e il compito che
// il cliente deve fare durante la sessione). Il conto NON parte quando il coach
// copia il link, ma quando il cliente lo apre la prima volta: così il link si può
// preparare la sera prima senza che arrivi già scaduto.
const PERMESSO_ORE_SESSIONE = 3;

// Fonti condivise tra lead e clienti (niente Calendly: non è una fonte).
const FONTI = ['sito', 'social', 'linkedin', 'passaparola', 'ebook', 'altro'];
const FONTE_LABEL = { sito:'Sito', social:'Social', linkedin:'LinkedIn', passaparola:'Passaparola', ebook:'E-book', altro:'Altro' };
const SOCIAL = ['Facebook', 'Instagram', 'LinkedIn', 'Altro'];
const AREE = ['Personal', 'Business', 'Young'];
const AREA_COLOR = { Personal:'#1A5280', Business:'#4F8B73', Young:'#D8AE2E' };
const STATO_CLIENTE = {
  attivo:    { label:'Attivo',   cls:'badge-active' },
  'in pausa':{ label:'In pausa', cls:'badge-pausa' },
  concluso:  { label:'Concluso', cls:'badge-inactive' },
};

// ═══════════════════════════════════════════════════════
// AUTH COACH (stesso account della piattaforma strumenti)
// ═══════════════════════════════════════════════════════

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
    const [ind, prog, comm, lead, bozze, daChiudere, azioni, richiami, appRows,
           anagrafiche, documenti] = await Promise.all([
      db.query(`SELECT count(*)::int n FROM clients c
                 WHERE EXISTS (SELECT 1 FROM percorsi pi WHERE pi.client_id = c.id AND pi.progetto_id IS NULL)
                    OR NOT EXISTS (SELECT 1 FROM percorsi pt WHERE pt.client_id = c.id
                         OR EXISTS (SELECT 1 FROM percorso_partecipanti ppt
                                     WHERE ppt.percorso_id = pt.id AND ppt.client_id = c.id))`),
      db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE stato='attivo')::int attivi FROM progetti`),
      db.query(`SELECT count(*)::int n FROM committenti`),
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
    ]);

    // ── Proforma create e non ancora spedite (13/08) ──────────────────────────
    // ⚠️ A differenza dei «Pagamenti da chiedere» qui sotto, questo gruppo NON è
    // legato al primo lunedì del mese: si vede SEMPRE. Una proforma ferma è
    // ferma anche il 14, e legarla al calendario vorrebbe dire nasconderla per
    // tre settimane. Chi decide cos'è «ferma» è `proforma.daMandare`.
    const fermeRows = await db.query(
      `SELECT pf.id, pf.numero, pf.data_emissione, pf.da_pagare, pf.drive_url, pf.stato,
              c.id AS client_id,
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
          id: c.id, name: c.name, mesi, bozze,
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
      bozze: bozze.rows, daChiudere: daChiudere.rows,
      azioni: azioni.rows, richiami: richiami.rows,
      appuntamenti: appRows,
      anagrafiche: anagrafiche.rows,
      documenti: documenti.rows.map(x => ({
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
router.get('/dashboard/diag/drive/test-create', requireCoach, async (req, res) => {
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
    const [sr, pr, payr, sedr, prjr, permr] = await Promise.all([
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
    res.send(clientDetailPage(client, sr.rows, pr.rows, payr.rows, sedr.rows, prjr.rows, permr.rows, req, {
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
                             WHEN $20 THEN consenso_data ELSE NULL END
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
function prezzoPerModalita(modalita, prezzo) {
  if (MODALITA_SENZA_PREZZO.includes(modalita)) return null;
  return (prezzo === '' || prezzo === undefined) ? null : prezzo;
}

router.post('/dashboard/clients/:id/percorsi', requireCoach, express.json(), async (req, res) => {
  const { tipo, n_sessioni_previste, n_sessioni_fatte, promo, sconto_note,
          data_inizio, data_fine, modalita, ore_fatte, stato, progetto_id } = req.body;
  const prezzo = prezzoPerModalita(modalita || 'Standard', req.body.prezzo);
  try {
    const pid = uuidv4();
    await db.query(
      `INSERT INTO percorsi (id,client_id,tipo,n_sessioni_previste,n_sessioni_fatte,prezzo,promo,sconto_note,data_inizio,data_fine,modalita,ore_fatte,stato,progetto_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [pid, req.params.id, tipo||'Individuale', n_sessioni_previste||8, n_sessioni_fatte||0,
       prezzo||null, promo||false, sconto_note||'', data_inizio||null, data_fine||null,
       modalita||'Standard', ore_fatte||0, stato||'attivo', progetto_id||null]
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
    if (!mailer.mailerReady()) {
      return res.status(400).json({ error: 'Invio email non configurato sul server.' });
    }
    const to = String(req.body.to || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    if (!to) return res.status(400).json({ error: 'Manca il destinatario.' });
    if (!subject) return res.status(400).json({ error: "Manca l'oggetto." });

    const cr = await db.query('SELECT nome, name FROM clients WHERE id=$1', [req.params.id]);
    const row = cr.rows[0];
    if (!row) return res.status(404).json({ error: 'Cliente non trovato.' });
    const nome = (row.nome && row.nome.trim()) || String(row.name || '').trim().split(/\s+/)[0];
    if (!nome) return res.status(400).json({ error: "Il cliente non ha un nome per l'agenda." });

    const modelli = await drive.findModelliFolder();
    if (!modelli) return res.status(500).json({ error: 'Cartella "Modelli" non trovata su Drive.' });

    const attachments = [];
    // Contratto: allegato tale e quale dal modello.
    const contrModel = 'Contratto Coaching OK.pdf';
    const cf = await drive.findFileByName(modelli.id, contrModel);
    if (!cf) return res.status(500).json({ error: 'Modello contratto non trovato su Drive: ' + contrModel });
    const cbuf = await drive.downloadFileBuffer(cf.id);
    attachments.push({ filename: 'Contratto per Servizi di Coaching.pdf', content: cbuf, contentType: 'application/pdf' });
    // Agenda: personalizzata col nome.
    const agenda = await documenti.generaAgenda({ nome });
    attachments.push({ filename: 'Agenda di sessione.pdf', content: agenda.bytes, contentType: 'application/pdf' });

    await mailer.sendMail({ to, subject, text: body, attachments });
    await db.query('UPDATE clients SET mail2_inviata_data = NOW() WHERE id=$1', [req.params.id]);
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
  try {
    const r = await db.query(
      `UPDATE percorsi SET tipo=$3, n_sessioni_previste=$4, prezzo=$5, promo=$6,
              sconto_note=$7, data_inizio=$8, modalita=$9
         WHERE id=$1 AND client_id=$2`,
      [req.params.pid, req.params.id, tipo || 'Individuale', n_sessioni_previste || 8,
       prezzo, promo || false, sconto_note || '', data_inizio || null,
       modalita || 'Standard']
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
    await db.query(
      "UPDATE percorsi SET stato='concluso', data_fine=COALESCE($2::date, data_fine, CURRENT_DATE) WHERE id=$1",
      [req.params.pid, d]);
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

const ORE_TIPO = { Intake: 2, Ongoing: 1, Final: null };
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
router.post('/dashboard/clients/:id/percorsi/:pid/sedute', requireCoach, express.json(), async (req, res) => {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    const sid = uuidv4();
    await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, obiettivo, argomenti, attivita, scadenza, prossima_ora, eseguita, note, stato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [sid, req.params.pid, req.params.id, t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note,
       // Una sessione con data nel futuro è FISSATA, non fatta: nasce in bozza, così
       // non conta ore né sessioni finché non avviene, e quando arriva il suo report
       // è questa riga a riempirsi (server/scan.js → rigaDaRiempire).
       (req.body.data && String(req.body.data) > oggiIso()) ? 'bozza' : 'confermata']
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true, id: sid });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// Modifica una seduta
router.post('/dashboard/clients/:id/percorsi/:pid/sedute/:sid', requireCoach, express.json(), async (req, res) => {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    await db.query(
      `UPDATE sedute SET tipo=$1, data=$2, ore=$3, obiettivo=$4, argomenti=$5, attivita=$6, scadenza=$7, prossima_ora=$8, eseguita=$9, note=$10
       WHERE id=$11 AND percorso_id=$12`,
      [t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note, req.params.sid, req.params.pid]
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// Elimina una seduta
router.delete('/dashboard/clients/:id/percorsi/:pid/sedute/:sid', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM sedute WHERE id=$1 AND percorso_id=$2', [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// Approva una BOZZA (report automatico rivisto dal coach): diventa 'confermata' e
// solo ora le ore/sessioni entrano nel conteggio ICF.
router.post('/dashboard/clients/:id/percorsi/:pid/sedute/:sid/approva', requireCoach, async (req, res) => {
  try {
    await db.query("UPDATE sedute SET stato='confermata' WHERE id=$1 AND percorso_id=$2",
      [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    res.json({ ok: true, ...await proponiChiusura(req.params.sid, req.params.pid) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

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
    const out = await scan.scanClientReports({ onlyClientId: (req.body && req.body.client_id) || undefined });
    res.json({ ok: true, ...out });
  } catch (err) { console.error('[scan-drive]', err); res.status(500).json({ error: err.message }); }
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
router.post('/dashboard/progetti/:id/percorsi/:pid/sedute', requireCoach, express.json(), async (req, res) => {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    const sid = uuidv4();
    await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, obiettivo, argomenti, attivita, scadenza, prossima_ora, eseguita, note)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [sid, req.params.pid, t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note]
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true, id: sid });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

router.post('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid', requireCoach, express.json(), async (req, res) => {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    await db.query(
      `UPDATE sedute SET tipo=$1, data=$2, ore=$3, obiettivo=$4, argomenti=$5, attivita=$6, scadenza=$7, prossima_ora=$8, eseguita=$9, note=$10
       WHERE id=$11 AND percorso_id=$12`,
      [t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.prossima_ora, f.eseguita, f.note, req.params.sid, req.params.pid]
    );
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

router.delete('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM sedute WHERE id=$1 AND percorso_id=$2', [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

router.post('/dashboard/progetti/:id/percorsi/:pid/sedute/:sid/approva', requireCoach, async (req, res) => {
  try {
    await db.query("UPDATE sedute SET stato='confermata' WHERE id=$1 AND percorso_id=$2",
      [req.params.sid, req.params.pid]);
    await recomputePercorso(req.params.pid);
    // Stessa proposta di chiusura della Scheda Cliente: la sezione si comporta
    // allo stesso modo nelle due pagine in cui vive.
    res.json({ ok: true, ...await proponiChiusura(req.params.sid, req.params.pid) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

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

// Gancio per l'automazione (report → scheda). Disattivo finché AUTOMATION_SECRET
// non è configurato: è il canale che userà il flusso automatico (Parte 2 / OAuth).
router.post('/api/sedute', express.json(), async (req, res) => {
  try {
    const secret = process.env.AUTOMATION_SECRET;
    if (!secret || req.body.secret !== secret) return res.status(401).json({ error: 'non autorizzato' });
    const { percorso_id, client_id } = req.body;
    if (!percorso_id || !client_id) return res.status(400).json({ error: 'percorso_id e client_id obbligatori' });
    const t = normTipo(req.body.tipo);
    const sid = uuidv4();
    await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, scheda)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sid, percorso_id, client_id, t, req.body.data || null, oreForTipo(t, req.body.ore), (req.body.scheda || '').trim()]
    );
    await recomputePercorso(percorso_id);
    res.json({ ok: true, id: sid });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// ═══════════════════════════════════════════════════════
// PAGAMENTI
// ═══════════════════════════════════════════════════════

router.post('/dashboard/clients/:id/payments', requireCoach, express.json(), async (req, res) => {
  const { importo, data_pagamento, tipo, stato, percorso_id, note } = req.body;
  if (!importo) return res.status(400).json({ error: 'Importo obbligatorio' });
  try {
    const pid = uuidv4();
    await db.query(
      `INSERT INTO payments (id,client_id,percorso_id,importo,data_pagamento,tipo,stato,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [pid, req.params.id, percorso_id||null, importo, data_pagamento||null,
       tipo||'sessione', stato||'atteso', note||'']
    );
    res.json({ ok: true, id: pid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/clients/:id/payments/:pid/ricevuto', requireCoach, async (req, res) => {
  try {
    await db.query("UPDATE payments SET stato='ricevuto',data_pagamento=CURRENT_DATE WHERE id=$1", [req.params.pid]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.delete('/dashboard/clients/:id/payments/:pid', requireCoach, async (req, res) => {
  try {
    await db.query('DELETE FROM payments WHERE id=$1', [req.params.pid]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

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
    WHERE COALESCE(p.ore_fatte, 0) > 0
       OR EXISTS (SELECT 1 FROM sedute s WHERE s.percorso_id = p.id AND s.stato <> 'bozza')
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
    res.setHeader('Content-Disposition', `attachment; filename="estratto-ICF-${new Date().toISOString().slice(0,10)}.csv"`);
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
      { nClienti: cl.rows.length, nCommittenti: km.rows.length, nProgetti: pj.rows.length },
      req));
  } catch (err) {
    console.error('[anomalie]', err);
    res.status(500).send('Errore nel caricamento delle anomalie');
  }
});

// ── Le proforma (Fatturazione, Fase 3) ─────────────────
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

    const oggi = new Date().toISOString().slice(0, 10);
    const d = proforma.componiProforma({ righe, soggetto, email: cliente.email,
      emittente, dataEmissione: oggi });
    if (!d.conti) return res.status(400).json({ error: 'Non si riesce a stabilire la categoria fiscale del cliente.' });
    const anno = Number(oggi.slice(0, 4));

    // Documento e righe nascono insieme o non nascono: senza le righe resterebbe
    // un numero bruciato su un foglio vuoto. Il progressivo si legge e si scrive
    // nella stessa istruzione, e il vincolo UNIQUE(anno, progressivo) è la rete.
    const creata = await db.transazione(async (q) => {
      const ins = await q(`
        INSERT INTO proforme (id, numero, anno, progressivo, client_id, data_emissione,
          periodo_da, periodo_a, categoria_fiscale, emittente_dati, destinatario_dati,
          imponibile, iva, ritenuta, bollo, totale_documento, da_pagare, scadenza)
        SELECT $1, $2::text || '/' || lpad(x.n::text, 3, '0'), $2::int, x.n, $3, $4::date,
               $5::date, $6::date, $7, $8::jsonb, $9::jsonb,
               $10, $11, $12, $13, $14, $15, $4::date
          FROM (SELECT COALESCE(MAX(progressivo), 0) + 1 AS n
                  FROM proforme WHERE anno = $2::int) x
        RETURNING id, numero`,
        // ⭐ C4 — la scadenza di un mese di sessioni è il giorno stesso: chi paga
        // per sé lo fa a RIMESSA DIRETTA (modello dei soldi, 10/08). Il promemoria
        // parte quindi da subito, ed è giusto così — non c'è nessun termine da
        // aspettare.
        [uuidv4(), anno, cliente.id, oggi, d.periodoDa, d.periodoA, d.categoria,
         JSON.stringify(d.emittenteDati), JSON.stringify(d.destinatarioDati),
         d.conti.imponibile, d.conti.iva, d.conti.ritenuta, d.conti.bollo,
         d.conti.totaleDocumento, d.conti.daPagare]);
      const pf = ins.rows[0];
      for (const r of d.righe) {
        await q(`INSERT INTO proforma_righe
          (id, proforma_id, seduta_id, percorso_id, data, descrizione, quantita, prezzo_unitario, importo, ordine)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv4(), pf.id, r.seduta_id, r.percorso_id, r.data, r.descrizione,
           r.quantita, r.prezzo_unitario, r.importo, r.ordine]);
      }
      return pf;
    });
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

    const oggi = new Date().toISOString().slice(0, 10);
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

    const creata = await db.transazione(async (q) => {
      const ins = await q(`
        INSERT INTO proforme (id, numero, anno, progressivo, client_id, committente_id,
          progetto_id, data_emissione, periodo_da, periodo_a, categoria_fiscale,
          emittente_dati, destinatario_dati,
          imponibile, iva, ritenuta, bollo, totale_documento, da_pagare, scadenza)
        SELECT $1, $2::text || '/' || lpad(x.n::text, 3, '0'), $2::int, x.n, $3, $4, $5,
               $6::date, $7::date, $8::date, $9, $10::jsonb, $11::jsonb,
               $12, $13, $14, $15, $16, $17, $18::date
          FROM (SELECT COALESCE(MAX(progressivo), 0) + 1 AS n
                  FROM proforme WHERE anno = $2::int) x
        RETURNING id, numero`,
        [uuidv4(), anno, clientId, committenteId, progettoId, oggi,
         d.periodoDa, d.periodoA, d.categoria,
         JSON.stringify(d.emittenteDati), JSON.stringify(d.destinatarioDati),
         d.conti.imponibile, d.conti.iva, d.conti.ritenuta, d.conti.bollo,
         d.conti.totaleDocumento, d.conti.daPagare, scadenza]);
      const pf = ins.rows[0];
      for (const r of d.righe) {
        await q(`INSERT INTO proforma_righe
          (id, proforma_id, tranche_id, percorso_id, data, descrizione, quantita, prezzo_unitario, importo, ordine)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv4(), pf.id, r.tranche_id, t.perc_id || null, r.data, r.descrizione,
           r.quantita, r.prezzo_unitario, r.importo, r.ordine]);
      }
      return pf;
    });
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
router.post('/dashboard/progetti/:id/piano', requireCoach, express.json(), async (req, res) => {
  try {
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

    // Il piano si riscrive intero dentro una transazione: o c'è quello nuovo o
    // resta quello di prima, mai mezzo vecchio e mezzo nuovo.
    await db.transazione(async (q) => {
      await q('UPDATE progetti SET data_meta = $2, data_fine = $3, updated_at = NOW() WHERE id = $1',
        [req.params.id, meta || null, fine || null]);
      await q('DELETE FROM tranche_progetto WHERE progetto_id = $1', [req.params.id]);
      for (const pi of preparati) {
        for (const r of pi.righe) {
          await q(`INSERT INTO tranche_progetto
                     (id, progetto_id, partecipazione_id, ordine, etichetta,
                      importo, innesco, giorni, stato, data_incasso)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [uuidv4(), req.params.id, pi.pid, r.ordine, r.etichetta,
             r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]);
        }
      }
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

    await db.transazione(async (q) => {
      await q('UPDATE percorsi SET prezzo = $2, data_meta = $3, data_fine = $4 WHERE id = $1',
        [req.params.id, prezzo, meta || null, fine || null]);
      await q('DELETE FROM tranche_progetto WHERE percorso_id = $1', [req.params.id]);
      for (const r of righe) {
        await q(`INSERT INTO tranche_progetto
                   (id, percorso_id, ordine, etichetta, importo, innesco, giorni, stato, data_incasso)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuidv4(), req.params.id, r.ordine, r.etichetta,
           r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]);
      }
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
    const pa = await db.query(
      'SELECT id, progetto_id, quota_coachee FROM partecipazioni WHERE id = $1', [req.params.id]);
    if (!pa.rows.length) return res.status(404).json({ error: 'Partecipazione non trovata' });
    const quota = Math.round(Number(pa.rows[0].quota_coachee) || 0);
    if (quota <= 0) {
      return res.status(400).json({ error: 'Questa persona non ha ancora una quota: si scrive nel progetto.' });
    }

    const righe = (Array.isArray((req.body || {}).righe) ? req.body.righe : []).map((r, i) => ({
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

    await db.transazione(async (q) => {
      await q('DELETE FROM tranche_progetto WHERE partecipazione_id = $1', [req.params.id]);
      for (const r of righe) {
        await q(`INSERT INTO tranche_progetto
                   (id, progetto_id, partecipazione_id, ordine, etichetta,
                    importo, innesco, giorni, stato, data_incasso)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [uuidv4(), pa.rows[0].progetto_id, req.params.id, r.ordine, r.etichetta,
           r.importo, r.innesco, r.giorni, r.stato, r.data_incasso]);
      }
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
             pa.quota_coachee, pa.stato_pag_coachee, pa.data_pag_coachee
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
      SELECT p.id, p.tipo, p.stato, p.n_sessioni_fatte, p.ore_fatte, p.client_id, p.drive_url,
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
    res.send(progettoDettaglioPage(pr.rows[0], coachee.rows, req, disponibili.rows, percorsi.rows, fasi.rows, seduteColl.rows, piano.rows,
      incassi.mappaRate(chieste.rows)));
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

// Fase 3B — interruttore pagamento del committente. Ricevuto → registra la data
// (oggi); torna ad atteso → azzera la data.
router.post('/dashboard/progetti/:id/pag-committente', requireCoach, express.json(), async (req, res) => {
  const stato = req.body.stato === 'ricevuto' ? 'ricevuto' : 'atteso';
  try {
    await db.query(
      `UPDATE progetti SET stato_pag_committente=$1,
         data_pag_committente = CASE WHEN $1='ricevuto' THEN CURRENT_DATE ELSE NULL END,
         updated_at=NOW() WHERE id=$2`,
      [stato, req.params.id]
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

// Fase 3B Pezzo 2 — interruttore pagamento di un coachee. Ricevuto → registra la
// data (oggi); torna ad atteso → azzera la data.
router.post('/dashboard/progetti/:id/coachee/:partId/pagamento', requireCoach, express.json(), async (req, res) => {
  const stato = req.body.stato === 'ricevuto' ? 'ricevuto' : 'atteso';
  try {
    await db.query(
      `UPDATE partecipazioni SET stato_pag_coachee=$1,
         data_pag_coachee = CASE WHEN $1='ricevuto' THEN CURRENT_DATE ELSE NULL END
       WHERE id=$2 AND progetto_id=$3`,
      [stato, req.params.partId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

// Fase 3a — fasi del progetto. Un'unica POST fa create-o-update: senza `fid` crea una
// nuova tappa (ritorna l'id, per i pre-intake ripetibili e per la prima volta di una
// tappa singola); con `fid` aggiorna quella esistente. tipo accettato solo tra i 5.
const FASI_TIPI = ['pre-intake','intake-sponsor','kick-off','chiusura-open','chiusura-sponsor'];
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

function baseStyle() {
  return `
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap" rel="stylesheet">
    <style>
      :root {
        --blue:#1A5280; --blue-dark:#134265; --navy:#223B6E;
        --gold:#D8AE2E; --green:#4F8B73; --lime:#B7B342;
        --ink:#2C3E50; --muted:#6B7280; --hint:#9AA0AA;
        --bg:#FAFBFC; --card:#FFFFFF; --line:#E6E9EE;
        --grad:linear-gradient(90deg,#D8AE2E,#B7B342,#4F8B73,#1A5280);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      /* Fondo BIANCO LUMINOSO. ⛔ NON rifarlo caldo/avorio: provato il 28/07
         e bocciato ("caldo non mi piace"). La luce va data dai riflessi, non
         da una tinta: un bagliore chiaro in alto, come una luce da studio, e
         un riflesso a pavimento in basso. */
      body { font-family: 'Manrope', system-ui, -apple-system, sans-serif; color: var(--ink); min-height: 100vh; -webkit-font-smoothing: antialiased;
        background-color: var(--bg);
        background-image:
          radial-gradient(1100px 640px at 50% -14%, rgba(255,255,255,1), rgba(255,255,255,0) 66%),
          radial-gradient(1300px 480px at 50% 106%, rgba(206,216,228,0.5), rgba(206,216,228,0) 72%);
        background-repeat: no-repeat; background-attachment: fixed; }
      ${/* 11/08 — le pagine passano da 980 a 1200px. Le schede si sono riempite
            (anagrafica + fatturazione + azioni + percorsi + amministrazione) e in
            una colonna sola diventavano lunghe da scorrere. 1200 e non di più:
            oltre, su un monitor grande, le righe diventano lunghe da seguire con
            l'occhio. Sotto i 1200 il limite non fa niente — decide la finestra. */ ''}
      .container { max-width: 1200px; margin: 0 auto; padding: 28px 18px; }
      /* La scheda è un oggetto appoggiato, non un rettangolo: DUE ombre
         sovrapposte — una stretta di contatto sotto il bordo, una più larga
         intorno — più un filo di luce sul bordo alto e una schiaritura verso
         il basso, che è il riflesso della luce che viene da sopra. */
      .card { background: var(--card); background-image: linear-gradient(180deg, #FFFFFF 0%, #FCFDFE 42%, #F9FBFC 100%); border: 1px solid var(--line); border-radius: 14px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 3px rgba(16,33,60,0.13), 0 7px 14px rgba(16,33,60,0.18);
        padding: 22px; margin-bottom: 16px; }
      .btn { display: inline-block; padding: 9px 20px; border: none; border-radius: 22px; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.15s; text-decoration: none; }
      .btn-primary  { background: var(--blue); color: #fff; }
      .btn-primary:hover { background: var(--blue-dark); }
      .btn-gold     { background: var(--gold); color: #3d3008; }
      .btn-gold:hover { background: #c89e1f; }
      .btn-danger   { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; }
      .btn-danger:hover { background: #fbe4e1; }
      .btn-neutral  { background: #eef1f5; color: #4a5568; }
      .btn-neutral:hover { background: #e2e7ee; }
      .btn-sm { padding: 6px 13px; font-size: 12px; }
      /* Correzione a mano di un numero già scritto (ore, sessioni): non è
         un'azione sul record, quindi non ha l'aspetto di un pulsante pieno. */
      /* Pulsante di una funzione ancora da sviluppare: il posto è riservato e si
         vede, ma è spento (metodo dei "posti riservati", come nel menù ⚙). */
      .btn-off { background: #f2f4f7; color: #b6bcc6; border: 1px dashed #d8dde5; cursor: default; }
      /* ── ZONE DI UNA SCHEDA ─────────────────────────────────────────────────
         Regola: sopra i DATI, in fondo TUTTE le azioni e TUTTI i link, raccolti
         in una zona sola e divisi per funzione (niente pulsanti in mezzo ai
         dati, niente stessa cosa in due posti). .az-bar esce dai margini della
         card (padding 22px) per fare fascia piena in fondo. */
      .zona-tit { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 14px; }
      ${/* Le due colonne della scheda cliente. `align-items: start` perché le due
            colonne hanno altezze diverse e non devono stirarsi a pareggio.
            Il filo verticale separa senza pesare; sotto i 1024px diventa un filo
            orizzontale, che è il modo giusto di separare due blocchi impilati. */ ''}
      ${/* La colonna DESTRA è la più larga anche se sembra controintuitivo: è
            quella che cresce (dati fiscali + note + prossima azione), mentre a
            sinistra i campi sono pochi e corti. Dandole più spazio i dati fiscali
            stanno su tre colonne invece che due e le due metà finiscono più o
            meno alla stessa altezza, invece di lasciare un buco bianco. */ ''}
      .scheda-2col { display: grid; grid-template-columns: 1fr 1.1fr; gap: 30px; align-items: start; }
      .scheda-2col > div + div { border-left: 1px solid var(--line); padding-left: 30px; }
      .az-bar { background: #FAFBFC; border-top: 1px solid var(--line); border-radius: 0 0 14px 14px; margin: 22px -22px -22px; padding: 18px 22px 14px; }
      .az-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 26px; }
      .az-gruppo { border-left: 2px solid var(--line); padding-left: 14px; min-width: 0; }
      .az-nome { font-size: 10px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 8px; }
      .az-btns { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
      .az-stato { font-size: 11px; color: var(--hint); margin-top: 7px; line-height: 1.6; }
      .az-link { font-size: 12px; color: var(--muted); word-break: break-all; margin-bottom: 7px; }
      .az-arrivo { font-size: 10px; color: var(--hint); font-style: italic; }
      .az-fatto { color: var(--green); font-weight: 700; }
      .az-danger { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px dashed var(--line); margin-top: 18px; padding-top: 12px; }
      @media (max-width: 700px) { .az-grid { grid-template-columns: 1fr; } }
      /* ── HOME ────────────────────────────────────────────────────────────────
         Il pittogramma del marchio fa da sfondo (grande e trasparente, scelta di
         Germano 28/07): sta SOTTO le porte, che sono bianche appena traslucide
         così il segno si intravede senza disturbare la lettura. */
      .hm-hero { position: relative; padding: 30px 0 34px; }
      /* Come sul sito Noesys: il pittogramma è ENORME e ancorato al bordo destro,
         quindi si vede solo una PORZIONE delle curve. Non fa il protagonista — dà
         movimento alla pagina con la linea. Posizione fissa: così non genera mai
         barre di scorrimento e resta un fondo stabile mentre si scorre.
         ATTENZIONE: qui siamo dentro un template literal, niente backtick nei
         commenti — chiudono la stringa e rompono tutto il file. */
      .hm-picto { position: fixed; top: -250px; right: -580px; width: 1180px; height: 1180px; opacity: 0.09; line-height: 0; pointer-events: none; z-index: 0; }
      .hm-picto svg { width: 100%; height: 100%; }
      .hm-porte { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .hm-porta { display: block; background: rgba(255,255,255,0.88); border: 1px solid var(--line); border-radius: 14px; padding: 20px; text-decoration: none; color: var(--ink); box-shadow: 0 1px 3px rgba(16,33,60,0.04); transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
      .hm-porta:hover { transform: translateY(-2px); border-color: #cdd7e1; box-shadow: 0 8px 24px rgba(16,33,60,0.09); }
      .hm-porta-nome { display: block; font-size: 15px; font-weight: 700; margin-bottom: 12px; }
      .hm-porta-num { font-size: 32px; font-weight: 800; color: var(--blue); line-height: 1; }
      .hm-porta-unita { font-size: 12px; color: var(--hint); margin-left: 5px; }
      .hm-porta-desc { display: block; font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 10px; }
      .hm-gruppo { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(16,33,60,0.04); }
      .hm-gruppo-nome { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 4px; }
      .hm-voce { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-top: 1px solid #eef1f5; font-size: 13px; color: var(--ink); text-decoration: none; }
      .hm-voce:hover { color: var(--blue); }
      .hm-voce-coda { font-size: 12px; color: var(--hint); white-space: nowrap; flex: 0 0 auto; }
      @media (max-width: 720px) { .hm-porte { grid-template-columns: 1fr; } .hm-picto { display: none; } }
      input, select, textarea { width: 100%; padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 9px; font-size: 13px; font-family: inherit; color: var(--ink); outline: none; transition: border-color 0.15s, box-shadow 0.15s; background: #fff; }
      input:focus, select:focus, textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(26,82,128,0.12); }
      textarea { resize: vertical; min-height: 64px; }
      label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 5px; }
      .form-group { margin-bottom: 14px; }
      h1 { font-size: 23px; font-weight: 800; color: var(--blue); letter-spacing: -0.01em; margin-bottom: 4px; }
      h2 { font-size: 16px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
      a { color: var(--blue); }
      .badge { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; }
      .badge-active   { background: #e7f1ec; color: #2e6b52; }
      .badge-inactive { background: #eef1f5; color: #7a8089; }
      .badge-pausa    { background: #fff8dc; color: #7a5c00; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); }
      td { padding: 13px 14px; border-bottom: 1px solid #f1f3f6; font-size: 13px; vertical-align: middle; }
      tr:last-child td { border-bottom: none; }
      .empty { text-align: center; color: var(--hint); font-style: italic; padding: 34px; font-size: 14px; }
      .flash-error { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; border-radius: 9px; padding: 11px 14px; margin-bottom: 16px; font-size: 13px; }
      .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:100; align-items:center; justify-content:center; padding:16px; }
      .modal-box { background:#fff; border-radius:12px; padding:26px; width:520px; max-width:100%; box-shadow:0 8px 32px rgba(0,0,0,0.18); max-height:90vh; overflow-y:auto; }
      /* Su uno schermo da portatile la finestrella della sessione e' piu' lunga
         dello schermo: le Note (ultima voce) e i pulsanti finivano fuori, e su
         macOS la barra di scorrimento non si vede, quindi niente lo diceva.
         Rimedio senza toccare il contenuto: il titolo resta appeso in alto e la
         riga dei pulsanti in basso, scorrono solo i campi in mezzo. Cosi' Salva
         e Annulla sono sempre a portata e non si perde mai il punto in cui si e'.
         dvh accanto a vh: sui tablet segue la tastiera, dove vh non la vede. */
      .modal-box > h2 { position:sticky; top:-26px; z-index:2; background:#fff; margin:-26px -26px 12px; padding:26px 26px 12px; border-radius:12px 12px 0 0; }
      .modal-box > div:last-child { position:sticky; bottom:-26px; z-index:2; background:#fff; margin:8px -26px -26px; padding:14px 26px 26px; border-top:1px solid var(--line); border-radius:0 0 12px 12px; }
      @supports (max-height: 90dvh) { .modal-box { max-height:90dvh; } }
      ${/* 11/08 — etichette 11→12px, valori 13→15px. Erano misure tarate su una
            scheda che conteneva la metà delle cose di oggi. Il valore deve
            risaltare sull'etichetta: è il dato che si legge, l'etichetta dice
            solo che cos'è. Sotto i 1024px l'etichetta torna a 11px (regola della
            portabilità), il valore no: sul telefono deve restare leggibile. */ ''}
      .field-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; font-weight:600; margin-bottom:4px; }
      .field-value { font-size:15px; color:var(--ink); line-height:1.45; }
      /* Accordion — report sessioni / strumenti */
      details > summary { list-style: none; }
      details > summary::-webkit-details-marker { display: none; }
      .sec-caret { display:inline-block; color: var(--hint); font-size: 11px; transition: transform 0.15s; flex:0 0 auto; }
      details[open] > summary .sec-caret { transform: rotate(90deg); }
      details.acc { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; background:#fff; }
      details.acc > summary { display:flex; align-items:center; gap:8px; cursor: pointer; padding: 11px 14px; font-size:13px; user-select:none; }
      details.acc > summary:hover { background: #f8f9fb; border-radius: 10px; }
      .acc-body { padding: 4px 14px 14px 14px; border-top: 1px solid var(--line); font-size:13px; line-height:1.6; }
      /* Scheda Cliente — tabella una-riga-per-sessione */
      .scheda-cliente td { vertical-align: top; font-size: 12px; line-height: 1.45; padding: 11px 12px; }
      .scheda-cliente th { white-space: nowrap; font-size: 10.5px; }
      .scheda-cliente td:nth-child(1) { width: 76px; white-space: nowrap; color: var(--muted); }
      .scheda-cliente td:nth-child(2) { white-space: nowrap; }
      .scheda-cliente td:nth-child(3) { min-width: 155px; }
      .scheda-cliente td:nth-child(4) { min-width: 180px; }
      .scheda-cliente td:nth-child(5) { min-width: 175px; }
      .scheda-cliente td:nth-child(6) { width: 92px; white-space: nowrap; }
      .scheda-cliente td:nth-child(7) { width: 42px; }
      .scheda-cliente td:nth-child(8) { min-width: 260px; }
      .scheda-cliente ul { margin: 0; padding-left: 16px; }
      /* ── Header brandizzato Noesys — namespace nh-, l'unico dell'Hub ── */
      .nh { position: sticky; top: 0; z-index: 60; background: #fff; border-bottom: 1px solid var(--line); }
      .nh-row { max-width: 980px; margin: 0 auto; padding: 0 18px; }
      .nh-top { display: flex; align-items: center; gap: 14px; padding-top: 9px; padding-bottom: 9px; }
      .nh-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; flex: 0 0 auto; line-height: 0; }
      .nh-payoff { font-size: 9.5px; letter-spacing: 0.17em; text-transform: uppercase; color: #5A5A5A; font-weight: 700; line-height: 1.35; border-left: 1px solid var(--line); padding-left: 12px; }
      .nh-spacer { flex: 1 1 auto; }
      .nh-search { position: relative; flex: 0 1 290px; }
      /* la casella è viva dalla fase 1c: sparita l'etichetta "in arrivo" che
         stava dentro, è sparito anche il padding a destra che le faceva posto */
      .nh-search input { padding: 7px 13px; font-size: 12.5px; border-radius: 20px; background: #f7f9fb; }
      .nh-search input:focus { background: #fff; }
      .nh-menu { position: relative; flex: 0 0 auto; }
      .nh-menu > summary { cursor: pointer; width: 34px; height: 34px; border-radius: 50%; background: #eef1f5; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #4a5568; }
      .nh-menu > summary:hover { background: #e2e7ee; }
      .nh-menu-box { position: absolute; right: 0; top: 42px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 28px rgba(16,33,60,0.12); padding: 6px; min-width: 215px; z-index: 70; }
      .nh-menu-box a, .nh-menu-box .nh-off { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 8px; font-size: 13px; text-decoration: none; color: var(--ink); }
      .nh-menu-box a:hover { background: #f4f7fa; }
      .nh-menu-box .nh-off { color: #B9BFC7; cursor: not-allowed; }
      .nh-tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; color: #C4C9D0; }
      .nh-sep { height: 1px; background: var(--line); margin: 5px 8px; }
      .nh-band { border-top: 1px solid #f1f3f6; }
      .nh-mondi { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
      .nh-mondo { padding: 9px 14px; font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none; border-bottom: 2.5px solid transparent; white-space: nowrap; }
      .nh-mondo:hover { color: var(--ink); }
      .nh-mondo.on { color: var(--blue); border-bottom-color: var(--blue); }
      ${/* `flex-wrap` aggiunto l'11/08: la riga dei mondi andava già a capo da
            sola, questa no, e su uno schermo stretto le sotto-voci uscivano dal
            bordo. Vale anche con due sole voci, se i nomi sono lunghi. */ ''}
      .nh-sub { display: flex; align-items: center; gap: 3px; margin-left: auto; flex-wrap: wrap; }
      .nh-sub a { font-size: 12px; color: var(--muted); text-decoration: none; padding: 5px 11px; border-radius: 16px; white-space: nowrap; }
      .nh-sub a.on { background: #eef4f9; color: var(--blue); font-weight: 600; }
      ${/* Le sezioni dell'area Amministrazione: stanno DENTRO la pagina, sotto il
            titolo, non nella barra in alto (scelta di Germano, 11/08). Le voci
            spente sono le fasi 3, 4 e 5 del cantiere: si vedono per far capire
            dove si sta andando, e si accendono una per volta. */ ''}
      .am-nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 22px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
      .am-nav a, .am-nav span { font-size: 13px; padding: 7px 14px; border-radius: 18px; text-decoration: none; white-space: nowrap; }
      .am-nav a { color: var(--muted); }
      .am-nav a:hover { background: #f4f7fa; color: var(--ink); }
      .am-nav a.on { background: #eef4f9; color: var(--blue); font-weight: 700; }
      .am-nav span { color: #C4C9D0; cursor: not-allowed; }
      .nh-bric { display: flex; align-items: center; gap: 7px; padding: 7px 0; font-size: 12px; color: var(--hint); flex-wrap: wrap; }
      .nh-bric a { color: var(--muted); text-decoration: none; }
      .nh-bric a:hover { color: var(--blue); text-decoration: underline; }
      .nh-bric b { color: var(--ink); font-weight: 600; }
      .nh-accent { height: 3px; background: var(--grad); }
      @media (max-width: 640px) { .nh-search, .nh-payoff { display: none; } }

      /* ── COL DITO (31/07) ───────────────────────────────────────────────
         Germano ha usato l'Hub dal telefono e ha dovuto ruotarlo più volte per
         riuscire a toccare le cose. Questo foglio di stile sta in OGNI pagina
         dell'Hub, quindi qui si sistemano tutte in un punto solo.
         44px è la misura sotto la quale un dito non prende il bersaglio al
         primo colpo; i campi di testo a 16px perché sotto quella soglia Safari
         su iPhone ingrandisce da solo la pagina appena li tocchi — ed è uno dei
         motivi per cui la pagina "salta" mentre scrivi.
         Fino a 1024px: telefoni e tablet. Sul Mac a schermo intero non cambia
         niente. La misura si controlla con la prova di portabilità. */
      @media (max-width: 1024px) {
        .btn { min-height: 44px; padding: 12px 20px; display: inline-flex; align-items: center; justify-content: center; }
        .btn-sm { min-height: 44px; padding: 11px 16px; font-size: 13px; }
        input, select, textarea { min-height: 44px; font-size: 16px; }
        input[type="checkbox"], input[type="radio"] { min-height: 0; width: 22px; height: 22px; }
        .field-label, .az-nome, .az-arrivo, .nh-tag, .zona-tit { font-size: 11px; }
        ${/* Due colonne su un telefono sarebbero due strisce strette: si impilano,
              e il filo che le separava passa da verticale a orizzontale. */ ''}
        .scheda-2col { grid-template-columns: 1fr; gap: 22px; }
        .scheda-2col > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 22px; }
        /* Una finestrella con sei campi non ci sta in uno schermo di telefono:
           si scorre, e va bene — purché TITOLO e PULSANTI restino appesi in
           alto e in basso (lo fa il foglio di stile delle finestrelle, che i
           controlli verificano). Qui si toglie solo il superfluo, per accorciare
           quanto si deve scorrere. */
        /* ⚠️ 18/08 — «width: auto» qui SEMBRA sbagliato e non lo è. Misurando la
           finestrella dell'incasso l'avevo vista larga 52px e stavo per
           cambiarla: erano i 26+26 di padding attorno a un contenuto largo zero,
           perché il pannello del browser di prova era collassato. A finestra
           vera (900px) «auto» e «100%» danno lo stesso identico risultato: 440px,
           cioè il limite scritto sulla finestrella. Non si tocca. */
        .modal-box { width: auto !important; max-width: 100%; }
        .modal-box textarea { min-height: 110px !important; }
        /* I link di NAVIGAZIONE (i tre mondi, il menu, le briciole) sono
           bersagli come i pulsanti. I link dentro un testo NON si toccano:
           ingrandirli spezzerebbe la riga in cui stanno. */
        .nh-mondo { padding: 13px 14px; }
        .nh-menu-box a, .nh-menu-box .nh-off { padding: 13px 12px; }
        .nh-bric a { display: inline-block; padding: 14px 0; }
        .am-nav a, .am-nav span { padding: 13px 16px; }
      }
    </style>
  `;
}

// Header brandizzato Noesys — l'UNICO dell'Hub dal 28/07: tutte le pagine sono
// migrate, la vecchia appBar() e le sue regole CSS non esistono più.
// Tre fasce: identità · i tre mondi · dove sei.
//   mondo    → 'individuali' | 'progetti' | 'lead' | '' (funzione trasversale)
//   sub      → sotto-voce attiva del mondo (i Committenti vivono dentro Progetti)
//   briciole → [{label, href}] dalla radice alla pagina; l'ultima non è un link
// Il descrittore "Professional Coaching" è TESTO accanto al logo, non dentro
// l'SVG: scelta di Germano 26/07 — nel marchio esteso, alle misure da header,
// il descrittore scende sotto i 6px e diventa illeggibile.
function headerNoesys({ mondo = '', sub = '', briciole = [], q = '' } = {}) {
  const MONDI = [
    { key: 'individuali', label: 'Percorsi Individuali', href: '/dashboard/individuali' },
    { key: 'progetti',    label: 'Progetti Strutturati', href: '/dashboard/progetti' },
    { key: 'lead',        label: 'Lead',                 href: '/dashboard/leads' },
    // 11/08 — QUARTO MONDO. Scelta di Germano: tenere separata la gestione del
    // lavoro (le persone) da quella amministrativa (i soldi). Non ha una porta
    // nella home come gli altri tre — è un'area di servizio, non un mondo di
    // persone — e ci si arriva solo da qui.
    { key: 'amministrazione', label: 'Amministrazione', href: '/dashboard/amministrazione' },
  ];
  const SOTTOVOCI = {
    progetti: [
      { key: 'progetti',    label: 'Progetti',    href: '/dashboard/progetti' },
      { key: 'committenti', label: 'Committenti', href: '/dashboard/committenti' },
    ],
    // ⚠️ Amministrazione NON ha sotto-voci qui: le sue sezioni stanno DENTRO la
    // pagina (scelta di Germano, 11/08). La barra in alto porta ai mondi, non
    // dentro un mondo.
  };
  const mondiHtml = MONDI.map(m =>
    `<a class="nh-mondo${m.key === mondo ? ' on' : ''}" href="${m.href}">${m.label}</a>`).join('');
  const sottoHtml = (SOTTOVOCI[mondo] || []).map(s =>
    `<a href="${s.href}"${s.key === sub ? ' class="on"' : ''}>${s.label}</a>`).join('');
  const bricHtml = briciole.map((b, i) => {
    const ultima = i === briciole.length - 1;
    const voce = (b.href && !ultima) ? `<a href="${b.href}">${esc(b.label)}</a>` : `<b>${esc(b.label)}</b>`;
    return (i ? '<span>›</span>' : '') + voce;
  }).join('');

  return `<header class="nh">
    <div class="nh-row nh-top">
      <a class="nh-brand" href="/dashboard" aria-label="Noesys Professional Coaching">${logoCompact(44)}<span class="nh-payoff">Professional<br>Coaching</span></a>
      <span class="nh-spacer"></span>
      <form class="nh-search" action="/dashboard/cerca" method="get" role="search">
        <input type="search" name="q" value="${esc(q)}" placeholder="Cerca cliente, committente, progetto…" aria-label="Cerca">
      </form>
      <details class="nh-menu">
        <summary title="Funzioni">⚙</summary>
        <div class="nh-menu-box">
          <a href="/dashboard/icf">Estratto ICF</a>
          <div class="nh-off">Prenotazioni <span class="nh-tag">in arrivo</span></div>
          ${/* «Fatturazione — in arrivo» stava qui: tolta l'11/08. Adesso quella
                roba ha una porta vera, il mondo Amministrazione nella barra, e
                due porte per la stessa cosa confondono e basta. */ ''}
          <div class="nh-sep"></div>
          <a href="/dashboard/diag/drive">Verifica Google Drive</a>
          <div class="nh-sep"></div>
          <a href="/logout">Esci</a>
        </div>
      </details>
    </div>
    <div class="nh-band"><div class="nh-row nh-mondi">${mondiHtml}${sottoHtml ? `<span class="nh-sub">${sottoHtml}</span>` : ''}</div></div>
    ${bricHtml ? `<div class="nh-band"><div class="nh-row nh-bric">${bricHtml}</div></div>` : ''}
    <div class="nh-accent"></div>
  </header>`;
}

function fonteOptions(sel) {
  return FONTI.map(f => `<option value="${f}"${f===sel?' selected':''}>${FONTE_LABEL[f]}</option>`).join('');
}
function areaOptions(sel) {
  return AREE.map(a => `<option value="${a}"${a===sel?' selected':''}>${a}</option>`).join('');
}
function socialOptions(sel) {
  return `<option value="">—</option>` + SOCIAL.map(s => `<option value="${s}"${s===sel?' selected':''}>${s}</option>`).join('');
}
// Compone l'indirizzo in una riga leggibile: "Via Roma 12, 20100 Milano (MI)".
function composeAddress(c) {
  const parts = [];
  if (c.via) parts.push(c.via);
  const cc = [c.cap, c.citta].filter(Boolean).join(' ');
  if (cc) parts.push(cc);
  let addr = parts.join(', ');
  if (c.provincia) addr += ` (${c.provincia})`;
  return addr;
}

// ═══════════════════════════════════════════════════════
// PAGINE
// ═══════════════════════════════════════════════════════

function loginPage(error) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Accesso</title>${baseStyle()}</head><body>
    <div style="max-width:360px;margin:70px auto;background:#fff;padding:34px 30px;border-radius:16px;box-shadow:0 8px 32px rgba(16,33,60,0.08)">
      <div style="text-align:center;margin-bottom:20px">${logoCompact(48)}</div>
      <h1 style="text-align:center">Hub CRM</h1>
      <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:20px">Accesso coach</p>
      ${error ? `<div class="flash-error">${error}</div>` : ''}
      <form method="POST" action="/login">
        <div class="form-group"><label>Username</label><input name="username" required></div>
        <div class="form-group"><label>Password</label><input name="password" type="password" required></div>
        <button class="btn btn-primary" style="width:100%;margin-top:6px" type="submit">Entra</button>
      </form>
    </div>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// HOME — tre porte sul pittogramma + cosa chiede attenzione
// ═══════════════════════════════════════════════════════
function homePage(d, req) {
  const porta = (href, nome, num, unita, desc) => `
    <a class="hm-porta" href="${href}">
      <span class="hm-porta-nome">${nome}</span>
      <span class="hm-porta-num">${num}</span>
      <span class="hm-porta-unita">${unita}</span>
      <span class="hm-porta-desc">${desc}</span>
    </a>`;

  // Un gruppo compare SOLO se ha qualcosa dentro: una home che elenca caselle
  // vuote è rumore.
  const gruppo = (titolo, voci) => voci.length ? `
    <div class="hm-gruppo">
      <div class="hm-gruppo-nome">${titolo}</div>
      ${voci.join('')}
    </div>` : '';
  const voce = (href, testo, coda) => `
    <a class="hm-voce" href="${href}"><span>${testo}</span><span class="hm-voce-coda">${coda || ''}</span></a>`;

  // Il prossimo appuntamento di ogni percorso, come lo dice il report dell'ultima
  // sessione. Sta per primo perché è la cosa che si guarda per prima. Quando la
  // data è passata la riga non c'è più: il gruppo si mostra solo se ha voci.
  // L'ora c'è solo se il report la diceva: senza, resta la sola data (meglio di
  // un orario inventato).
  // ⭐ Dal 12/08 ogni riga ha la sua matita: l'appuntamento si sposta da QUI,
  // che è il posto dove Germano lo guarda, senza aprire la scheda e senza
  // toccare il verbale della sessione da cui era nato.
  // ⚠️ Non si può usare `voce()`: quella è un <a>, e un pulsante dentro un
  // collegamento è marcato sbagliato (e il clic finirebbe sul collegamento).
  // Qui la riga è un contenitore, col nome che resta un collegamento.
  const gAppuntamenti = gruppo('Prossimi appuntamenti', d.appuntamenti.map(a => `
    <div class="hm-voce">
      <span><a href="/dashboard/clients/${a.client_id}" style="text-decoration:none;color:inherit">${esc(a.name)}</a></span>
      <span class="hm-voce-coda">
        ${itDate(a.scad)}${a.ora ? ` · <strong style="color:var(--ink)">${esc(a.ora)}</strong>` : ''}
        <button onclick="apriApp('${a.percorso_id}','${esc(a.name)}','${a.scad || ''}','${esc(a.ora || '')}')"
                class="btn btn-neutral btn-sm" style="margin-left:8px" title="Sposta l'appuntamento">✎</button>
      </span>
    </div>`));

  const gBozze = gruppo('Sessioni in bozza da approvare', d.bozze.map(b => voce(
    b.client_id ? `/dashboard/clients/${b.client_id}` : (b.progetto_id ? `/dashboard/progetti/${b.progetto_id}` : '/dashboard/individuali'),
    b.cliente ? esc(b.cliente) : (b.progetto ? esc(b.progetto) + ' <span style="color:var(--hint)">· percorso di gruppo</span>' : 'Sessione'),
    b.data ? itDate(b.data) : '')));

  const gChiudere = gruppo('Percorsi da chiudere', d.daChiudere.map(x => voce(
    `/dashboard/clients/${x.id}`, esc(x.name),
    'relazione conclusa, ' + (x.n === 1 ? 'percorso ancora attivo' : x.n + ' percorsi ancora attivi'))));

  const gAzioni = gruppo('Prossime azioni', d.azioni.map(a => voce(
    `/dashboard/clients/${a.id}`, `<strong>${esc(a.name)}</strong> — ${esc(a.prossima_azione)}`,
    a.prossima_azione_data ? itDate(a.prossima_azione_data) : '')));

  const gLead = gruppo('Lead da ricontattare', d.richiami.map(l => voce(
    '/dashboard/leads', esc([l.nome, l.cognome].filter(Boolean).join(' ')),
    l.data_prossimo_contatto ? itDate(l.data_prossimo_contatto) : '')));

  // Proposte lette dai documenti, in attesa che il coach le guardi.
  const gAnagrafiche = gruppo('Dati letti dai documenti, da controllare', d.anagrafiche.map(a => voce(
    `/dashboard/clients/${a.id}`, esc(a.name),
    a.n === 1 ? '1 dato' : a.n + ' dati')));

  // ⭐ I pagamenti da chiedere (Fase 3, Tappa 3). Sta in cima perché è l'unico
  // gruppo che riguarda dei soldi, e perché l'amministrazione è la cosa che
  // Germano rimanda più volentieri: se non gliela mette davanti l'Hub, non se la
  // ricorda nessuno.
  // Una riga per PERSONA, non per mese e non per tipo di problema (regola
  // dell'11/08): si apre quella scheda e si sistema tutto lì.
  // Le BOZZE stanno nella riga della persona a cui appartengono, e chi ha SOLO
  // bozze compare lo stesso: una sessione non approvata non matura, quindi
  // resterebbe fuori dalla proforma senza che nessuno lo dica.
  const gDaChiedere = gruppo('Pagamenti da chiedere', (d.pagamentiDaChiedere || []).map(c => {
    // Chi ha solo bozze non ha mesi maturati: il mese lo dicono le bozze stesse,
    // altrimenti la riga direbbe un nome e basta.
    const mesi = (c.n ? c.mesi.map(m => m.mese) : c.bozze.map(b => b.mese))
      .map(meseEsteso).join(' · ');
    const bozze = c.nBozze
      ? `<span style="color:#8a6d1e"> · ${c.nBozze === 1 ? '1 sessione ancora in bozza' : c.nBozze + ' sessioni ancora in bozza'}</span>`
      : '';
    const coda = c.n
      ? `<strong style="color:var(--ink)">€ ${fiscale.euro(c.importo)}</strong>`
      : 'da approvare';
    return voce(`/dashboard/clients/${c.id}`,
      `${esc(c.name)} <span style="color:var(--hint);text-transform:capitalize">${mesi}</span>${bozze}`,
      coda);
  }));

  // ⭐ Le proforma ferme (13/08). Stanno SOPRA i pagamenti da chiedere perché
  // sono più avanti nella catena: il documento c'è già, manca solo mandarlo —
  // ed è il passo che costa meno e vale di più.
  // Il collegamento porta ad Amministrazione → Proforma e non alla scheda del
  // cliente: è lì che stanno le due azioni («apri il PDF» e «Rivedi e manda»),
  // e una riga che chiede di fare una cosa deve portare dove la si fa.
  // Da GIORNI_FERMA in su la riga alza la voce (Germano, 13/08: 7 giorni).
  const gFerme = gruppo('Proforma da mandare', (d.proformeFerme || []).map(p => {
    const insiste = p.giorni !== null && p.giorni >= proforma.GIORNI_FERMA;
    const quanto  = proforma.daQuantoFerma(p.giorni);
    return voce('/dashboard/amministrazione/proforma',
      `${esc(p.cliente || 'Destinatario cancellato')} <span style="color:var(--hint)">· ${esc(p.numero)}</span>`,
      `<span style="color:${insiste ? '#a4342a' : 'var(--hint)'};${insiste ? 'font-weight:700' : ''}">${quanto}</span>
       <strong style="color:var(--ink);margin-left:10px">€ ${fiscale.euro(p.da_pagare)}</strong>`);
  }));

  // ⭐ C4b — «Verifica se è arrivato» (18/08). Sta SOPRA le proforma da mandare
  // perché è ancora più avanti nella catena: quel documento è già partito, i
  // soldi dovevano già esserci, e l'unica cosa che l'Hub non può sapere da solo
  // è se sono arrivati davvero — la banca non la vede.
  // La riga porta ad Amministrazione → Proforma, dove sta il pulsante «È
  // arrivato» col suo contesto (quanto manca, gli acconti già registrati): una
  // riga che chiede di fare una cosa porta dove la si fa, come le altre qui.
  // Da GIORNI_INSISTE in su alza la voce, come le proforma ferme.
  const gVerificare = gruppo('Verifica se è arrivato', (d.incassiDaVerificare || []).map(p => {
    const insiste = p.giorni !== null && p.giorni >= incassi.GIORNI_INSISTE;
    const quanto  = incassi.daQuantoScaduta(p.giorni);
    // Un acconto non fa sparire la riga: la fa dire quanto manca ancora.
    const parziale = p.acconto > 0
      ? `<span style="color:var(--hint)"> · acconto di € ${fiscale.euro(p.acconto)} ricevuto</span>` : '';
    return voce('/dashboard/amministrazione/proforma',
      `${esc(p.cliente || 'Destinatario cancellato')} <span style="color:var(--hint)">· ${esc(p.numero)}</span>${parziale}`,
      `<span style="color:${insiste ? '#a4342a' : 'var(--hint)'};${insiste ? 'font-weight:700' : ''}">${quanto}</span>
       <strong style="color:var(--ink);margin-left:10px">€ ${fiscale.euro(p.manca)}</strong>`);
  }));

  // Documentazione che manca, SOLO sui percorsi attivi (scelta di Germano 08/08).
  // I due casi restano distinti perché l'azione è diversa: «non arrivata» aspetta
  // il cliente, «ancora in bianco» aspetta il coach — è il caso di chi compila su
  // carta e va scansionato.
  const gDocumenti = gruppo('Documentazione da completare', d.documenti.map(x => voce(
    `/dashboard/clients/${x.id}`, esc(x.name), x.stato)));

  const attenzione = [gAppuntamenti, gVerificare, gFerme, gDaChiedere, gBozze, gAnagrafiche, gChiudere, gDocumenti, gAzioni, gLead].filter(Boolean).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub</title>${baseStyle()}</head><body>
  ${headerNoesys({})}
  <div class="hm-picto">${logoPicto(1080)}</div>
  <div class="container" style="position:relative;z-index:1">

    <section class="hm-hero">
      <div class="hm-porte">
        ${porta('/dashboard/individuali', 'Percorsi Individuali', d.nIndividuali,
                d.nIndividuali === 1 ? 'cliente' : 'clienti',
                'Le persone che segui una per una: paga il cliente.')}
        ${porta('/dashboard/progetti', 'Progetti Strutturati', d.nProgetti,
                d.nProgetti === 1 ? 'progetto' : 'progetti',
                `Commissionati da un committente${d.nCommittenti ? ` · ${d.nCommittenti} ${d.nCommittenti === 1 ? 'committente' : 'committenti'}` : ''}.`)}
        ${porta('/dashboard/leads', 'Lead', d.nLeadAperti,
                d.nLeadAperti === 1 ? 'da coltivare' : 'da coltivare',
                'Chi ti ha contattato e non è ancora un cliente.')}
      </div>
    </section>

    <section class="hm-att">
      <h2 style="margin-bottom:14px">Chiede attenzione</h2>
      ${attenzione || `<div class="card" style="color:var(--muted);font-size:13px">Non c'è nulla in sospeso: nessuna bozza da approvare, nessun percorso da chiudere, nessun richiamo in scadenza.</div>`}
    </section>

  </div>

  ${/* La finestrella dell'appuntamento: tre righe e due pulsanti. Deve restare
        piccola — si apre per spostare un incontro, non per compilare una scheda. */ ''}
  ${/* 🔴 18/08 — era class="modal", che NEL CSS NON ESISTE: niente sfondo bianco,
        niente cornice, niente ombra — restavano i campi nudi sopra la pagina. È
        il difetto che Germano aveva segnalato il 17/08 sulla finestrella
        «Rivedi e manda», e la causa era la stessa qui. La classe giusta è «.modal-box». */ ''}
  <div id="modal-app" class="modal-overlay">
    <div class="modal-box" style="max-width:420px">
      <h2 style="margin-bottom:4px">Sposta l'appuntamento</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px"><span id="ap-chi"></span></p>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="ap-data" type="date"></div>
        <div class="form-group"><label>Ora</label><input id="ap-ora" type="time"></div>
      </div>
      <p style="color:var(--hint);font-size:12px;margin-bottom:14px">
        Quello che scrivi qui non tocca i report: resta scritto finché non arriva
        il report di una sessione più recente.
      </p>
      <div id="ap-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="document.getElementById('modal-app').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="ap-salva" onclick="salvaApp()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
      <button onclick="togliApp()" class="btn btn-danger btn-sm" style="width:100%;margin-top:10px">Togli l'appuntamento</button>
    </div>
  </div>

  <script>
    var appPercorso = null;
    function apriApp(pid, chi, data, ora) {
      appPercorso = pid;
      document.getElementById('ap-chi').textContent = chi;
      document.getElementById('ap-data').value = data || '';
      document.getElementById('ap-ora').value = /^\\d{1,2}:\\d{2}$/.test(ora || '') ? ora : '';
      document.getElementById('ap-error').style.display = 'none';
      document.getElementById('modal-app').style.display = 'flex';
    }
    async function scriviApp(data, ora) {
      var err = document.getElementById('ap-error');
      var btn = document.getElementById('ap-salva');
      btn.disabled = true; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/percorsi/' + appPercorso + '/appuntamento', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data, ora: ora }) });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block'; btn.disabled = false; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; btn.disabled = false; }
    }
    function salvaApp() {
      scriviApp(document.getElementById('ap-data').value, document.getElementById('ap-ora').value);
    }
    function togliApp() {
      if (!confirm('Tolgo l\\'appuntamento?\\n\\nSparisce dai promemoria. Ne potrai segnare uno nuovo dalla scheda del cliente.')) return;
      scriviApp('', '');
    }
  </script>
  </body></html>`;
}

// `individuali` = la pagina è quella del mondo individuale (titolo e conteggio lo
// dicono); `tutti` = filtro scavalcato, si vedono anche i clienti dei progetti.
function dashboardPage(clients, req, { individuali = false, tutti = false } = {}) {
  const rows = clients.length === 0
    ? `<tr><td colspan="6" class="empty">Nessun cliente. Crea il primo con il pulsante qui sopra.</td></tr>`
    : clients.map(c => {
      const area = c.p_area || c.area || 'Personal';
      const ac = AREA_COLOR[area] || '#1A5280';
      const st = STATO_CLIENTE[c.stato_cliente] || STATO_CLIENTE.attivo;
      const recall = c.prossima_azione
        ? `${esc(c.prossima_azione)}${c.prossima_azione_data ? `<br><span style="font-size:11px;color:#aaa">${itDate(c.prossima_azione_data)}</span>` : ''}`
        : '<span style="color:#ccc">—</span>';
      const sess = Number(c.p_sess) || 0;
      const ore  = Number(c.p_ore) || 0;
      // Relazione conclusa ma percorso ancora aperto: si vede già dall'elenco,
      // senza dover entrare in ogni scheda per accorgersene.
      const daChiudere = c.stato_cliente === 'concluso' && c.p_stato === 'attivo';
      const percorso = c.p_tipo
        ? `${esc(c.p_tipo)} · ${sess} ${sess === 1 ? 'sessione' : 'sessioni'}${ore > 0 ? ` · ${fmtOre(ore)} h` : ''}${c.p_stato !== 'attivo' ? ` · <span style="color:#999">concluso</span>` : ''}${daChiudere ? `<br><span class="badge" style="background:#fff8dc;color:#7a5c00" title="La relazione è conclusa ma il percorso risulta ancora attivo">⚠ percorso da chiudere</span>` : ''}${c.p_progetto_titolo ? `<br><span class="badge" style="background:#e8f4fd;color:#1A5280">📁 ${esc(c.p_progetto_titolo)}</span>` : ''}`
        : '<span style="color:#ccc">—</span>';
      return `<tr onclick="location.href='/dashboard/clients/${c.id}'" style="cursor:pointer">
        <td><strong>${esc(c.name)}</strong>${c.email ? `<br><span style="color:#aaa;font-size:11px">${esc(c.email)}</span>` : ''}</td>
        <td><span class="badge" style="background:${ac}18;color:${ac}">${area}</span></td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td style="font-size:12px">${percorso}</td>
        <td style="font-size:12px">${recall}</td>
        <td style="white-space:nowrap" onclick="event.stopPropagation()">
          <a href="/dashboard/clients/${c.id}" class="btn btn-neutral btn-sm">Dettaglio</a>
          <button onclick="copyLink('${PLATFORM_URL}/c/${c.token}')" class="btn btn-neutral btn-sm">🔗</button>
        </td>
      </tr>`;
    }).join('');

  const titolo = individuali && !tutti ? 'Percorsi Individuali' : 'Clienti';
  const sotto = individuali && !tutti
    ? `${clients.length} ${clients.length === 1 ? 'cliente che segui una a una' : 'clienti che segui uno per uno'} · <a href="/dashboard/individuali?tutti=1" style="font-size:13px">vedi tutti i clienti, compresi quelli dentro i progetti</a>`
    : individuali
      ? `${clients.length} clienti in tutto, progetti compresi · <a href="/dashboard/individuali" style="font-size:13px">torna ai soli percorsi individuali</a>`
      : `${clients.length} clienti registrati`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(titolo)}</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'individuali' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>${esc(titolo)}</h1><p style="color:#aaa;font-size:13px">${sotto}</p></div>
      <button onclick="openNewClient()" class="btn btn-primary">+ Nuovo cliente</button>
    </div>
    <input id="cerca" type="search" placeholder="🔍 Cerca cliente (nome, email, area…)" oninput="filtra()" style="margin-bottom:14px">
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Cliente</th><th>Area</th><th>Stato</th><th>Percorso</th><th>Prossima azione</th><th></th></tr></thead>
        <tbody id="lista-clienti">${rows}</tbody>
      </table>
      <div id="nessun-risultato" class="empty" style="display:none">Nessun cliente corrisponde alla ricerca.</div>
    </div>
  </div>

  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px">Nuovo cliente</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome</label><input id="new-nome" type="text" placeholder="es. Mario"></div>
        <div class="form-group"><label>Cognome *</label><input id="new-cognome" type="text" placeholder="es. Rossi"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="new-email" type="email" placeholder="mario@esempio.it"></div>
        <div class="form-group"><label>Telefono</label><input id="new-tel" type="tel" placeholder="+39…"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label><select id="new-area">${areaOptions('Personal')}</select></div>
        <div class="form-group"><label>Come ti ha conosciuto</label><select id="new-fonte">${fonteOptions('altro')}</select></div>
      </div>
      <div class="form-group"><label>Società / azienda</label><input id="new-societa" type="text" placeholder="opzionale"></div>
      <div class="form-group"><label>Obiettivo / motivo</label><textarea id="new-obiettivo" placeholder="opzionale"></textarea></div>
      <div id="new-error" style="display:none" class="flash-error"></div>
      <div id="new-result" style="display:none;background:#e8f5e9;border-radius:6px;padding:12px;margin-bottom:12px;font-size:13px">
        <strong>Cliente creato!</strong><br>Link agli strumenti (da inviare al cliente):<br>
        <a id="new-link" href="#" target="_blank" style="color:#1A5280;word-break:break-all"></a>
        <button onclick="copyLinkEl()" class="btn btn-neutral btn-sm" style="margin-top:8px;width:100%">📋 Copia link</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="createClient()" id="btn-create" class="btn btn-primary" style="flex:1">Crea</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:200">Link copiato!</div>

  <script>
    const PLATFORM_URL = ${JSON.stringify(PLATFORM_URL)};
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      let visibili = 0;
      document.querySelectorAll('#lista-clienti tr').forEach(tr => {
        const match = tr.textContent.toLowerCase().includes(q);
        tr.style.display = match ? '' : 'none';
        if (match) visibili++;
      });
      document.getElementById('nessun-risultato').style.display = visibili ? 'none' : 'block';
    }
    function openNewClient() {
      document.getElementById('modal-overlay').style.display = 'flex';
      document.getElementById('new-result').style.display = 'none';
      document.getElementById('new-error').style.display = 'none';
      ['new-nome','new-cognome','new-email','new-tel','new-societa','new-obiettivo'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('btn-create').style.display = '';
      document.getElementById('new-nome').focus();
    }
    function closeModal() {
      document.getElementById('modal-overlay').style.display = 'none';
      if (document.getElementById('new-result').style.display !== 'none') location.reload();
    }
    async function createClient() {
      const nome    = document.getElementById('new-nome').value.trim();
      const cognome = document.getElementById('new-cognome').value.trim();
      const errEl = document.getElementById('new-error');
      if (!cognome) { errEl.textContent = 'Il cognome è obbligatorio'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';
      const res = await fetch('/dashboard/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        nome, cognome, email: document.getElementById('new-email').value.trim(),
        telefono: document.getElementById('new-tel').value.trim(),
        area: document.getElementById('new-area').value,
        fonte: document.getElementById('new-fonte').value,
        societa: document.getElementById('new-societa').value.trim(),
        obiettivo: document.getElementById('new-obiettivo').value.trim(),
      }) });
      const data = await res.json();
      if (data.error) { errEl.textContent = data.error; errEl.style.display='block'; return; }
      const link = PLATFORM_URL + '/c/' + data.token;
      document.getElementById('new-link').href = link;
      document.getElementById('new-link').textContent = link;
      document.getElementById('new-result').style.display = 'block';
      document.getElementById('btn-create').style.display = 'none';
      if (data.driveOk === false) {
        const w = document.createElement('div');
        w.style.cssText = 'margin-top:10px;color:#b45309;font-size:12px';
        w.textContent = '⚠ Cliente creato, ma la cartella Drive non è stata creata. Aprilo e usa «🔄 Crea cartelle Drive».';
        document.getElementById('new-result').appendChild(w);
      }
    }
    function copyLink(url) { navigator.clipboard.writeText(url).then(showToast); }
    function copyLinkEl() { navigator.clipboard.writeText(document.getElementById('new-link').href).then(showToast); }
    function showToast() {
      const t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2000);
    }
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
  </script>
  </body></html>`;
}

// Pagina di verifica del collegamento a Google Drive (Fase 3a). Solo lettura.
function driveDiagPage(steps, root, children, req) {
  const allOk = steps.length > 0 && steps.every(s => s.ok);
  const stepRows = steps.map(s => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f1f3f6">
      <span style="font-size:15px;line-height:1.4;color:${s.ok ? '#2e6b52' : '#c0392b'}">${s.ok ? '✓' : '✕'}</span>
      <span style="font-size:13px;line-height:1.5">${esc(s.txt)}</span>
    </div>`).join('');

  const childRows = (children || []).length
    ? children.map(f => `
        <div style="display:flex;align-items:center;gap:9px;padding:7px 0;font-size:13px">
          <span>${drive.isFolder(f) ? '📁' : '📄'}</span>
          <span>${esc(f.name)}</span>
        </div>`).join('')
    : '<div class="empty" style="padding:18px">Nessun elemento in cima alla cartella.</div>';

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Verifica Drive</title>${baseStyle()}</head><body>
  ${headerNoesys({ briciole: [{ label: 'Verifica Google Drive' }] })}
  <div class="container" style="max-width:640px">
    <h1>Verifica collegamento a Google Drive</h1>
    <p style="color:var(--muted);font-size:13px;margin-bottom:18px">Controllo di sola lettura: l'Hub prova a leggere il tuo Drive con le chiavi impostate su Railway. Non tocca né il database né le schede.</p>

    <div class="card" style="border-color:${allOk ? '#bfe0cf' : '#f3c9c4'};background:${allOk ? '#f2f9f5' : '#fdf5f4'}">
      <div style="font-weight:700;color:${allOk ? '#2e6b52' : '#c0392b'};margin-bottom:6px">
        ${allOk ? '✓ Collegamento riuscito' : '✕ Qualcosa non torna'}
      </div>
      ${stepRows}
    </div>

    ${root && (children || []).length ? `
    <div class="card">
      <h2>Cosa vede dentro «Noesys»</h2>
      ${childRows}
    </div>` : ''}

    ${allOk ? `
    <p style="color:var(--muted);font-size:13px">Tutto a posto: la Fase 1 è confermata. Il prossimo passo è la chiave Claude (Fase 2).</p>`
    : `<p style="color:var(--muted);font-size:13px">Segnalami cosa vedi qui sopra: dal messaggio d'errore capisco se è un valore incollato male su Railway (e quale) o altro.</p>`}
  </div>
  </body></html>`;
}

// Mini-Markdown → HTML sicuro per la scheda seduta (grassetto, corsivo, titoli,
// elenchi, citazioni, righello). Prima si esce l'HTML, poi si applicano i pochi stili.
function mdLite(md) {
  const inline = t => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
  const lines = String(md || '').split('\n');
  let out = '', inList = false;
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,6}\s+/.test(line)) { closeList(); out += `<div style="font-weight:700;color:var(--ink);margin:10px 0 4px">${inline(line.replace(/^#{1,6}\s+/, ''))}</div>`; }
    else if (/^---+$/.test(line.trim())) { closeList(); out += '<hr style="border:none;border-top:1px solid var(--line);margin:8px 0">'; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { out += '<ul style="margin:4px 0 4px 18px;padding:0">'; inList = true; } out += `<li style="margin:2px 0">${inline(line.replace(/^[-*]\s+/, ''))}</li>`; }
    else if (line.trim() === '') { closeList(); out += '<div style="height:6px"></div>'; }
    else if (/^>\s?/.test(line)) { closeList(); out += `<div style="color:#6B7280;font-style:italic">${inline(line.replace(/^>\s?/, ''))}</div>`; }
    else { closeList(); out += `<div>${inline(line)}</div>`; }
  }
  closeList();
  return out;
}

// Formattatori celle della Scheda Cliente.
function boldify(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function cellText(v) {
  if (!v || !String(v).trim() || String(v).trim() === '—') return '<span style="color:#ccc">—</span>';
  return String(v).trim().split(/\r?\n/).map(l => boldify(l)).join('<br>');
}
function cellList(v) {
  if (!v || !String(v).trim() || String(v).trim() === '—') return '<span style="color:#ccc">—</span>';
  const s = String(v).trim();
  let items = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullety = items.filter(l => /^[-•*]\s+/.test(l)).length >= Math.ceil(items.length / 2);
  if (items.length > 1 && bullety) items = items.map(l => l.replace(/^[-•*]\s+/, ''));
  else if (items.length === 1 && (s.match(/;/g) || []).length >= 1) items = s.split(/;\s*/).map(x => x.trim()).filter(Boolean);
  if (items.length <= 1) return cellText(v);
  return '<ul style="margin:0;padding-left:16px">' + items.map(x => '<li style="margin-bottom:3px">' + boldify(x) + '</li>').join('') + '</ul>';
}
function cellDate(v) {
  const s = v ? String(v).trim() : '';
  if (!s || s === '—') return '<span style="color:#ccc">—</span>';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? itDate(s) : esc(s);
}
function cellEseg(v) {
  const s = v ? String(v).trim() : '';
  if (s === '✓') return '<span style="color:#2e6b52;font-weight:700;font-size:15px">✓</span>';
  if (s === '✗' || /^x$/i.test(s)) return '<span style="color:#c0392b;font-weight:700;font-size:15px">✗</span>';
  return '<span style="color:#ccc">—</span>';
}

// Una riga della Scheda Cliente (una per sessione).
function renderSedutaRow(s) {
  const T = { Intake: { bg: '#e8f4fd', c: '#1A5280' }, Ongoing: { bg: '#eafaf1', c: '#4F8B73' }, Final: { bg: '#fff8ec', c: '#8a6d1e' } }[s.tipo] || { bg: '#eee', c: '#555' };
  const isProg = isProgrammata(s);
  const isBozza = s.stato === 'bozza' && !isProg;
  const cell = v => (v && String(v).trim() && String(v).trim() !== '—') ? esc(String(v)) : '<span style="color:#ccc">—</span>';
  const noteVal = (s.note && s.note.trim()) ? s.note : (s.scheda || ''); // recupera il vecchio formato
  const approvaBtn = isBozza
    ? `<button onclick="approvaSeduta('${s.id}','${s.percorso_id}')" class="btn btn-sm" style="background:#e7f1ec;color:#2e6b52;display:block;margin-bottom:5px" title="Approva">✓ Approva</button>` : '';
  return `<tr style="${isBozza ? 'background:#fffdf3' : (isProg ? 'background:#f6faff' : '')}">
    <td style="white-space:nowrap">${s.data ? itDate(s.data) : '—'}</td>
    <td style="white-space:nowrap"><span class="badge" style="background:${T.bg};color:${T.c}">${esc(s.tipo)}</span>${isBozza ? '<div style="margin-top:5px"><span class="badge" style="background:#fdf6e3;color:#8a6d1e;border:1px solid #efdfa8">bozza</span></div>' : ''}${isProg ? '<div style="margin-top:5px"><span class="badge" style="background:#eef4fb;color:#1A5280;border:1px solid #cfe0f0">in programma</span></div>' : ''}</td>
    <td>${cellText(s.obiettivo)}</td>
    <td>${cellList(s.argomenti)}</td>
    <td>${cellList(s.attivita)}</td>
    <td style="white-space:nowrap">${cellDate(s.scadenza)}${/^\d{1,2}:\d{2}$/.test(s.prossima_ora || '') ? `<div style="font-size:11px;color:var(--hint);margin-top:2px">ore ${esc(s.prossima_ora)}</div>` : ''}</td>
    <td style="text-align:center">${cellEseg(s.eseguita)}</td>
    <td>${cellText(noteVal)}</td>
    <td style="white-space:nowrap">${approvaBtn}<button onclick="editSeduta('${s.id}')" class="btn btn-neutral btn-sm" title="Modifica">✎</button> <button onclick="delSeduta('${s.id}','${s.percorso_id}')" class="btn btn-danger btn-sm" title="${isBozza ? 'Scarta' : 'Elimina'}">🗑</button></td>
  </tr>`;
}

function clientDetailPage(client, sessions, percorsi, payments, sedute, progetti, permessi, req, fatt) {
  fatt = fatt || {};
  const proforme = fatt.proforme || [];
  const link = PLATFORM_URL + '/c/' + client.token;
  sedute = sedute || [];
  permessi = permessi || [];
  const area = client.area || 'Personal';
  const ac = AREA_COLOR[area] || '#1A5280';
  const st = STATO_CLIENTE[client.stato_cliente] || STATO_CLIENTE.attivo;
  const val = v => v ? esc(v) : '<span style="color:#ccc">—</span>';

  // ── Mail 1 di benvenuto (Fetta 1c): bozza + stato ────
  // Nome di battesimo per il saluto e per scegliere la lettera M/F di default.
  const mailNome = (client.nome && client.nome.trim()) || String(client.name || '').trim().split(/\s+/)[0] || '';
  const mail1Genere = documenti.genereFromNome(mailNome);
  const mail1Subject = 'Il tuo percorso di Coaching sta per iniziare';
  // Testo di default modificabile nel pannello (finalizzato da Germano, valido per i
  // percorsi individuali; i Progetti Strutturati avranno varianti). Neutro rispetto al
  // genere (la lettera allegata gestisce Caro/Cara), unica variabile il nome.
  const mail1Body =
`Ciao ${mailNome},

ti scrivo perché a breve inizieremo la prima fase del tuo percorso di Coaching.

Prima di tutto desidero ringraziarti per la fiducia che mi stai accordando: sono certo che, con l'impegno di entrambi, potremo ottenere ottimi risultati.

Per rendere la sessione più proficua e confortevole, ti chiederei di tenere a portata di mano dei fogli e una penna, nel caso possano servire.

In allegato a questa mail troverai i seguenti materiali:
• Lettera di benvenuto
• Scheda anagrafica
• Codice Etico di ICF

Se ne hai tempo e modo, ti chiederei di leggere la lettera, compilare l'anagrafica e rimandarmela a questo indirizzo.

Il Codice Etico di ICF è lo strumento utile qualora volessi avere rassicurazioni su ciò che è alla base del Coaching di ICF.

Per ora è tutto. Grazie ancora e a presto.
Germano`;
  const mail1SentTxt = client.mail1_inviata_data
    ? itDate(new Date(client.mail1_inviata_data).toISOString()) : '';

  // ── Mail 2 (Fetta 2): contratto + agenda, dopo l'Intake ──
  const mail2Subject = 'Contratto per Servizi di Coaching e Agenda di sessione';
  const mail2Body =
`Ciao ${mailNome},

come anticipato, ti invio i documenti per formalizzare e accompagnare il tuo percorso di Coaching. In allegato a questa mail trovi:
• il Contratto per Servizi di Coaching
• l'Agenda di sessione

Ti chiederei di leggere con attenzione il contratto, firmarlo e rimandarmelo a questo stesso indirizzo.

L'Agenda è uno strumento prezioso per monitorare il tuo percorso: ti aiuta a mettere a fuoco gli impegni presi e a dare continuità al lavoro tra una sessione e l'altra. Ti chiederei di compilarla e inviarmela entro la sera prima del giorno della sessione successiva, così potrò arrivare preparato al nostro incontro.

Per qualsiasi cosa, rispondi pure a questa mail.

A presto,
Germano`;
  const mail2SentTxt = client.mail2_inviata_data
    ? itDate(new Date(client.mail2_inviata_data).toISOString()) : '';

  // ── Percorsi ────────────────────────────────────────
  // Stato della RELAZIONE (sul cliente) e stato del PERCORSO sono due cose diverse
  // e restano separate: una persona può finire un percorso e restare cliente. Ma
  // quando si contraddicono bisogna dirlo, altrimenti divergono in silenzio per
  // mesi (casi reali: Francesco Pilo e Rebecca Ros, conclusi con percorsi aperti).
  const attiviOra = percorsi.filter(p => p.stato === 'attivo');
  const avvisoStati = (client.stato_cliente === 'concluso' && attiviOra.length) ? `
      <div style="font-size:13px;background:#fff8ec;padding:10px 14px;border-radius:8px;border-left:3px solid var(--gold);margin-bottom:14px">
        La relazione con il cliente è <strong>conclusa</strong>, ma ${attiviOra.length === 1 ? 'un percorso risulta' : attiviOra.length + ' percorsi risultano'} ancora <strong>${attiviOra.length === 1 ? 'attivo' : 'attivi'}</strong>. Se ${attiviOra.length === 1 ? 'è finito' : 'sono finiti'}, ${attiviOra.length === 1 ? 'chiudilo' : 'chiudili'} qui sotto; se ${attiviOra.length === 1 ? 'prosegue' : 'proseguono'}, va bene così.
      </div>` : '';
  // ── Il prossimo appuntamento (12/08) ────────────────
  // Sta qui, sopra i percorsi, perché è la cosa che si guarda prima di una
  // sessione. E soprattutto: è l'UNICO punto da cui si può segnare un incontro
  // che dai report non arriverà mai — quello di una sessione saltata, che in
  // home non compare perché la sua data è già passata.
  // Una riga per percorso attivo, anche quando l'appuntamento non c'è: è
  // proprio quel vuoto che va visto.
  const oggiIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
  const appHtml = (fatt.appuntamenti || []).map(a => {
    const passato = a.scad && String(a.scad) < oggiIso;
    const quando = !a.scad
      ? `<span style="color:var(--hint)">nessun appuntamento fissato</span>`
      : `<strong style="color:${passato ? 'var(--hint)' : 'var(--ink)'}">${itDate(a.scad)}${a.ora ? ` · ore ${esc(a.ora)}` : ''}</strong>${passato ? ` <span style="font-size:12px;color:#8a6d1e">— è già passato</span>` : ''}`;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef1f5;flex-wrap:wrap">
        <div style="font-size:14px">
          ${quando}
          <div style="font-size:11px;color:var(--hint)">${esc(a.percorso_tipo || 'Percorso')}${a.scad ? ` · ${a.fonte === 'mano' ? 'scritto da te' : 'dal report'}` : ''}</div>
        </div>
        <button onclick="apriApp('${a.percorso_id}','${a.scad || ''}','${esc(a.ora || '')}')" class="btn btn-neutral btn-sm">
          ${a.scad ? 'Cambia' : 'Segna un appuntamento'}
        </button>
      </div>`;
  }).join('');
  // ── LE SEZIONI SI PIEGANO (Germano, 13/08) ──────────────────────────────────
  // «Tutte le schede tranne ANAGRAFICA dovrebbero essere espandibili come
  // PERCORSI». ⚠️ Chiesto cosa intendesse, perché Percorsi era l'unica che NON
  // si chiudeva: ha scelto la FRECCETTA sulla sezione (come Scheda Cliente e
  // Strumenti), non le righe che si aprono una per una.
  //
  // ⭐ E ha scelto come devono nascere: **aperte solo se hanno qualcosa in
  // sospeso**. Quindi ogni sezione porta la SUA domanda — non c'è un criterio
  // unico, perché «in sospeso» vuol dire una cosa diversa per ognuna — e la
  // domanda sta scritta accanto alla sezione che riguarda.
  //
  // ⚠️ I pulsanti che finiscono nel <summary> devono fermare il clic
  // (`event.stopPropagation()`), altrimenti premerli chiude la sezione invece
  // di fare quello che dicono.
  // ⚠️ L'ANAGRAFICA non si tocca: non è una sezione pieghevole e resta fissa in
  // cima, com'è oggi (e con dentro il riquadro «pronto per fatturare»).
  const sezione = (titolo, corpo, aperta, azioni) => `
    <div class="card">
      <details class="sec"${aperta ? ' open' : ''}>
        <summary style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer">
          <span style="display:flex;align-items:center;gap:8px"><span class="sec-caret">▸</span>${titolo}</span>
          ${azioni ? `<span style="display:inline-flex;gap:8px;align-items:center">${azioni}</span>` : ''}
        </summary>
        <div style="margin-top:14px">${corpo}</div>
      </details>
    </div>`;

  // In sospeso qui = c'è un percorso attivo SENZA appuntamento, o con uno già
  // passato (è proprio quel vuoto che va visto), oppure ce n'è uno entro una
  // settimana — quello che stai per fare davvero. Se sono tutti fissati e
  // lontani, la sezione riposa chiusa.
  const fra7giorni = new Date(Date.parse(oggiIso) + 7 * 86400000).toISOString().slice(0, 10);
  const appInSospeso = (fatt.appuntamenti || []).some(a =>
    !a.scad || String(a.scad) < oggiIso || String(a.scad) <= fra7giorni);
  const appuntamentoHtml = !(fatt.appuntamenti || []).length ? '' :
    sezione('<h2 style="margin:0">Prossimo appuntamento</h2>', appHtml, appInSospeso);

  // In sospeso qui = c'è un percorso ATTIVO, cioè un lavoro in corso. Un cliente
  // con soli percorsi conclusi apre la scheda senza doverli scorrere.
  const percorsiInSospeso = percorsi.some(p => p.stato === 'attivo');
  const percorsiHtml = sezione(
    `<h2 style="margin:0">Percorsi <span style="font-weight:400;font-size:13px;color:#aaa">(${percorsi.length})</span></h2>`,
    `${avvisoStati}
      ${percorsi.length === 0 ? `<div class="empty">Nessun percorso registrato.</div>` : `
      <table>
        <thead><tr><th>Tipo</th><th>Lavoro svolto</th><th>Modalità</th><th>Prezzo</th><th>Periodo</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          ${percorsi.map(p => { const condiviso = !p.client_id;
            // Un percorso finisce il giorno della sua ULTIMA SESSIONE CONFERMATA,
            // non il giorno in cui ti ricordi di chiuderlo: la data si propone da lì.
            const ultima = sedute
              .filter(s => s.percorso_id === p.id && s.stato === 'confermata' && s.data)
              .map(s => new Date(s.data)).sort((a, b) => b - a)[0];
            const fineIso = ultima ? ultima.toISOString().slice(0, 10) : '';
            const fineIt  = ultima ? itDate(ultima.toISOString()) : '';
            return `<tr>
            <td><strong>${esc(p.tipo)}</strong>${condiviso ? ` <span class="badge" style="background:#eef1f5;color:#4a5568" title="Percorso di gruppo: gestito sulla pagina del progetto">condiviso</span>` : ''}${p.progetto_titolo ? `<br><a href="/dashboard/progetti/${p.progetto_id}" class="badge" style="background:#e8f4fd;color:#1A5280;text-decoration:none">📁 ${esc(p.progetto_titolo)}</a>` : ''}</td>
            <td style="white-space:nowrap">
              <span style="font-size:13px;font-weight:700;color:var(--blue)">${p.n_sessioni_fatte}</span>
              <span style="font-size:11px;color:#aaa"> ${p.n_sessioni_fatte === 1 ? 'sessione' : 'sessioni'}</span>
              <span style="color:#dfe3e8"> · </span>
              <span style="font-weight:700;color:var(--green)">${fmtOre(p.ore_fatte)}</span> <span style="font-size:11px;color:#aaa">h</span>
              ${Number(p.ore_storiche) > 0 ? `<div style="font-size:11px;color:#aaa;margin-top:4px">di cui ${fmtOre(p.ore_storiche)} h prima dell'automazione</div>` : ''}
            </td>
            <td>${p.modalita==='Scambio servizi' ? `<span class="badge" style="background:#e8f4fd;color:#1A5280">Scambio servizi</span>` : p.modalita==='Pro bono' ? `<span class="badge badge-pausa">Pro bono</span>` : p.modalita==='Pacchetto' ? `<span class="badge" style="background:#eaf5ee;color:#2f6b46">Pacchetto</span>` : `<span style="font-size:12px;color:#4a5568">Standard</span>`}</td>
            <td>${prezzoPercorso(p)}${p.promo ? `<br><span class="badge badge-pausa">Promo</span>${p.sconto_note ? ` <span style="font-size:11px;color:#aaa">${esc(p.sconto_note)}</span>` : ''}` : ''}</td>
            <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}${p.data_fine ? `<br>→ ${itDate(p.data_fine)}` : ''}</td>
            <td><span class="badge ${p.stato==='attivo'?'badge-active':'badge-inactive'}">${p.stato==='attivo'?'Attivo':'Concluso'}</span></td>
            <td style="white-space:nowrap;text-align:right">${condiviso
              ? `<a href="/dashboard/progetti/${p.progetto_id}" class="btn btn-neutral btn-sm">Gestisci nel progetto</a>`
              : `<button onclick="editPercorso('${p.id}')" class="btn btn-neutral btn-sm" title="Correggi modalità, prezzo, sessioni previste">Modifica</button> ${p.stato==='attivo' ? `<button onclick="chiudiPercorso('${p.id}','${fineIso}','${fineIt}')" class="btn btn-neutral btn-sm">Chiudi il percorso</button>` : ''}<span style="display:inline-block;width:14px"></span><button onclick="delPercorso('${p.id}')" class="btn btn-danger btn-sm" title="Elimina il percorso">🗑</button>`}</td>
          </tr>`; }).join('')}
        </tbody>
      </table>`}`,
    percorsiInSospeso,
    `<button onclick="event.stopPropagation();openPercorso()" class="btn btn-primary btn-sm">+ Nuovo percorso</button>`);

  // ── Scheda Cliente (una riga per sessione: la tabella storica di Cowork) ──
  const seduteBody = percorsi.length === 0
    ? `<div class="empty">Crea prima un percorso per registrare le sessioni.</div>`
    : sedute.length === 0
      ? `<div class="empty">Nessuna sessione. Le sessioni nascono dai report: salva il report su Drive e premi "⟳ Cerca nuovi report".</div>`
      : `<div style="overflow-x:auto">
          <table class="scheda-cliente">
            <thead><tr><th>Data</th><th>Sessione</th><th>Obiettivo</th><th>Argomenti trattati</th><th>Attività concordate</th><th>Scadenza</th><th>Eseg.</th><th>Note</th><th></th></tr></thead>
            <tbody>${sedute.map(renderSedutaRow).join('')}</tbody>
          </table>
        </div>`;
  // Ore nel titolo della Scheda: contano solo le sessioni CONFERMATE, come
  // ovunque nell'Hub (le bozze non valgono per le ore ICF finché non le approvi).
  const oreConfermate = sedute.reduce((s, x) =>
    s + (x.stato === 'confermata' ? (Number(x.ore) || 0) : 0), 0);
  // In sospeso qui = ci sono sessioni in BOZZA da approvare. Prima nasceva
  // sempre aperta; dal 13/08 vale lo stesso criterio di tutte le altre.
  const bozzeDaApprovare = sedute.some(s => s.stato === 'bozza' && !isProgrammata(s));
  const seduteHtml = `
    <div class="card">
      <details class="sec"${bozzeDaApprovare ? ' open' : ''}>
        <summary style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer">
          <span style="display:flex;align-items:center;gap:8px"><span class="sec-caret">▸</span><h2 style="margin:0">Scheda Cliente <span style="font-weight:400;font-size:13px;color:#aaa">(${sedute.length} ${sedute.length === 1 ? 'sessione' : 'sessioni'}${oreConfermate > 0 ? ` · ${fmtOre(oreConfermate)} h` : ''})</span></h2></span>
          <span style="display:inline-flex;gap:8px;align-items:center">
            ${client.drive_url ? `<button id="scan-btn" onclick="event.stopPropagation();scanDrive()" class="btn btn-gold btn-sm" title="Legge i report Word nuovi dalla cartella Drive e ne aggiunge la riga in bozza">⟳ Cerca nuovi report</button>` : ''}
          </span>
        </summary>
        <div style="margin-top:14px">${seduteBody}</div>
      </details>
    </div>`;

  // ── Amministrazione — FETTA C2 (15/08/2026) ──────────────────────────
  // Germano: «continua a essere caotica… sei sicuro che sia pensata
  // correttamente? non mi voglio trovare a rifare le cose mille volte».
  // Aveva ragione: qui dentro c'erano TRE MODI DIVERSI DI DIRE SOLDI, nati in
  // momenti diversi e mai messi d'accordo — il maturato dei percorsi a sessione,
  // un riflesso delle quote di progetto che leggeva un interruttore ormai morto,
  // e la vecchia tabella dei pagamenti scritti a mano.
  // ⭐ LA MOSSA NON È FONDERLI IN UNA TABELLA SOLA: i soldi arrivano davvero da
  // posti diversi, e nasconderlo non aiuterebbe nessuno. È fargli parlare LA
  // STESSA LINGUA — le stesse parole e gli stessi quattro numeri (Concordato ·
  // Da chiedere · Chiesto · Incassato) — e togliere l'unica fonte che mentiva.
  //
  // ⚠️ La tabella `payments` NON si tocca: guardando i dati veri il 15/08 sono 7
  // righe, tutte «scambio servizi» a 0,00 €, l'ultima del 10/08. È in USO — serve
  // a segnare che uno scambio servizi è saldato — e lo scambio servizi è per
  // decisione di Germano fuori da questo cantiere. L'avevo dato per morto nel
  // piano: era un'assunzione mia, smentita dai dati.
  const trPart = fatt.tranchePartecipazioni || [];
  // Solo l'atteso: serve a decidere se la sezione nasce aperta. L'incassato di
  // qui non si somma più con niente (sono registrazioni fuori dal conto), e
  // tenerlo come variabile orfana è il modo migliore per ritrovarselo sommato
  // per sbaglio fra sei mesi.
  const payAtteso = payments.filter(p=>p.stato==='atteso').reduce((s,p)=>s+Number(p.importo),0);

  // ── Maturato ─────────────────────────────────────────
  // Con la modalità Standard si paga OGNI SESSIONE, quindi quello che hai maturato
  // è una moltiplicazione — sessioni confermate × prezzo di una sessione — non un
  // dato da salvare. Tenerlo come calcolo vuol dire che correggere o cancellare una
  // sessione aggiorna tutto da solo, senza righe rimaste indietro a mentire (stessa
  // regola della "una sola verità" già applicata alle quote dei progetti).
  // Diventerà una riga con l'importo congelato solo quando si chiuderà il mese per
  // fatturare: da lì in poi il numero non deve più cambiare.
  // Contano solo le sedute CONFERMATE: una bozza nata da un report non è ancora
  // un fatto finché il coach non l'ha approvata.
  // La seduta di Intake VALE DUE SESSIONI (Germano, 10/08/2026): dura il doppio e
  // si paga il doppio. Vale solo qui, nel pagamento a sessione: in un Pacchetto il
  // prezzo è già un totale e non si moltiplica niente.
  // ⭐ Dalla Fase 3 il maturato è quello NON ANCORA CHIESTO: una sessione finita
  // in una proforma viva ha smesso di essere «da chiedere» ed esce di qui. È la
  // stessa regola che impedisce di chiedere due volte la stessa sessione, e non
  // ha bisogno di nessuna casella da spuntare: la verità è la riga di proforma.
  // ⭐ Dalla Tappa 3 il conto NON si fa più qui dentro: lo fa `maturato.js`, che
  // è l'unico posto dove sta scritto che cosa vuol dire «da chiedere». Prima era
  // ricopiato in questa pagina; ricopiarlo anche in home e in Amministrazione
  // avrebbe voluto dire tre copie della stessa regola, libere di divergere.
  const mat = fatt.maturato || { totale: 0, nSessioni: 0, mesi: [], bozze: [], nBozze: 0 };
  const maturatoTot = mat.totale;

  // Perché NON si può chiedere il pagamento. Le ragioni sono le stesse che usa
  // la rotta quando crea il documento (stesso modulo), così non può succedere
  // che il pulsante prometta una cosa e il server ne faccia un'altra.
  const motiviBlocco = !mat.nSessioni ? [] : proforma.motiviCheImpediscono({
    emittente: fatt.emittente || {}, soggetto: fiscale.daCliente(client),
    righe: new Array(mat.nSessioni),
  });
  const azioneMaturato = !mat.nSessioni ? '' : (motiviBlocco.length ? `
        <div style="background:#fffdf6;border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;margin-top:10px">
          <div style="font-size:13px;font-weight:700;margin-bottom:5px">Non si può ancora chiedere il pagamento</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#4A4A4A">
            ${motiviBlocco.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
          </ul>
        </div>` : `
        <div style="margin-top:10px">
          <button onclick="chiediPagamento()" id="pf-btn" class="btn btn-primary btn-sm">
            Chiedi il pagamento — € ${fiscale.euro(maturatoTot)}
          </button>
          <div id="pf-error" style="display:none;margin-top:10px" class="flash-error"></div>
        </div>`);

  const avvisoBozze = mat.nBozze ? `
        <div style="font-size:12px;color:#8a6d1e;background:#fdf6e3;border-radius:8px;padding:9px 12px;margin-top:10px">
          ⚠️ ${mat.nBozze === 1 ? 'C’è 1 sessione in bozza' : `Ci sono ${mat.nBozze} sessioni in bozza`}:
          finché non ${mat.nBozze === 1 ? 'la approvi' : 'le approvi'} non ${mat.nBozze === 1 ? 'entra' : 'entrano'} nella proforma.
        </div>` : '';

  // ⭐ DUE RIGHE, non l'elenco (decisione di Germano del 12/08, punto 9c). Qui
  // serve sapere a colpo d'occhio, prima di una sessione, se quella persona ha
  // qualcosa in sospeso: quanto c'è da chiedere, e com'è finita l'ultima volta.
  // L'elenco completo, e i passaggi da fare, stanno in Amministrazione → Proforma.
  const STATO_PF = {
    emessa:    { label: 'Da mandare', bg: '#fff8dc', c: '#7a5c00' },
    inviata:   { label: 'Mandata',    bg: '#e8f4fd', c: '#1A5280' },
    annullata: { label: 'Annullata',  bg: '#f1f3f6', c: '#8a8a8a' },
  };
  const rigaDue = (etichetta, dentro) => `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef1f5;flex-wrap:wrap">
        <div class="field-label" style="margin:0;flex:none">${etichetta}</div>
        <div style="text-align:right;flex:1;min-width:200px">${dentro}</div>
      </div>`;

  const mesiTxt = mat.mesi.map(m =>
    `${meseEsteso(m.mese)} · ${m.n} ${m.n === 1 ? 'sessione' : 'sessioni'}`).join(' — ');

  const rigaDaChiedere = rigaDue('Da chiedere', mat.nSessioni ? `
      <strong style="font-size:16px">€ ${fiscale.euro(maturatoTot)}</strong>
      <div style="font-size:12px;color:var(--hint);text-transform:capitalize">${mesiTxt}</div>`
    : `<span style="font-size:13px;color:var(--hint)">niente in sospeso</span>`);

  const ultima = proforme[0];              // già ordinate dalla più recente
  const stU = ultima ? (STATO_PF[ultima.stato] || STATO_PF.emessa) : null;
  const rigaUltima = !ultima ? '' : rigaDue('Ultima proforma', `
      <a href="#" onclick="apriPdf('${ultima.id}','Proforma n. ${esc(ultima.numero)}');return false" style="font-weight:700;color:var(--blue);text-decoration:none">n. ${esc(ultima.numero)}</a>
      <span style="font-size:13px;color:var(--muted);margin-left:8px">${ultima.data_emissione ? itDate(ultima.data_emissione) : ''}</span>
      <span style="font-size:13px;margin-left:8px">€ ${fiscale.euro(ultima.da_pagare)}</span>
      <span class="badge" style="background:${stU.bg};color:${stU.c};margin-left:8px">${stU.label}</span>
      ${proforme.length > 1 ? `<div style="font-size:12px;color:var(--hint)">altre ${proforme.length - 1} ${proforme.length - 1 === 1 ? 'proforma' : 'proforma'} prima di questa</div>` : ''}`);

  const maturatoBlock = (!mat.nSessioni && !mat.nBozze && !proforme.length) ? '' : `
      <div style="margin-bottom:18px">
        ${rigaDaChiedere}
        ${rigaUltima}
        ${avvisoBozze}
        ${azioneMaturato}
        <div style="margin-top:12px">
          <a href="/dashboard/amministrazione/proforma" style="font-size:12px;color:var(--blue);text-decoration:none">Vai all'Amministrazione →</a>
        </div>
      </div>`;

  // ── I PERCORSI A PACCHETTO — fetta C (15/08/2026) ────────────────────
  // In un pacchetto la cifra è concordata all'inizio: non matura sessione per
  // sessione, si paga a rate. Germano: «il pacchetto segue la logica del
  // committente, con percentuali variabili» → stessa tabella di rate, stessa
  // finestrella, stessi quattro numeri del progetto. Una sola idea di «rata».
  // ⚠️ Fino a oggi un percorso a Pacchetto usciva da tutto IN SILENZIO
  // (`maturato.js` conta solo `modalita = 'Standard'`): non era un guasto, era
  // un pezzo di modello che non era mai stato costruito.
  const trPerc = fatt.tranchePercorsi || [];
  // ⭐ C3 — l'insieme delle rate gia dentro una proforma viva. Da qui esce lo
  // stato «Chiesta» e la sparizione del pulsante: nessuna casella da spuntare.
  const rateChieste = fatt.rateChieste || new Map();
  const pacchetti = percorsi
    .filter(pc => pc.modalita === 'Pacchetto' && pc.client_id === client.id)
    .map(pc => {
      const quota   = pc.prezzo != null ? Math.round(Number(pc.prezzo)) : 0;
      const salvate = trPerc.filter(t => t.percorso_id === pc.id);
      return {
        id: pc.id,
        titolo: `${pc.tipo || 'Percorso'}${pc.data_inizio ? ' · dal ' + itDate(pc.data_inizio) : ''}`,
        quota, salvate,
        data_inizio: pc.data_inizio ? String(pc.data_inizio).slice(0, 10) : '',
        data_meta:   pc.data_meta   ? String(pc.data_meta).slice(0, 10)   : '',
        data_fine:   pc.data_fine   ? String(pc.data_fine).slice(0, 10)   : '',
        righe: pianoUi.righeDi(salvate, quota, 'committente', rateChieste),
        tot4:  tranche.totali(salvate, quota, rateChieste),
        // La scadenza si calcola qui, col modulo puro: le tre date stanno sul
        // percorso, e «metà percorso» può ancora non esserci — che è
        // un'informazione, non un errore.
        scadenze: salvate.map(t => tranche.scadenza(t, pc)),
      };
    });

  // ⭐ La tabella delle rate è UNA SOLA, per il pacchetto e per la quota di un
  // progetto: sono la stessa cosa, e Germano l'ha detto — «una quota di un
  // progetto costa come o più di un pacchetto». Scriverla due volte avrebbe
  // rimesso in piedi il difetto che abbiamo appena tolto.
  const tabellaRate = (salvate, quota, scadenze) => {
    const righeSalvate = salvate.map((t, i) => {
      const stato = tranche.statoDi(t, rateChieste);
      const st   = tranche.STATI[stato] || tranche.STATI.da_chiedere;
      const imp  = Math.round(Number(t.importo));
      const perc = quota ? Math.round(imp / quota * 100) : null;
      const scad = scadenze[i];
      // ⭐ C4 — l'incasso si registra sul DOCUMENTO che contiene la rata, non
      // sulla rata. Stessa scelta e stesse parole della tabella condivisa in
      // piano-ui.js: le due tabelle mostrano la stessa cosa.
      const doc = rateChieste.get(t.id) || {};
      const dataInc = doc.ultimoIncasso || t.data_incasso;
      const comando = (stato === 'da_chiedere')
        ? `<button onclick="chiediRata('${t.id}','${esc(t.etichetta)}, \u20ac ${fiscale.euroIntero(imp)}')" class="btn btn-primary btn-sm">Chiedi il pagamento</button>`
        : (stato === 'da_mandare')
        ? `<a href="/dashboard/amministrazione/proforma" class="btn btn-primary btn-sm">Rileggi e manda</a>`
        : (stato === 'incassata')
        ? `<span style="font-size:11.5px;color:var(--hint)">${dataInc ? 'il ' + itDate(dataInc) : ''}</span>
           ${doc.proformaId
             ? `<a href="/dashboard/amministrazione/proforma" style="font-size:11.5px;color:var(--muted)">n. ${esc(doc.numero)}</a>`
             : `<button onclick="segnaStato('${t.id}','da_chiedere')" class="btn btn-neutral btn-sm" title="Torna indietro">Annulla</button>`}`
        : doc.proformaId
        ? `<button onclick="apriIncasso('${doc.proformaId}','${esc(t.etichetta)}',${Number(doc.residuo) || 0})" class="btn btn-neutral btn-sm">È arrivato</button>`
        : '';
      return `<tr>
          <td>${esc(t.etichetta)}${perc !== null ? ` <span style="font-size:11px;color:var(--hint)">${perc}%</span>` : ''}</td>
          <td style="white-space:nowrap">€ ${fiscale.euroIntero(imp)}</td>
          <td style="font-size:12px;white-space:nowrap;color:${scad ? 'var(--ink)' : 'var(--hint)'}">${scad ? itDate(scad) : '—'}</td>
          <td style="white-space:nowrap"><span class="badge" style="background:${st.bg};color:${st.c}">${st.label}</span></td>
          <td style="text-align:right;white-space:nowrap">${comando}</td>
        </tr>`;
    }).join('');
    return !salvate.length ? '' : `<div style="overflow-x:auto;margin-top:10px"><table style="min-width:460px">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Rata</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Importo</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Scade il</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">A che punto</th>
            <th></th>
          </tr></thead>
          <tbody>${righeSalvate}</tbody>
        </table></div>`;
  };

  const pacchettoBlock = pc => {
    // Una scheda non deve dire «pronto» senza dire cosa fare: se il piano non
    // c'è, qui c'è scritto che manca e il pulsante per farlo è a fianco.
    const vuoto = !pc.quota
      ? `<div style="font-size:12.5px;color:#b45309;padding:8px 0">Questo pacchetto non ha ancora un prezzo: scrivilo nel piano.</div>`
      : `<div style="font-size:12.5px;color:#b45309;padding:8px 0">Il piano delle rate non è ancora impostato — apri «Modifica il piano».</div>`;
    return `
      <div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <strong style="font-size:14px">Pacchetto</strong>
            <span style="font-size:12px;color:var(--hint);margin-left:6px">${esc(pc.titolo)}</span>
          </div>
          <button onclick="apriPianoPacchetto('${pc.id}')" class="btn btn-primary btn-sm">Modifica il piano</button>
        </div>
        ${pianoUi.quattroNumeri(pc.tot4, pc.salvate.length > 0)}
        ${pc.salvate.length ? tabellaRate(pc.salvate, pc.quota, pc.scadenze) : vuoto}
      </div>`;
  };
  const pacchettiHtml = pacchetti.length ? `
      <div style="margin-bottom:18px">
        <div class="field-label" style="margin-bottom:6px">Percorsi a pacchetto</div>
        ${pacchetti.map(pacchettoBlock).join('')}
      </div>` : '';

  // ── La quota che questa persona paga dentro un progetto ──────────────
  // ⭐ Adesso viene dalle RATE, come sulla pagina del progetto: le stesse
  // parole, gli stessi quattro numeri. Prima c'era un'etichetta
  // «Incassato / Da incassare» che parlava dell'INTERA quota e nasceva da un
  // interruttore che nessuno aggiorna più.
  // ⚠️ Resta di SOLA LETTURA e manda al progetto: il piano di un progetto si
  // tocca nella pagina del progetto, e avere due posti dove si scrive la stessa
  // cosa è il difetto che stiamo togliendo, non uno da aggiungere.
  // 🔴 15/08 — Germano: «gli importi dei clienti dei progetti andrebbero gestiti
  // come i pacchetti dei percorsi singoli… in pratica diventa uguale a quello del
  // progetto». È già vero nel modello (la quota di un partecipante è fatta di
  // rate dal 12/08): mancava solo la PORTA. Adesso il piano si apre anche da qui,
  // con la STESSA finestrella, e si tocca solo il piano di questa persona.
  const progettiConto = progetti.map(pr => {
    const q       = pr.quota_coachee != null ? Math.round(Number(pr.quota_coachee)) : 0;
    const salvate = trPart.filter(t => t.partecipazione_id === pr.part_id);
    return { pr, q, salvate,
      tot4: tranche.totali(salvate, q, rateChieste),
      // Le date degli inneschi stanno sul PROGETTO: la scadenza si calcola da
      // quelle, ed è per questo che la finestrella le mostra spente invece di
      // nasconderle.
      scadenze: salvate.map(t => tranche.scadenza(t, pr)) };
  });
  const progettiRows = progettiConto.map(({ pr, q, salvate, tot4, scadenze }) => `
      <div style="padding:12px 0;border-top:1px solid #eef1f5">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
          <div>
            <strong style="font-size:14px">${esc(pr.titolo)}</strong>
            <div style="font-size:12px;color:#aaa">Committente: ${esc(pr.committente_nome)}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${q ? `<button onclick="apriPianoPartecipazione('${pr.part_id}')" class="btn btn-primary btn-sm">Modifica il piano</button>` : ''}
            <a href="/dashboard/progetti/${pr.progetto_id}" class="btn btn-neutral btn-sm">Vai al progetto</a>
          </div>
        </div>
        ${!q
          ? `<div style="font-size:12.5px;color:#b45309">Quota da definire — si scrive nel progetto.</div>`
          : pianoUi.quattroNumeri(tot4, salvate.length > 0)}
        ${q && !salvate.length
          ? `<div style="font-size:12.5px;color:#b45309;margin-top:6px">Il piano delle rate non è ancora impostato — apri «Modifica il piano».</div>`
          : tabellaRate(salvate, q, scadenze)}
      </div>`).join('');
  const progettiBlock = progetti.length ? `
      <div style="margin-bottom:${payments.length ? '18px' : '0'}">
        <div class="field-label" style="margin-bottom:2px">Quote nei progetti</div>
        ${progettiRows}
      </div>` : '';
  // La finestrella del piano serve se c'è almeno una cifra concordata da dividere
  // in rate: un pacchetto, o una quota dentro un progetto.
  const pianoAttivo = pacchetti.length > 0 || progettiConto.some(g => g.q > 0);
  const paymentsTable = payments.length ? `
      ${/* ⚠️ NON è un doppione degli altri blocchi: è il registro dei pagamenti
            scritti a mano, e oggi serve **solo** allo scambio servizi (7 righe
            in produzione al 15/08, tutte a 0,00 €). Lo scambio servizi sta
            fuori dal cantiere dei soldi per decisione di Germano, quindi questi
            importi restano fuori dai tre numeri in cima. */ ''}
      <div class="field-label" style="margin-bottom:2px">Registrazioni di prima</div>
      <div style="font-size:11.5px;color:var(--hint);margin-bottom:6px">
        Storico in sola lettura: da qui non se ne aggiungono più. Sono i pagamenti segnati a mano
        prima che ogni cifra concordata avesse le sue rate — quasi tutti scambi di servizi.
        Restano fuori dal conto qui sopra.</div>
      <table>
        <thead><tr><th>Importo</th><th>Tipo</th><th>Data</th><th>Stato</th><th>Note</th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr>
            <td><strong>€ ${fiscale.euro(p.importo)}</strong></td>
            <td style="font-size:12px">${esc(p.tipo)}</td>
            <td style="font-size:12px;color:#aaa">${p.data_pagamento ? itDate(p.data_pagamento) : '—'}</td>
            <td>${p.stato==='ricevuto' ? `<span class="badge badge-active">Incassato</span>` : `<span class="badge badge-inactive">Da incassare</span>`}</td>
            <td style="font-size:12px;color:#aaa">${esc(p.note||'')}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';
  // In sospeso qui = ci sono SOLDI CHE ASPETTANO: qualcosa di maturato da
  // chiedere, una proforma creata e non ancora spedita, o un pagamento atteso.
  // ⚠️ Chi è «da mandare» lo dice `proforma.daMandare`, come in home e nella
  // pagina Proforma: la stessa domanda non si scrive tre volte.
  // I tre numeri del riepilogo restano nel titolo, quindi si leggono anche a
  // sezione chiusa: è l'informazione, non l'azione.
  // Un pacchetto è «in sospeso» quando c'è una rata ancora da chiedere o già
  // chiesta e non arrivata — e anche quando il piano non c'è proprio: quel
  // vuoto è la cosa da vedere per prima.
  const pacchettoInSospeso = pacchetti.some(pc =>
    !pc.salvate.length || pc.tot4.daChiedere > 0 || pc.tot4.chiesto > 0);
  const progettoInSospeso = progettiConto.some(g =>
    g.q > 0 && (!g.salvate.length || g.tot4.daChiedere > 0 || g.tot4.chiesto > 0));
  const soldiInSospeso = maturatoTot > 0 || payAtteso > 0 || proforme.some(proforma.daMandare)
    || pacchettoInSospeso || progettoInSospeso;

  // ⭐ I TRE NUMERI IN CIMA, uguali per chiunque: da chiedere · chiesto ·
  // incassato. «Concordato» non sale quassù di proposito — per un percorso a
  // sessione non esiste una cifra concordata, matura settimana per settimana, e
  // un totale che vale per due casi su tre sarebbe un numero da interpretare.
  // Sta dentro ogni blocco, dove vuol dire qualcosa.
  // ⚠️ Si sommano SOLO cifre della stessa natura: imponibili (il maturato e le
  // rate). Le proforma NON entrano qui: i loro totali contengono l'IVA, e
  // sommarli alle rate darebbe un numero che non è né l'uno né l'altro.
  // «Chiesto» resta a zero finché non arriva C3 — è la proforma di una rata ad
  // accenderlo, ed è giusto che si veda che oggi non c'è.
  const sommaStato = (chiave) =>
    pacchetti.reduce((s, pc) => s + pc.tot4[chiave], 0)
    + progettiConto.reduce((s, g) => s + g.tot4[chiave], 0);
  const totDaChiedere = maturatoTot + sommaStato('daChiedere');
  const totChiesto    = sommaStato('chiesto');
  const totIncassato  = sommaStato('incassato');
  const numeroTitolo = (etichetta, valore, colore) => valore <= 0 ? '' :
    ` · ${etichetta}: <strong style="color:${colore}">€ ${fiscale.euro(valore)}</strong>`;
  const paymentsHtml = sezione(
    `<h2 style="margin:0">Amministrazione
      <span style="font-size:12px;font-weight:400;color:#aaa;margin-left:10px">
        Da chiedere: <strong style="color:#1A5280">€ ${fiscale.euro(totDaChiedere)}</strong>
        ${numeroTitolo('Chiesto', totChiesto, '#D8AE2E')}
        ${numeroTitolo('Incassato', totIncassato, '#4F8B73')}
      </span>
    </h2>`,
    `${maturatoBlock}
      ${pacchettiHtml}
      ${progettiBlock}
      ${paymentsTable}`,
    soldiInSospeso,
    // ⛔ 15/08 — VIA il pulsante «+ Pagamento». Germano: «qui non dovrebbe
    // servire», e ha ragione: da quando ogni cifra concordata ha le sue rate
    // (pacchetto e quota di progetto), non resta niente di vero da scrivere a
    // mano. Le righe già segnate restano, in sola lettura: sono quasi tutti
    // scambi di servizi, che stanno fuori da questo cantiere finché non ne
    // parlerà col commercialista. Cancellarle sarebbe stato buttare via il suo
    // storico per fare ordine.
    '');

  // ── Strumenti utilizzati — sezione a fisarmonica ─────
  // Nomi e icone IDENTICI a quelli che il cliente vede in Coaching-Tools: uno
  // strumento si chiama allo stesso modo nelle due app. Mancavano i quattro più
  // recenti (le due ruote, SWOT, Covey/Eisenhower): comparivano col nome tecnico.
  // Le etichette vengono da STRUMENTI (in cima al file), la stessa lista che
  // riempie la tendina dei permessi: così non possono divergere.
  const strumentiItems = sessions.length === 0
    ? `<div class="empty">Nessuno strumento compilato dal cliente.</div>`
    : sessions.map(s => `
      <details class="acc">
        <summary>
          <span class="sec-caret">▸</span>
          <span style="font-weight:700;color:var(--ink)">${TOOL_LABEL[s.tool] || esc(s.tool)}</span>
          <span style="color:#aaa;font-size:12px">· ${itDate(s.created_at)}</span>
          <span style="margin-left:auto;font-size:11px;color:#aaa">agg. ${fmtDate(s.updated_at)}</span>
        </summary>
        <div class="acc-body" style="line-height:1.7">${renderSessionData(s.tool, s.data)}</div>
      </details>`).join('');
  const strumentiHtml = `
    <div class="card">
      <details class="sec">
        <summary style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <span class="sec-caret">▸</span><h2 style="margin:0">Strumenti utilizzati <span style="font-weight:400;font-size:13px;color:#aaa">(${sessions.length})</span></h2>
        </summary>
        <div style="margin-top:14px">${strumentiItems}</div>
      </details>
    </div>`;

  // ── Recall / prossima azione (evidenziata se presente) ──
  const recallHtml = client.prossima_azione ? `
    <div style="margin-top:12px;font-size:13px;background:#fff8ec;padding:10px 14px;border-radius:8px;border-left:3px solid var(--gold)">
      <strong>Prossima azione:</strong> ${esc(client.prossima_azione)}
      ${client.prossima_azione_data ? ` — <span style="color:#7a5c00">${itDate(client.prossima_azione_data)}</span>` : ''}
    </div>` : '';

  // ── Azioni e collegamenti (la zona in fondo alla scheda anagrafica) ──
  // Una zona SOLA per tutti i link e tutti i pulsanti, divisi per funzione.
  // Ogni cosa compare UNA volta, col suo stato accanto: prima la cartella Drive,
  // il link d'accesso e le date delle mail stavano sia tra i dati sia sui
  // pulsanti (Germano 27/07: "raggruppa tutti i link e i pulsanti, fai in modo
  // che non ci siano duplicazioni"). Solo forma: le funzioni sono quelle di ieri.
  // ── Permessi a termine sugli strumenti (2026-07-31) ────
  // La data della prossima sessione NON si chiede al coach: sta già nel database,
  // scritta dai report (`sedute.scadenza`), la stessa che alimenta il reminder in
  // home. Qui si prende, del cliente, la seduta confermata più recente che porti
  // una data vera; se non è passata, è la scadenza da proporre per il compito.
  const prossimaSess = sedute
    .filter(s => s.stato === 'confermata' && /^\d{4}-\d{2}-\d{2}$/.test(String(s.scadenza || '')))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    .map(s => s.scadenza)
    .find(d => d >= new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })) || null;

  // Nomi degli strumenti per la tendina: senza icone (la pagina è del coach) e
  // nell'ordine in cui li vede il cliente.
  const opzioniStrumenti = STRUMENTI
    .map(t => `<option value="${attr(t.key)}">${esc(t.nome)}</option>`).join('');

  // Cosa è aperto adesso. Un permesso scaduto non si mostra: conta quello che il
  // cliente può fare ORA. Nella riga della scheda va solo il riassunto in una
  // frase — i pulsanti stanno tutti dentro la finestrella, così la riga resta
  // pulita come le altre.
  const permessiVivi = permessi.filter(p => p.valido);
  const descrivi = p =>
    p.attende_sessione ? 'fino alla prossima sessione, che non è ancora fissata'
    : (p.primo_accesso || p.durata_ore == null) ? `fino al ${itDateTime(p.fine)}`
    : `${p.durata_ore} ore da quando lo apre (non ancora aperto)`;
  const permessiSintesi = permessiVivi.length === 0
    ? 'Nessun permesso aperto: in questo momento il cliente non apre nulla.'
    : permessiVivi.length === 1
      ? `Aperto: <strong>${permessiVivi[0].tool ? (TOOL_LABEL[permessiVivi[0].tool] || esc(permessiVivi[0].tool)) : 'tutti gli strumenti'}</strong>, ${descrivi(permessiVivi[0])}.`
      : `${permessiVivi.length} permessi aperti.`;
  const permessiElenco = permessiVivi.length === 0
    ? '<div style="font-size:13px;color:#8a94a6">Nessun permesso aperto in questo momento.</div>'
    : permessiVivi.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
          <span style="flex:1">✓ <strong>${p.tool ? (TOOL_LABEL[p.tool] || esc(p.tool)) : 'Tutti gli strumenti'}</strong>
            <span style="color:#8a94a6">— ${descrivi(p)}</span></span>
          <button onclick="chiudiPermesso('${attr(p.id)}')" class="btn btn-off btn-sm" style="padding:2px 9px;font-size:11px">chiudi</button>
        </div>`).join('');

  // ── PROPOSTA letta dai moduli, da approvare (08/08) ──────────────────
  // Sta in cima alla scheda perché è una cosa che ASPETTA il coach. Mostra il
  // confronto «c'è scritto X → il modulo dice Y»: i campi oggi vuoti arrivano
  // già spuntati, quelli che SOSTITUIREBBERO un dato esistente arrivano spenti,
  // perché è lì che si sbaglia (nella ricognizione dell'08/08 tre valori su
  // tutti erano da non applicare, fra cui un'email scritta male dal cliente).
  const NOMI_CAMPO = {
    data_nascita:'Data di nascita', luogo_nascita:'Luogo di nascita', via:'Via',
    citta:'Città', provincia:'Provincia', cap:'CAP', telefono:'Telefono', email:'Email',
    professione:'Professione', societa:'Società', codice_fiscale:'Codice fiscale',
    pec:'PEC', codice_sdi:'Codice SDI',
  };
  const bozza = client.bozza_anagrafica
    ? (typeof client.bozza_anagrafica === 'string' ? JSON.parse(client.bozza_anagrafica) : client.bozza_anagrafica)
    : null;
  const bozzaHtml = !bozza ? '' : `
    <div class="card" style="border-left:4px solid var(--gold);background:#FFFDF5">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <h2 style="margin:0;font-size:17px">Dati letti dai documenti</h2>
        <span class="badge" style="background:#F3E5B5;color:#7a5c00">da controllare</span>
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:14px">
        Da ${bozza.moduli.map(m => esc(m.nome)).join(' · ')}. Spunta quello che vuoi tenere: quello che sostituisce un dato che hai già arriva <strong>non spuntato</strong>.
      </div>
      ${(bozza.proposte || []).length ? `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--hint);font-size:11px;text-transform:uppercase;letter-spacing:.06em">
          <th style="padding:5px 8px 5px 0;width:26px"></th><th style="padding:5px 8px 5px 0">Campo</th>
          <th style="padding:5px 8px 5px 0">C&rsquo;è scritto</th><th style="padding:5px 0">Il documento dice <span style="text-transform:none;font-weight:400">(correggibile)</span></th>
        </tr></thead>
        <tbody>
        ${bozza.proposte.map(p => `
          <tr style="border-top:1px solid var(--line)">
            <td style="padding:9px 8px 9px 0"><input type="checkbox" class="bz-campo" value="${attr(p.campo)}" ${p.prima ? '' : 'checked'} style="width:20px;height:20px"></td>
            <td style="padding:9px 8px 9px 0;color:var(--muted)">${esc(NOMI_CAMPO[p.campo] || p.campo)}</td>
            <td style="padding:9px 8px 9px 0">${p.prima ? esc(p.prima) : '<span style="color:#ccc">— vuoto</span>'}</td>
            ${/* Il valore è MODIFICABILE (Germano 08/08: «non c'è modo di fare
                  eventuali correzioni»). Quello che si scrive qui è quello che
                  viene salvato: se il documento è stato letto male, o il cliente
                  ha scritto male, si corregge subito senza dover riaprire la
                  scheda dopo. */ ''}
            <td style="padding:9px 0"><input class="bz-valore" data-campo="${attr(p.campo)}" value="${attr(p.dopo)}"
                 style="width:100%;font-weight:600;padding:7px 9px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px"></td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${bozza.consenso ? `
      <div style="margin-top:12px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:8px">
        <label style="display:flex;gap:9px;align-items:flex-start;margin:0;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="checkbox" id="bz-consenso" ${bozza.consensoNuovo || bozza.dataConsenso ? 'checked' : ''} style="width:20px;height:20px;margin-top:1px">
          <span><strong>Consenso al trattamento dei dati</strong>${bozza.dataConsenso ? ` — sottoscritto il ${itDate(bozza.dataConsenso)}` : ''}
          ${bozza.comeRisulta ? `<br><span style="color:var(--hint);font-size:12px">${esc(bozza.comeRisulta)}</span>` : ''}</span>
        </label>
      </div>` : ''}
      ${(bozza.daEliminare || []).length ? `
      <div style="margin-top:10px;font-size:12px;color:#B45309">
        🗑 Approvando, ${bozza.daEliminare.length === 1 ? 'verrà eliminato da Drive il modulo rimasto in bianco' : 'verranno eliminati da Drive i moduli rimasti in bianco'}: ${bozza.daEliminare.map(v => esc(v.nome)).join(', ')}.
      </div>` : ''}
      <div id="bz-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button onclick="approvaBozza()" class="btn btn-primary btn-sm">✓ Approva e scrivi</button>
        <button onclick="scartaBozza()" class="btn btn-neutral btn-sm">Scarta</button>
      </div>
    </div>`;

  const azioniHtml = `
    <div class="az-bar">
      <div class="zona-tit">Azioni e collegamenti</div>
      <div class="az-grid">

        <div class="az-gruppo">
          <div class="az-nome">Aggiornamento dati</div>
          <div class="az-btns">
            <button onclick="openEdit()" class="btn btn-primary btn-sm">✎ Modifica dati</button>
            <button class="btn btn-off btn-sm" disabled title="Funzione in arrivo: leggerà i dati dalla scheda anagrafica che il cliente ti rimanda compilata">⟳ Cerca la scheda su Drive</button>
            <span class="az-arrivo">in arrivo</span>
          </div>
          <div class="az-stato">Scheda anagrafica del cliente: <strong style="color:var(--muted)">non ancora acquisita</strong>. Quando la salvi su Drive, l'Hub ne prenderà i dati.</div>
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Documenti al cliente</div>
          <div class="az-btns">
            <button onclick="openMail1()" class="btn btn-gold btn-sm">✉️ Rivedi e invia Mail 1</button>
            <button onclick="openMail2()" class="btn btn-gold btn-sm">✉️ Rivedi e invia Mail 2</button>
          </div>
          <div class="az-stato">
            ${mail1SentTxt ? `<span class="az-fatto">✓ Mail 1 inviata il ${mail1SentTxt}</span>` : 'Mail 1 non inviata'} — lettera · scheda anagrafica · Codice ICF<br>
            ${mail2SentTxt ? `<span class="az-fatto">✓ Mail 2 inviata il ${mail2SentTxt}</span>` : 'Mail 2 non inviata'} — contratto · agenda
          </div>
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Cartella su Drive</div>
          ${client.drive_url ? `
          <div class="az-link"><a href="${esc(client.drive_url)}" target="_blank">Apri la cartella su Drive ↗</a></div>
          <div class="az-btns">
            <button onclick="copyLink(this.dataset.url)" data-url="${attr(client.drive_url)}" class="btn btn-neutral btn-sm">📋 Copia il link</button>
          </div>
          <div class="az-stato">Qui vivono i report delle sessioni e la documentazione del cliente.</div>` : `
          <div class="az-btns">
            <button id="drive-folders-btn" onclick="createDriveFolders()" class="btn btn-neutral btn-sm">Crea cartelle su Drive</button>
            <span id="drive-folders-msg" style="font-size:12px;color:#6B7280"></span>
          </div>
          <div class="az-stato">Non ancora creata. Serve per i report delle sessioni e per la documentazione.</div>`}
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Accesso agli strumenti</div>
          <div class="az-btns">
            <button onclick="openStrumento()" class="btn btn-primary btn-sm">🔑 Manda uno strumento</button>
          </div>
          <div class="az-stato">${permessiSintesi}</div>
        </div>

      </div>

      <div class="az-danger">
        <span class="az-stato" style="margin:0">Cancella la persona e tutto il suo storico.</span>
        <button onclick="deleteClient()" class="btn btn-danger btn-sm">🗑 Elimina il cliente</button>
      </div>
    </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(client.name)}</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'individuali', briciole: [
    { label: 'Percorsi Individuali', href: '/dashboard/individuali' },
    { label: client.name },
  ] })}
  <div class="container">

    ${bozzaHtml}

    <!-- SCHEDA ANAGRAFICA — due zone: sopra i dati, in fondo azioni e collegamenti -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <h1 style="margin:0">${esc(client.name)}</h1>
        <span class="badge" style="background:${ac}18;color:${ac}">${area}</span>
        <span class="badge ${st.cls}">${st.label}</span>
        ${/* Qui stava il bollino «🔒 Accesso off»: tolto il 31/07 insieme
              all'interruttore generale che rappresentava. Non spiegava niente e
              soprattutto non esiste più niente da rappresentare — chi entra lo
              decidono i permessi a termine. */ ''}
      </div>

      ${/* 11/08 — due colonne affiancate invece di una fila lunga: a sinistra
            CHI È, a destra i SOLDI e le cose da fare. La scheda si era riempita
            e in colonna unica bisognava scorrere per arrivare in fondo.
            Sotto i 1024px torna una colonna sola: su un telefono due colonne
            sarebbero due strisce strette e illeggibili. */ ''}
      <div class="scheda-2col">
      <div>
      <div class="zona-tit">Dati del Cliente</div>
      <div><div class="field-label">Indirizzo</div><div class="field-value">${composeAddress(client) ? esc(composeAddress(client)) : '<span style="color:#ccc">—</span>'}</div></div>
      <div style="margin-top:12px"><div class="field-label">Contatti</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:4px">
          <div><span style="font-size:11px;color:var(--hint)">Telefono</span><div class="field-value">${val(client.telefono)}</div></div>
          <div><span style="font-size:11px;color:var(--hint)">Email</span><div class="field-value">${val(client.email)}</div></div>
          <div><span style="font-size:11px;color:var(--hint)">Social</span><div class="field-value">${client.altro_recapito ? `${client.social_tipo ? `<strong>${esc(client.social_tipo)}</strong> · ` : ''}${esc(client.altro_recapito)}` : '<span style="color:#ccc">—</span>'}</div></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:14px;margin-top:14px">
        <div><div class="field-label">Data di nascita</div><div class="field-value">${client.data_nascita ? itDate(client.data_nascita) : '<span style="color:#ccc">—</span>'}${client.luogo_nascita ? `<span style="color:var(--hint)"> · ${esc(client.luogo_nascita)}</span>` : ''}</div></div>
        <div><div class="field-label">Professione</div><div class="field-value">${val(client.professione)}</div></div>
        <div><div class="field-label">Società</div><div class="field-value">${val(client.societa)}</div></div>
        <div><div class="field-label">Come ci ha conosciuto</div><div class="field-value">${FONTE_LABEL[client.fonte]||val(client.fonte)}</div></div>
        <div><div class="field-label">Consenso privacy</div><div class="field-value">${client.consenso_privacy ? `Sì${client.consenso_data ? ` (${itDate(client.consenso_data)})` : ''}` : '<span style="color:#ccc">No</span>'}</div></div>
      </div>
      </div>
      <div>
      ${/* Dati per la fatturazione: arrivano dal contratto firmato che il cliente
            rimanda (automazione moduli, 07/08), e dall'11/08 portano il VERDETTO
            «pronto per fatturare» / «manca questo».

            ⚠️ Il verdetto compare SOLO se il cliente ha almeno un percorso con un
            prezzo (scelta di Germano, 11/08). Motivo: metà dei clienti in archivio
            sono gusci di prova o scambi di servizi — segnalare a tutti «manca il
            codice fiscale» riempirebbe l'Hub di allarmi che non vogliono dire
            niente. Nessun percorso a pagamento = niente da fatturare = niente da
            segnalare. È la lezione dell'11/08: prima di trasformare un dato in un
            allarme, sapere che cos'è. */ ''}
      ${(() => {
        const st = fiscale.statoFatturabilita(fiscale.daCliente(client));
        const cSoldi = percorsi.some(p => Number(p.prezzo) > 0);
        const cDati  = !!(client.codice_fiscale || client.partita_iva || client.pec || client.codice_sdi);
        if (!cSoldi && !cDati) return '';
        const STILE = {
          pronto:        { bg:'#e7f1ec', color:'#2e6b52', bordo:'#4F8B73' },
          incompleto:    { bg:'#fdf6e3', color:'#8a6d1a', bordo:'#D8AE2E' },
          da_verificare: { bg:'#e8f4fd', color:'#1A5280', bordo:'#223B6E' },
        }[st.stato];
        const REGIME_LABEL = { ordinario:'Regime ordinario', forfettario:'Regime forfettario' };
        return `
      <div>
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div class="zona-tit" style="margin:0">Dati per la fatturazione</div>
          <span style="font-size:11px;color:var(--hint)">${esc(st.etichettaCategoria)}</span>
        </div>
        ${cSoldi ? `
        <div style="margin-bottom:14px;padding:11px 13px;border-left:3px solid ${STILE.bordo};background:${STILE.bg};color:${STILE.color};border-radius:4px;font-size:14px;line-height:1.45">
          ${st.stato === 'pronto' ? '✅ ' : '⚠️ '}${esc(st.messaggio)}
        </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:14px">
          <div><div class="field-label">Codice fiscale</div><div class="field-value">${val(client.codice_fiscale)}</div></div>
          <div><div class="field-label">Partita IVA</div><div class="field-value">${val(client.partita_iva)}</div></div>
          <div><div class="field-label">Regime fiscale</div><div class="field-value">${client.regime ? esc(REGIME_LABEL[client.regime] || client.regime) : '<span style="color:#ccc">—</span>'}</div></div>
          <div><div class="field-label">PEC</div><div class="field-value">${val(client.pec)}</div></div>
          <div><div class="field-label">Codice destinatario SDI</div><div class="field-value">${val(client.codice_sdi)}</div></div>
          <div><div class="field-label">Paese</div><div class="field-value">${val(client.paese || 'IT')}</div></div>
        </div>
      </div>`;
      })()}
      ${client.note_preliminari ? `<div style="margin-top:22px"><div class="zona-tit">Note CRM</div><div style="font-size:14px;color:#6B7280;line-height:1.55">${esc(client.note_preliminari)}</div></div>` : ''}
      ${recallHtml}
      </div>
      </div>

      ${azioniHtml}
    </div>

    ${appuntamentoHtml}
    ${percorsiHtml}
    ${paymentsHtml}
    ${seduteHtml}
    ${strumentiHtml}
  </div>

  <!-- MODAL MODIFICA CLIENTE -->
  <div id="modal-edit" class="modal-overlay">
    <div class="modal-box">
      <h2 style="margin-bottom:16px">Modifica dati cliente</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome</label><input id="e-nome" type="text" value="${attr(client.nome)}"></div>
        <div class="form-group"><label>Cognome *</label><input id="e-cognome" type="text" value="${attr(client.cognome)}"></div>
      </div>
      <div class="form-group"><label>Via e numero civico</label><input id="e-via" type="text" value="${attr(client.via)}" placeholder="es. Via Roma 12"></div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px">
        <div class="form-group"><label>CAP</label><input id="e-cap" type="text" value="${attr(client.cap)}"></div>
        <div class="form-group"><label>Città</label><input id="e-citta" type="text" value="${attr(client.citta)}"></div>
        <div class="form-group"><label>Provincia</label><input id="e-provincia" type="text" value="${attr(client.provincia)}" maxlength="4" placeholder="MI"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Telefono</label><input id="e-tel" type="tel" value="${attr(client.telefono)}"></div>
        <div class="form-group"><label>Email</label><input id="e-email" type="email" value="${attr(client.email)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Social</label><select id="e-social-tipo">${socialOptions(client.social_tipo)}</select></div>
        <div class="form-group"><label>Contatto social (username / link)</label><input id="e-altro" type="text" value="${attr(client.altro_recapito)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Professione / ruolo</label><input id="e-prof" type="text" value="${attr(client.professione)}"></div>
        <div class="form-group"><label>Data di nascita</label><input id="e-nascita" type="date" value="${client.data_nascita ? String(client.data_nascita).slice(0,10) : ''}"></div>
      </div>
      <div class="form-group"><label>Società / azienda</label><input id="e-societa" type="text" value="${attr(client.societa)}"></div>
      ${/* Li riempie da sé l'automazione leggendo il contratto firmato, ma restano
            correggibili a mano: se il cliente scrive male un codice, si sistema qui. */ ''}
      <div class="form-group"><label>Luogo di nascita</label><input id="e-luogo-nascita" type="text" value="${attr(client.luogo_nascita)}"></div>
      ${/* 11/08 — «Codice fiscale / P.IVA» era UN campo solo: così non si poteva
            sapere se il cliente è un privato o un professionista con partita IVA,
            ed è proprio quella differenza a decidere se in fattura ci va la
            ritenuta d'acconto. Da qui in poi sono due campi distinti. I codici già
            inseriti restano nel campo del codice fiscale: sono tutti codici
            fiscali veri, nessuno è stato spostato d'ufficio. */ ''}
      <h2 style="font-size:13px;margin:6px 0 12px;color:var(--muted)">Dati per la fatturazione</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Codice fiscale</label><input id="e-cf" type="text" value="${attr(client.codice_fiscale)}"></div>
        <div class="form-group"><label>Partita IVA</label><input id="e-piva" type="text" value="${attr(client.partita_iva)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Regime fiscale</label>
          <select id="e-regime">
            <option value=""${!client.regime ? ' selected' : ''}>— non indicato —</option>
            <option value="ordinario"${client.regime === 'ordinario' ? ' selected' : ''}>Ordinario</option>
            <option value="forfettario"${client.regime === 'forfettario' ? ' selected' : ''}>Forfettario</option>
          </select></div>
        <div class="form-group"><label>Natura giuridica</label>
          <select id="e-natura">
            <option value="persona_fisica"${client.natura_giuridica !== 'persona_giuridica' ? ' selected' : ''}>Persona fisica</option>
            <option value="persona_giuridica"${client.natura_giuridica === 'persona_giuridica' ? ' selected' : ''}>Persona giuridica</option>
          </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>PEC</label><input id="e-pec" type="email" value="${attr(client.pec)}"></div>
        <div class="form-group"><label>Codice destinatario SDI</label><input id="e-sdi" type="text" value="${attr(client.codice_sdi)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px">
        <div class="form-group"><label>Paese</label><input id="e-paese" type="text" value="${attr(client.paese || 'IT')}" maxlength="2" placeholder="IT" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Identificativo fiscale estero</label><input id="e-idestero" type="text" value="${attr(client.identificativo_estero)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label><select id="e-area">${areaOptions(area)}</select></div>
        <div class="form-group"><label>Come ci ha conosciuto</label><select id="e-fonte">${fonteOptions(client.fonte||'altro')}</select></div>
      </div>
      <div class="form-group"><label>Obiettivo / motivo del percorso</label><textarea id="e-obiettivo">${esc(client.obiettivo||'')}</textarea></div>
      <hr style="border:none;border-top:1px solid var(--line);margin:6px 0 14px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Stato relazione</label>
          <select id="e-stato">
            <option value="attivo"${client.stato_cliente==='attivo'?' selected':''}>Attivo</option>
            <option value="in pausa"${client.stato_cliente==='in pausa'?' selected':''}>In pausa</option>
            <option value="concluso"${client.stato_cliente==='concluso'?' selected':''}>Concluso</option>
          </select></div>
        <div class="form-group"><label>Data prossima azione</label><input id="e-azione-data" type="date" value="${client.prossima_azione_data ? String(client.prossima_azione_data).slice(0,10) : ''}"></div>
      </div>
      <div class="form-group"><label>Prossima azione (recall)</label><input id="e-azione" type="text" value="${attr(client.prossima_azione)}" placeholder="es. richiamare per proporre nuovo percorso"></div>
      <div class="form-group"><label>Note CRM</label><textarea id="e-note">${esc(client.note_preliminari||'')}</textarea></div>
      <div class="form-group"><label>Link cartella Google Drive</label><input id="e-drive" type="text" value="${attr(client.drive_url)}" placeholder="https://drive.google.com/…"></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input id="e-consenso" type="checkbox" style="width:auto;margin:0" ${client.consenso_privacy?'checked':''}>
        <label style="margin:0;text-transform:none;font-size:13px;letter-spacing:0">Consenso al trattamento dei dati personali${client.consenso_data ? ` (dato il ${String(client.consenso_data).slice(0,10)})` : ''}</label>
      </div>
      <div id="edit-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-edit').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveClient()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAIL 1 — RIVEDI E INVIA -->
  <!-- Manda uno strumento: una finestrella sola al posto delle due tendine e del
       pulsante che stavano nella riga (Germano 31/07: "non mi piace che ci siano
       tre pulsanti… si torna a creare la confusione che avevamo risolto"). Qui le
       scelte hanno lo spazio per essere scritte in chiaro. Struttura come le
       altre finestrelle: h2 primo figlio, riga dei pulsanti ultimo div — è quello
       che le tiene appesi in alto e in basso quando il contenuto non ci sta. -->
  <div id="modal-strumento" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:4px">Manda uno strumento a ${esc(mailNome || client.name)}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#8a94a6">Il link è sempre lo stesso indirizzo: a decidere se si apre è il permesso che gli dài qui.</p>

      <div class="form-group">
        <label>Cosa gli apri</label>
        <select id="perm-tool" onchange="aggiornaDurate()">
          <option value="">Il portale — tutti gli strumenti</option>
          ${opzioniStrumenti}
        </select>
      </div>

      <div class="form-group">
        <label>Per quanto</label>
        <label style="display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="radio" name="perm-durata" value="ore" checked style="width:auto;margin:3px 0 0">
          <span>Per la sessione di oggi<br><span style="color:#8a94a6;font-size:12px">Vale ${PERMESSO_ORE_SESSIONE} ore, contate da quando il cliente apre il link — così puoi mandarglielo anche la sera prima.</span></span>
        </label>
        <label id="perm-lbl-sessione" style="display:flex;align-items:flex-start;gap:8px;margin:0;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="radio" name="perm-durata" value="sessione" id="perm-r-sessione" style="width:auto;margin:3px 0 0">
          <span>${prossimaSess ? `Fino alla prossima sessione — <strong>${itDate(prossimaSess)}</strong>` : 'Fino alla prossima sessione'}<br><span style="color:#8a94a6;font-size:12px">${prossimaSess
            ? 'Arriva a fine giornata di quel giorno, così il lavoro lo aprite insieme in sessione. Vale per un solo strumento, non per tutto il portale.'
            : 'La data non è ancora nei report: il collegamento resta aperto finché non la fissate, e allora si aggancia da sé a quel giorno.'}</span></span>
        </label>
      </div>

      <!-- La mail vale SOLO per uno strumento singolo: per il portale sparisce. -->
      <div id="perm-mail" style="border-top:1px solid var(--line);padding-top:14px;margin-top:4px;display:none">
        <div class="form-group"><label>Manda per email a</label>
          <input id="perm-to" type="email" value="${attr(client.email)}" placeholder="email del cliente">
          ${client.email ? '' : '<div style="font-size:12px;color:#B45309;margin-top:4px">In anagrafica non c&rsquo;è l&rsquo;email: scrivila qui, oppure copia il link e mandaglielo come preferisci.</div>'}
        </div>
        <div class="form-group"><label>Oggetto</label><input id="perm-subject" type="text"></div>
        <div class="form-group"><label>Testo</label><textarea id="perm-body" style="min-height:150px;font-family:inherit"></textarea></div>
      </div>

      <div class="form-group" style="margin-bottom:14px">
        <label>Permessi aperti adesso</label>
        <div id="perm-elenco">${permessiElenco}</div>
      </div>

      <div id="perm-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-strumento').style.display='none'" class="btn btn-neutral" style="flex:1">Chiudi</button>
        <button onclick="creaPermesso(false)" class="btn btn-neutral" style="flex:1">📋 Copia il link</button>
        <button id="perm-btn-invia" onclick="creaPermesso(true)" class="btn btn-primary" style="flex:1;display:none">✉️ Invia la mail</button>
      </div>
    </div>
  </div>

  <div id="modal-mail1" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <h2 style="margin-bottom:4px">Rivedi e invia — Mail 1 di benvenuto</h2>
      <p style="margin:0 0 14px;font-size:12px;color:#8a94a6">L'invio è reale: la mail parte davvero al destinatario qui sotto.</p>
      <div class="form-group"><label>A (destinatario)</label><input id="m1-to" type="email" value="${attr(client.email)}" placeholder="email del cliente"></div>
      <div class="form-group"><label>Oggetto</label><input id="m1-subject" type="text" value="${attr(mail1Subject)}"></div>
      <div class="form-group">
        <label>Lettera allegata</label>
        <div style="display:flex;gap:18px;align-items:center;font-size:13px">
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;letter-spacing:0;font-weight:400">
            <input type="radio" name="m1-genere" value="maschile" style="width:auto;margin:0" ${mail1Genere==='maschile'?'checked':''}> Maschile (Caro… benvenuto)</label>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;letter-spacing:0;font-weight:400">
            <input type="radio" name="m1-genere" value="femminile" style="width:auto;margin:0" ${mail1Genere==='femminile'?'checked':''}> Femminile (Cara… benvenuta)</label>
        </div>
      </div>
      <div class="form-group"><label>Testo della mail</label><textarea id="m1-body" style="min-height:230px;font-family:inherit">${esc(mail1Body)}</textarea></div>
      <div style="font-size:12px;color:#6B7280;background:#f7f9fc;border-radius:8px;padding:9px 12px;margin-bottom:12px">
        📎 Allegati (3): <strong>Lettera di Benvenuto</strong> · <strong>Scheda Anagrafica</strong> · <strong>Codice Etico ICF 2025</strong>
      </div>
      <div id="mail1-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-mail1').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="m1-send" onclick="sendMail1()" class="btn btn-primary" style="flex:1">✉️ Invia adesso</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAIL 2 — RIVEDI E INVIA -->
  <div id="modal-mail2" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <h2 style="margin-bottom:4px">Rivedi e invia — Mail 2 (contratto + agenda)</h2>
      <p style="margin:0 0 14px;font-size:12px;color:#8a94a6">L'invio è reale: la mail parte davvero al destinatario qui sotto.</p>
      <div class="form-group"><label>A (destinatario)</label><input id="m2-to" type="email" value="${attr(client.email)}" placeholder="email del cliente"></div>
      <div class="form-group"><label>Oggetto</label><input id="m2-subject" type="text" value="${attr(mail2Subject)}"></div>
      <div class="form-group"><label>Testo della mail</label><textarea id="m2-body" style="min-height:230px;font-family:inherit">${esc(mail2Body)}</textarea></div>
      <div style="font-size:12px;color:#6B7280;background:#f7f9fc;border-radius:8px;padding:9px 12px;margin-bottom:12px">
        📎 Allegati (2): <strong>Contratto per Servizi di Coaching</strong> · <strong>Agenda di sessione</strong> <span style="color:#aaa">(l'agenda riporta il nome del cliente)</span>
      </div>
      <div id="mail2-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-mail2').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="m2-send" onclick="sendMail2()" class="btn btn-primary" style="flex:1">✉️ Invia adesso</button>
      </div>
    </div>
  </div>

  <!-- MODAL PERCORSO (serve sia a crearne uno nuovo sia a correggerne uno esistente) -->
  <div id="modal-percorso" class="modal-overlay">
    <div class="modal-box" style="width:420px">
      <h2 id="p-titolo" style="margin-bottom:16px">Nuovo percorso</h2>
      <input id="p-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="p-tipo"><option>Individuale</option><option>Business</option><option>Young</option><option>Team</option><option>Group</option></select></div>
        <div class="form-group"><label>Modalità</label>
          <select id="p-modalita" onchange="modalitaCambiata()"><option value="Standard" selected>Standard (si paga ogni sessione)</option><option value="Pacchetto">Pacchetto (cifra unica per N sessioni)</option><option value="Scambio servizi">Scambio servizi</option><option value="Pro bono">Pro bono</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Sessioni previste</label><input id="p-sessioni" type="number" step="1" min="1" value="8"></div>
        <div class="form-group" id="p-prezzo-box"><label id="p-prezzo-label">Prezzo a sessione (€)</label><input id="p-prezzo" type="number" step="0.01" placeholder="es. 150"></div>
      </div>
      <div class="form-group" id="p-ore-box"><label>Ore già svolte (percorsi iniziati prima dell'Hub)</label><input id="p-ore" type="number" step="0.5" min="0" value="0"></div>
      ${progetti.length ? `<div class="form-group"><label>Progetto (facoltativo)</label>
        <select id="p-progetto"><option value="">— nessuno (percorso individuale) —</option>${progetti.map(pr => `<option value="${pr.progetto_id}">${esc(pr.titolo)} · ${esc(pr.committente_nome)}</option>`).join('')}</select></div>` : ''}
      <div class="form-group"><label>Data inizio</label><input id="p-data" type="date"></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input id="p-promo" type="checkbox" style="width:auto;margin:0">
        <label style="margin:0;text-transform:none;font-size:13px;letter-spacing:0">Promo / sconto applicato</label>
      </div>
      <div class="form-group"><label>Note sconto</label><input id="p-sconto" type="text" placeholder="es. 20% lancio…"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-percorso').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="savePercorso()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <!-- MODAL APPUNTAMENTO (12/08) — la data del prossimo incontro, a mano.
       Non tocca nessun report: quello che si scrive qui vive per conto suo. -->
  <div id="modal-app" class="modal-overlay">
    <div class="modal-box" style="width:420px;max-width:94vw">
      <h2 style="margin-bottom:4px">Prossimo appuntamento</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">${esc(client.name)}</p>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="ap-data" type="date"></div>
        <div class="form-group"><label>Ora</label><input id="ap-ora" type="time"></div>
      </div>
      <p style="color:var(--hint);font-size:12px;margin-bottom:14px">
        Non modifica nessun report. Resta scritto finché non arriva il report di
        una sessione più recente.
      </p>
      <div id="ap-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="document.getElementById('modal-app').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="ap-salva" onclick="salvaApp()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
      <button onclick="togliApp()" class="btn btn-danger btn-sm" style="width:100%;margin-top:10px">Togli l'appuntamento</button>
    </div>
  </div>

  <!-- MODAL SEDUTA (diario sessioni) -->
  <div id="modal-seduta" class="modal-overlay">
    <div class="modal-box" style="width:600px;max-width:94vw">
      <h2 id="seduta-title" style="margin-bottom:16px">Aggiungi sessione</h2>
      <input id="s-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Percorso</label>
          <select id="s-percorso">${percorsi.map(p => `<option value="${p.id}">${esc(p.tipo)}${p.data_inizio ? ` · dal ${itDate(p.data_inizio)}` : ''}${p.stato !== 'attivo' ? ' (concluso)' : ''}</option>`).join('')}</select></div>
        <div class="form-group"><label>Tipo</label>
          <select id="s-tipo" onchange="oreAuto()"><option value="Intake">Intake</option><option value="Ongoing" selected>Ongoing</option><option value="Final">Final</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="s-data" type="date"></div>
        <div class="form-group"><label>Ore <span id="s-ore-hint" style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0"></span></label><input id="s-ore" type="number" step="0.5" min="0"></div>
      </div>
      <div class="form-group"><label>Obiettivo <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(una frase)</span></label><textarea id="s-obiettivo" style="min-height:54px"></textarea></div>
      <div class="form-group"><label>Argomenti trattati <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga, inizia con -)</span></label><textarea id="s-argomenti" style="min-height:72px" placeholder="- primo argomento&#10;- secondo argomento"></textarea></div>
      <div class="form-group"><label>Attività concordate <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga, inizia con -)</span></label><textarea id="s-attivita" style="min-height:60px" placeholder="- prima attività&#10;- **Cliente:** seconda attività"></textarea></div>
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr 1fr;gap:12px">
        <div class="form-group"><label>Scadenza <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(data)</span></label><input id="s-scadenza" type="date"></div>
        <div class="form-group"><label>Ora <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(prossimo)</span></label><input id="s-ora" type="time"></div>
        <div class="form-group"><label>Eseguita</label><select id="s-eseguita"><option value="">—</option><option value="✓">✓ fatta</option><option value="✗">✗ non fatta</option></select></div>
      </div>
      <div class="form-group"><label>Note</label><textarea id="s-note" style="min-height:60px"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-seduta').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveSeduta()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  ${/* ⛔ TOLTA 15/08 con il pulsante «+ Pagamento»: una finestrella che nessuno
        può più aprire non è innocua, è la trappola in cui sono già cascato una
        volta (il finto pulsante «Aggiungi sessione» del 10/08 — codice che
        esiste non vuol dire funzione che esiste). Le rotte del server restano,
        e vanno tolte con la pulizia del codice morto, con la prova che nessuno
        le chiama. */ ''}
  ${/* Fetta C — la finestrella del piano di un pacchetto. È LA STESSA della
        scheda del progetto (piano-ui.js): qui cambia solo come si chiama la
        cifra e dove si salva. Compare solo se questo cliente ha un pacchetto,
        così le altre schede non si portano dietro markup che non usano. */ ''}
  ${pianoAttivo ? pianoUi.modale({
    labelValore: 'Cifra concordata',
    valore: null,
    dataMeta: '', dataFine: '',
    sottotitolo: 'In quante volte si paga. Si scrivono gli euro: la percentuale la calcola l\'Hub.',
    mostraDividi: false,
  }) + pianoUi.modaleIncasso() : ''}
  ${/* ⚠️ Questa NON sta dentro `pianoAttivo`: il link all'ultima proforma c'è
        su qualunque scheda, anche senza pacchetto. Metterla nel ramo
        condizionale vorrebbe dire un link che non apre niente — il guasto che
        si vede solo in un browser vero. */ ''}
  ${modalePdf()}

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:200">Fatto!</div>
  <script>
    ${jsModalePdf()}
    const CID = '${client.id}';
    // Per comporre link e testo della mail dello strumento, senza chiedere al server.
    const PERM_BASE = '${PLATFORM_URL}/c/${client.token}';
    const PERM_NOMI = ${JSON.stringify(Object.fromEntries(STRUMENTI.map(t => [t.key, t.nome]))).replace(/</g, '\\u003c')};
    const PERM_SCAD = ${prossimaSess ? `'${prossimaSess}'` : 'null'};

    ${pianoAttivo ? `
    ${/* ── FETTA C — il piano di un pacchetto ─────────────────────────────
          La finestrella arriva tutta da piano-ui.js: qui non si riscrive
          niente, si dice solo QUALE pacchetto si sta impostando e DOVE si
          salva. Parte con PIANI vuoto e si riempie al clic su «Modifica il
          piano»: un cliente può avere più di un pacchetto, e ognuno ha le sue
          date e il suo prezzo. Riempire il DOM su un CLIC è ammesso — la
          regola vieta di rifarlo mentre qualcuno sta scrivendo. */ ''}
    ${pianoUi.js({ piani: [], dataFirma: '', quotaPerPagatore: false })}

    var PACCHETTI = ${JSON.stringify(pacchetti.map(pc => ({
      id: pc.id, titolo: pc.titolo, quota: pc.quota, righe: pc.righe,
      data_inizio: pc.data_inizio, data_meta: pc.data_meta, data_fine: pc.data_fine,
    }))).replace(/</g, '\\u003c')};
    var QUOTE_PROGETTO = ${JSON.stringify(progettiConto.filter(g => g.q > 0).map(g => ({
      part_id: g.pr.part_id, titolo: g.pr.titolo, quota: g.q,
      righe: pianoUi.righeDi(g.salvate, g.q, 'partecipante', rateChieste),
      data_inizio: g.pr.data_inizio ? String(g.pr.data_inizio).slice(0, 10) : '',
      data_meta:   g.pr.data_meta   ? String(g.pr.data_meta).slice(0, 10)   : '',
      data_fine:   g.pr.data_fine   ? String(g.pr.data_fine).slice(0, 10)   : '',
    }))).replace(/</g, '\\u003c')};
    ${/* Che cosa si sta impostando: un pacchetto o una quota dentro un progetto.
          Il resto della finestrella non cambia di una riga — e non deve. */ ''}
    var PIANO_TIPO = null;   // 'pacchetto' | 'partecipazione'
    var PACC_ID = null;

    // Sulla scheda del cliente il pagatore è la persona di cui stai già
    // guardando la scheda: non c'è niente da aprire né da togliere.
    function azioniPagatore(pg) { return ''; }

    function apriPianoPacchetto(id) {
      var pc = null;
      for (var i = 0; i < PACCHETTI.length; i++) if (PACCHETTI[i].id === id) pc = PACCHETTI[i];
      if (!pc) return;
      PIANO_TIPO = 'pacchetto'; PACC_ID = id;
      DATA_FIRMA = pc.data_inizio || '';
      PIANI = [{ key: 'pacchetto', pid: null, nome: pc.titolo, ruolo: 'pacchetto',
                 quota: pc.quota, tipo: 'committente', righe: pc.righe }];
      preparaPiano('Prezzo del pacchetto', false, '');
      document.getElementById('q-totale').value = pc.quota || '';
      document.getElementById('pi-meta').value  = pc.data_meta || '';
      document.getElementById('pi-fine').value  = pc.data_fine || '';
      costruisciFinestrella();
      apriPiano();
    }

    ${/* 15/08 — la quota dentro un progetto si imposta come un pacchetto, con la
          STESSA finestrella. Cambiano solo tre cose: l'etichetta della cifra, il
          fatto che cifra e date sono spente (sono del progetto), e dove si
          salva. */ ''}
    function apriPianoPartecipazione(partId) {
      var g = null;
      for (var i = 0; i < QUOTE_PROGETTO.length; i++) if (QUOTE_PROGETTO[i].part_id === partId) g = QUOTE_PROGETTO[i];
      if (!g) return;
      PIANO_TIPO = 'partecipazione'; PACC_ID = partId;
      DATA_FIRMA = g.data_inizio || '';
      PIANI = [{ key: 'pacchetto', pid: null, nome: g.titolo, ruolo: 'quota nel progetto',
                 quota: g.quota, tipo: 'partecipante', righe: g.righe }];
      preparaPiano('Quota nel progetto', true,
        'La cifra concordata e le date sono del progetto: si cambiano lì. Qui si decide in quante volte si paga.');
      document.getElementById('q-totale').value = g.quota || '';
      document.getElementById('pi-meta').value  = g.data_meta || '';
      document.getElementById('pi-fine').value  = g.data_fine || '';
      costruisciFinestrella();
      apriPiano();
    }

    async function salvaTutto() {
      var err = document.getElementById('piano-error');
      err.style.display = 'none';
      try {
        // Si legge dai CAMPI, non da PIANI: dentro la finestrella il DOM è la
        // verità mentre si scrive (la lezione del 15/08).
        var perKey = leggiFinestrella();
        var k = Object.keys(perKey)[0];
        if (!k) { err.textContent = 'Non ci sono rate da salvare.'; err.style.display = 'block'; return; }
        var dove, corpo;
        if (PIANO_TIPO === 'partecipazione') {
          // Qui NON si mandano né la quota né le date: sono del progetto, e
          // mandarle da qui vorrebbe dire poterlo scombinare da un'altra pagina.
          dove  = '/dashboard/partecipazioni/' + PACC_ID + '/piano';
          corpo = { righe: perKey[k].righe };
        } else {
          dove  = '/dashboard/percorsi/' + PACC_ID + '/piano';
          corpo = {
            prezzo: document.getElementById('q-totale').value,
            data_meta: document.getElementById('pi-meta').value,
            data_fine: document.getElementById('pi-fine').value,
            righe: perKey[k].righe };
        }
        var r = await fetch(dove, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block'; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; }
    }
    ` : ''}
    const PERM_NOME_CLIENTE = ${JSON.stringify(mailNome || client.name).replace(/</g, '\\u003c')};
    const PERM_ORE = ${PERMESSO_ORE_SESSIONE};
    const SEDUTE = ${JSON.stringify(Object.fromEntries(sedute.map(s => [s.id, { id: s.id, percorso_id: s.percorso_id, tipo: s.tipo, data: s.data, ore: Number(s.ore), obiettivo: s.obiettivo || '', argomenti: s.argomenti || '', attivita: s.attivita || '', scadenza: s.scadenza || '', prossima_ora: s.prossima_ora || '', eseguita: s.eseguita || '', note: s.note || '' }]))).replace(/</g, '\\u003c')};
    // Dati dei percorsi per riempire la finestra quando si preme "Modifica".
    const PERCORSI_DATI = ${JSON.stringify(Object.fromEntries(percorsi.map(p => [p.id, { id: p.id, tipo: p.tipo || 'Individuale', modalita: p.modalita || 'Standard', prezzo: p.prezzo === null || p.prezzo === undefined ? '' : String(p.prezzo), n_sessioni_previste: Number(p.n_sessioni_previste) || 8, promo: !!p.promo, sconto_note: p.sconto_note || '', data_inizio: p.data_inizio ? String(p.data_inizio).slice(0, 10) : '' }]))).replace(/</g, '\\u003c')};
    const ORE_TIPO = { Intake: 2, Ongoing: 1, Final: null };
    function oreAuto() {
      const t = document.getElementById('s-tipo').value;
      const auto = ORE_TIPO[t];
      const ore = document.getElementById('s-ore'), hint = document.getElementById('s-ore-hint');
      ore.readOnly = false;
      if (auto != null) { ore.value = auto; hint.textContent = '(preimpostate per ' + t + ', modificabili)'; }
      else { hint.textContent = '(Final: a mano)'; }
    }
    function openSeduta() {
      document.getElementById('seduta-title').textContent = 'Aggiungi sessione';
      document.getElementById('s-id').value = '';
      const ps = document.getElementById('s-percorso'); if (ps.options.length) ps.selectedIndex = 0;
      document.getElementById('s-tipo').value = 'Ongoing';
      document.getElementById('s-data').value = new Date().toISOString().slice(0, 10);
      ['s-obiettivo','s-argomenti','s-attivita','s-scadenza','s-ora','s-eseguita','s-note'].forEach(id => document.getElementById(id).value = '');
      oreAuto();
      document.getElementById('modal-seduta').style.display = 'flex';
    }
    function editSeduta(sid) {
      const s = SEDUTE[sid]; if (!s) return;
      document.getElementById('seduta-title').textContent = 'Modifica sessione';
      document.getElementById('s-id').value = s.id;
      document.getElementById('s-percorso').value = s.percorso_id;
      document.getElementById('s-tipo').value = s.tipo;
      document.getElementById('s-data').value = s.data ? String(s.data).slice(0, 10) : '';
      document.getElementById('s-obiettivo').value = s.obiettivo || '';
      document.getElementById('s-argomenti').value = s.argomenti || '';
      document.getElementById('s-attivita').value = s.attivita || '';
      document.getElementById('s-scadenza').value = s.scadenza || '';
      // \\d e non \d: siamo dentro una template literal, dove \d diventerebbe una
      // semplice "d" e la regola non riconoscerebbe piu' un orario (campo vuoto).
      document.getElementById('s-ora').value = /^\\d{1,2}:\\d{2}$/.test(s.prossima_ora || '') ? s.prossima_ora : '';
      document.getElementById('s-eseguita').value = s.eseguita || '';
      document.getElementById('s-note').value = s.note || '';
      oreAuto();
      document.getElementById('s-ore').value = s.ore;
      document.getElementById('modal-seduta').style.display = 'flex';
    }
    async function saveSeduta() {
      const pid = document.getElementById('s-percorso').value;
      if (!pid) { alert('Serve un percorso'); return; }
      const sid = document.getElementById('s-id').value;
      const g = id => document.getElementById(id).value;
      const body = { tipo: g('s-tipo'), data: g('s-data') || null, ore: g('s-ore') || 0, obiettivo: g('s-obiettivo'), argomenti: g('s-argomenti'), attivita: g('s-attivita'), scadenza: g('s-scadenza'), prossima_ora: g('s-ora'), eseguita: g('s-eseguita'), note: g('s-note') };
      const url = '/dashboard/clients/' + CID + '/percorsi/' + pid + '/sedute' + (sid ? ('/' + sid) : '');
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      location.reload();
    }
    async function delSeduta(sid, pid) {
      if (!confirm('Eliminare questa sessione dal diario? Le ore si ricalcolano.')) return;
      await fetch('/dashboard/clients/' + CID + '/percorsi/' + pid + '/sedute/' + sid, { method: 'DELETE' }); location.reload();
    }
    async function approvaSeduta(sid, pid) {
      if (!confirm('Approvare questa scheda? Da bozza diventa una sessione confermata e le ore entrano nel conteggio ICF.')) return;
      const r = await fetch('/dashboard/clients/' + CID + '/percorsi/' + pid + '/sedute/' + sid + '/approva', { method: 'POST' });
      let d = {}; try { d = await r.json(); } catch (e) {}
      // Era la Final e il percorso risulta ancora aperto: lo faccio notare qui,
      // che è il momento in cui te ne accorgi. Se dici di no non succede nulla.
      if (d.proponiChiusura && confirm('Questa era la sessione Final. Chiudo anche il percorso, con data ' + d.dataFineIt + '?')) {
        await fetch('/dashboard/clients/' + CID + '/percorsi/' + pid + '/chiudi',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_fine: d.dataFine }) });
      }
      location.reload();
    }
    async function scanDrive() {
      const btn = document.getElementById('scan-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (può volerci qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/scan-drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CID }) });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : ' (già lavorati, o cartella Ongoing/Intake/Final vuota).'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto, evidenziata, da approvare.');
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }
    // ── Appuntamento (12/08) ──
    var appPercorso = null;
    function apriApp(pid, data, ora) {
      appPercorso = pid;
      document.getElementById('ap-data').value = data || '';
      document.getElementById('ap-ora').value = /^\\d{1,2}:\\d{2}$/.test(ora || '') ? ora : '';
      document.getElementById('ap-error').style.display = 'none';
      document.getElementById('modal-app').style.display = 'flex';
    }
    async function scriviApp(data, ora) {
      var err = document.getElementById('ap-error');
      var btn = document.getElementById('ap-salva');
      btn.disabled = true; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/percorsi/' + appPercorso + '/appuntamento', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data, ora: ora }) });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block'; btn.disabled = false; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; btn.disabled = false; }
    }
    function salvaApp() {
      scriviApp(document.getElementById('ap-data').value, document.getElementById('ap-ora').value);
    }
    function togliApp() {
      if (!confirm('Tolgo l\\'appuntamento?')) return;
      scriviApp('', '');
    }
    function copyLink(url) { navigator.clipboard.writeText(url).then(() => { const t=document.getElementById('toast'); t.textContent='Link copiato!'; t.style.display='block'; setTimeout(()=>t.style.display='none',2000); }); }
    function openEdit() { document.getElementById('modal-edit').style.display='flex'; }
    function openMail1() {
      document.getElementById('mail1-error').style.display='none';
      document.getElementById('modal-mail1').style.display='flex';
    }
    async function sendMail1() {
      const err = document.getElementById('mail1-error');
      const to = document.getElementById('m1-to').value.trim();
      if (!to) { err.textContent='Serve un indirizzo destinatario.'; err.style.display='block'; return; }
      const gEl = document.querySelector('input[name="m1-genere"]:checked');
      const payload = {
        to,
        subject: document.getElementById('m1-subject').value,
        body: document.getElementById('m1-body').value,
        genere: gEl ? gEl.value : null,
      };
      if (!confirm('Invio la Mail 1 a ' + to + ' con i 3 allegati?')) return;
      const btn = document.getElementById('m1-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display='none';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/mail1/invia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || d.error) { err.textContent = d.error || ('Errore ' + r.status); err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; return; }
        alert('Mail inviata a ' + d.to + '.\\nAllegati: ' + (d.allegati||[]).join(', '));
        location.reload();
      } catch(e) { err.textContent='Errore di rete: ' + e.message; err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; }
    }
    async function createDriveFolders() {
      const btn = document.getElementById('drive-folders-btn');
      const msg = document.getElementById('drive-folders-msg');
      btn.disabled = true; msg.style.color='#6B7280'; msg.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (d.error) { msg.style.color='#b45309'; msg.textContent = d.error; btn.disabled = false; return; }
        location.reload();
      } catch(e) { msg.style.color='#b45309'; msg.textContent = 'Errore di rete, riprova'; btn.disabled = false; }
    }
    function openMail2() {
      document.getElementById('mail2-error').style.display='none';
      document.getElementById('modal-mail2').style.display='flex';
    }
    async function sendMail2() {
      const err = document.getElementById('mail2-error');
      const to = document.getElementById('m2-to').value.trim();
      if (!to) { err.textContent='Serve un indirizzo destinatario.'; err.style.display='block'; return; }
      const payload = {
        to,
        subject: document.getElementById('m2-subject').value,
        body: document.getElementById('m2-body').value,
      };
      if (!confirm('Invio la Mail 2 (contratto + agenda) a ' + to + '?')) return;
      const btn = document.getElementById('m2-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display='none';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/mail2/invia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || d.error) { err.textContent = d.error || ('Errore ' + r.status); err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; return; }
        alert('Mail inviata a ' + d.to + '.\\nAllegati: ' + (d.allegati||[]).join(', '));
        location.reload();
      } catch(e) { err.textContent='Errore di rete: ' + e.message; err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; }
    }
    async function saveClient() {
      const nome    = document.getElementById('e-nome').value.trim();
      const cognome = document.getElementById('e-cognome').value.trim();
      const err = document.getElementById('edit-error');
      if (!cognome) { err.textContent='Il cognome è obbligatorio'; err.style.display='block'; return; }
      const payload = {
        nome, cognome, email:document.getElementById('e-email').value, telefono:document.getElementById('e-tel').value,
        altro_recapito:document.getElementById('e-altro').value, social_tipo:document.getElementById('e-social-tipo').value,
        via:document.getElementById('e-via').value, cap:document.getElementById('e-cap').value,
        citta:document.getElementById('e-citta').value, provincia:document.getElementById('e-provincia').value,
        professione:document.getElementById('e-prof').value, societa:document.getElementById('e-societa').value, data_nascita:document.getElementById('e-nascita').value||null,
        luogo_nascita:document.getElementById('e-luogo-nascita').value, codice_fiscale:document.getElementById('e-cf').value,
        pec:document.getElementById('e-pec').value, codice_sdi:document.getElementById('e-sdi').value,
        partita_iva:document.getElementById('e-piva').value, regime:document.getElementById('e-regime').value,
        natura_giuridica:document.getElementById('e-natura').value, paese:document.getElementById('e-paese').value,
        identificativo_estero:document.getElementById('e-idestero').value,
        area:document.getElementById('e-area').value, fonte:document.getElementById('e-fonte').value,
        obiettivo:document.getElementById('e-obiettivo').value, stato_cliente:document.getElementById('e-stato').value,
        prossima_azione:document.getElementById('e-azione').value, prossima_azione_data:document.getElementById('e-azione-data').value||null,
        note_preliminari:document.getElementById('e-note').value, drive_url:document.getElementById('e-drive').value,
        consenso_privacy:document.getElementById('e-consenso').checked,
      };
      const r = await fetch('/dashboard/clients/'+CID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const d = await r.json();
      if (d.error) { err.textContent=d.error; err.style.display='block'; return; }
      location.reload();
    }

    // ── Permessi a termine sugli strumenti ────
    // ── Proposta letta dai documenti ────────────────────────────────
    async function approvaBozza() {
      // si mandano i campi spuntati CON il valore che si legge nella casella:
      // se il coach l'ha corretto, vale la sua correzione
      const campi = [...document.querySelectorAll('.bz-campo:checked')].map(c => {
        const cassetta = document.querySelector('.bz-valore[data-campo="' + c.value + '"]');
        return { campo: c.value, valore: cassetta ? cassetta.value : null };
      });
      const cons = document.getElementById('bz-consenso');
      const err = document.getElementById('bz-error');
      err.style.display = 'none';
      const r = await fetch('/dashboard/clients/'+CID+'/bozza-anagrafica/approva', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ campi: campi, consenso: cons ? cons.checked : false })
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { err.textContent = d.error || 'Non sono riuscito ad approvare.'; err.style.display='block'; return; }
      if (d.avvisi && d.avvisi.length) { alert('Fatto, ma: ' + d.avvisi.join(' · ')); }
      location.reload();
    }
    async function scartaBozza() {
      ${/* ⚠️ apostrofo: qui siamo dentro una template literal, quindi va scritto
            \\' — con una barra sola sparisce e rompe TUTTO il JavaScript della
            pagina (è successo l'08/08: scheda cliente inerte, nessun pulsante
            rispondeva). Vedi la prova che ora controlla il JS renderizzato. */ ''}
      if (!confirm('Scarto quello che i documenti dicono? La scheda resta com\\'è.')) return;
      await fetch('/dashboard/clients/'+CID+'/bozza-anagrafica/scarta', { method:'POST' });
      location.reload();
    }

    function openStrumento() {
      document.getElementById('perm-error').style.display = 'none';
      document.getElementById('modal-strumento').style.display = 'flex';
      aggiornaDurate();
    }
    // Cambiando la durata cambia la riga della scadenza nel testo della mail:
    // dire "fino alla prossima sessione" per un permesso di poche ore sarebbe
    // scrivere al cliente una cosa non vera.
    document.querySelectorAll('input[name="perm-durata"]').forEach(
      r => r.addEventListener('change', componiMail));
    // Il portale intero vale solo per la sessione di oggi: "fino alla prossima
    // sessione" ha senso per il compito su UN solo strumento, non per aprire tutto.
    // La scelta NON si nasconde quando non è disponibile — si spegne e resta
    // leggibile: nascosta sembrava che il programma fosse rotto.
    function aggiornaDurate() {
      const tool = document.getElementById('perm-tool').value;
      const r    = document.getElementById('perm-r-sessione');
      const lbl  = document.getElementById('perm-lbl-sessione');
      if (!r) return;
      // «Fino alla prossima sessione» vale per un solo strumento. La data può
      // mancare: in quel caso il permesso resta libero finché non la fissate,
      // quindi la scelta è comunque disponibile.
      const disponibile = !!tool;
      r.disabled = !disponibile;
      lbl.style.opacity = disponibile ? '1' : '0.45';
      if (!disponibile) document.querySelector('input[name="perm-durata"][value="ore"]').checked = true;
      // La mail si manda solo per uno strumento singolo, mai per il portale.
      document.getElementById('perm-mail').style.display = tool ? 'block' : 'none';
      document.getElementById('perm-btn-invia').style.display = tool ? 'block' : 'none';
      componiMail();
    }

    const PERM_MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio',
                       'agosto','settembre','ottobre','novembre','dicembre'];
    // "il 7 agosto" ma "l'8 agosto" e "l'11 agosto": davanti a otto e undici
    // l'articolo si apostrofa. Scritto male si nota, ed è una mail che legge un cliente.
    function permDataInLettere(iso) {
      const p = String(iso).split('-');
      const g = parseInt(p[2], 10);
      const art = (g === 8 || g === 11) ? "l'" : 'il ';
      return art + g + ' ' + PERM_MESI[parseInt(p[1], 10) - 1];
    }
    function componiMail() {
      const tool = document.getElementById('perm-tool').value;
      if (!tool) return;
      const durata = document.querySelector('input[name="perm-durata"]:checked').value;
      const nome = PERM_NOMI[tool] || tool;
      const link = PERM_BASE + '/tool/' + tool;
      let scadenza;
      if (durata !== 'sessione') {
        scadenza = 'Resta attivo per ' + PERM_ORE + ' ore da quando lo apri.';
      } else if (PERM_SCAD) {
        scadenza = 'Resta attivo fino alla nostra prossima sessione, ' + permDataInLettere(PERM_SCAD) + ', così lo guardiamo insieme.';
      } else {
        scadenza = 'Resta attivo fino alla nostra prossima sessione: appena fissiamo la data lo guardiamo insieme.';
      }
      document.getElementById('perm-subject').value = nome;
      document.getElementById('perm-body').value =
        'Ciao ' + PERM_NOME_CLIENTE + ',\\n\\n' +
        'qui sotto trovi il collegamento per lavorare sulla ' + nome +
        ': puoi aprirlo quando vuoi e riprenderlo più volte, quello che scrivi resta salvato.\\n' +
        scadenza + '\\n\\n' + link + '\\n\\nA presto,\\nGermano';
    }
    async function creaPermesso(conMail) {
      const tool   = document.getElementById('perm-tool').value;
      const durata = document.querySelector('input[name="perm-durata"]:checked').value;
      const err    = document.getElementById('perm-error');
      err.style.display = 'none';
      let email = null;
      if (conMail) {
        const to = document.getElementById('perm-to').value.trim();
        if (!to) { err.textContent = 'Manca l\\'indirizzo a cui mandare la mail.'; err.style.display = 'block'; return; }
        email = { to: to,
                  subject: document.getElementById('perm-subject').value,
                  body: document.getElementById('perm-body').value };
      }
      const r = await fetch('/dashboard/clients/'+CID+'/permessi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: tool || null, durata: durata, email: email })
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { err.textContent = d.error || 'Non sono riuscito a creare il permesso.'; err.style.display = 'block'; return; }
      if (d.avviso) { err.textContent = d.avviso; err.style.display = 'block'; }
      if (d.inviata) {
        const t = document.getElementById('toast');
        t.textContent = 'Mail inviata! Il permesso è aperto.';
        t.style.display = 'block';
        setTimeout(() => location.reload(), 1500);
        return;
      }
      if (d.avviso) return;
      // La copia automatica può essere bloccata dal browser (succede su Safari
      // quando fra il clic e la copia c\'è una chiamata al server): in quel caso
      // il link non si perde, si mostra e lo si copia a mano.
      try {
        await navigator.clipboard.writeText(d.link);
        const t = document.getElementById('toast');
        t.textContent = 'Link copiato! Il permesso è aperto.';
        t.style.display = 'block';
      } catch (e) {
        window.prompt('Ecco il link da mandare al cliente (copialo):', d.link);
      }
      setTimeout(() => location.reload(), 1200);
    }
    async function chiudiPermesso(id) {
      if (!confirm('Chiudo questo permesso? Da subito il cliente non potrà più aprirlo.')) return;
      await fetch('/dashboard/clients/'+CID+'/permessi/'+id+'/chiudi', { method: 'POST' });
      location.reload();
    }
    async function deleteClient() {
      if (!confirm('Eliminare ${attr(client.name)} e tutti i suoi dati? Operazione irreversibile.')) return;
      await fetch('/dashboard/clients/'+CID,{method:'DELETE'}); location.href='/dashboard/individuali';
    }
    // Il prezzo è un campo solo che cambia significato con la modalità: qui si limita
    // a cambiare etichetta, e sparisce del tutto quando non c'è nessuna cifra da dire.
    function modalitaCambiata() {
      const m = document.getElementById('p-modalita').value;
      const box = document.getElementById('p-prezzo-box');
      const senzaPrezzo = (m === 'Scambio servizi' || m === 'Pro bono');
      box.style.display = senzaPrezzo ? 'none' : '';
      if (!senzaPrezzo) {
        document.getElementById('p-prezzo-label').textContent =
          (m === 'Pacchetto') ? 'Prezzo del pacchetto (€)' : 'Prezzo a sessione (€)';
        document.getElementById('p-prezzo').placeholder = (m === 'Pacchetto') ? 'es. 900' : 'es. 150';
      }
    }
    function openPercorso() {
      document.getElementById('p-titolo').textContent = 'Nuovo percorso';
      document.getElementById('p-id').value = '';
      document.getElementById('p-tipo').value = 'Individuale';
      document.getElementById('p-modalita').value = 'Standard';
      document.getElementById('p-sessioni').value = 8;
      document.getElementById('p-prezzo').value = '';
      document.getElementById('p-ore').value = 0;
      document.getElementById('p-promo').checked = false;
      document.getElementById('p-sconto').value = '';
      document.getElementById('p-data').value = '';
      document.getElementById('p-ore-box').style.display = '';
      if (document.getElementById('p-progetto')) document.getElementById('p-progetto').parentElement.style.display = '';
      modalitaCambiata();
      document.getElementById('modal-percorso').style.display='flex';
    }
    function editPercorso(pid) {
      const p = PERCORSI_DATI[pid];
      if (!p) { alert('Percorso non trovato: ricarica la pagina.'); return; }
      document.getElementById('p-titolo').textContent = 'Modifica percorso';
      document.getElementById('p-id').value = p.id;
      document.getElementById('p-tipo').value = p.tipo;
      document.getElementById('p-modalita').value = p.modalita;
      document.getElementById('p-sessioni').value = p.n_sessioni_previste;
      document.getElementById('p-prezzo').value = p.prezzo;
      document.getElementById('p-promo').checked = p.promo;
      document.getElementById('p-sconto').value = p.sconto_note;
      document.getElementById('p-data').value = p.data_inizio;
      // Ore già svolte e progetto non si toccano in modifica: le ore le ricalcolano le
      // sedute, e spostare un percorso di progetto è un'altra cosa dal correggere il prezzo.
      document.getElementById('p-ore-box').style.display = 'none';
      if (document.getElementById('p-progetto')) document.getElementById('p-progetto').parentElement.style.display = 'none';
      modalitaCambiata();
      document.getElementById('modal-percorso').style.display='flex';
    }
    async function savePercorso() {
      const pid = document.getElementById('p-id').value;
      const modalita = document.getElementById('p-modalita').value;
      const dati = {
        tipo: document.getElementById('p-tipo').value,
        modalita,
        n_sessioni_previste: document.getElementById('p-sessioni').value || 8,
        prezzo: document.getElementById('p-prezzo').value || null,
        promo: document.getElementById('p-promo').checked,
        sconto_note: document.getElementById('p-sconto').value,
        data_inizio: document.getElementById('p-data').value || null,
      };
      if (!pid) {
        dati.ore_fatte = document.getElementById('p-ore').value || 0;
        dati.progetto_id = (document.getElementById('p-progetto') ? document.getElementById('p-progetto').value : '') || null;
      }
      const url = '/dashboard/clients/'+CID+'/percorsi' + (pid ? '/'+pid : '');
      const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dati)});
      const d = await r.json().catch(()=>({}));
      if (d && d.error) { alert(d.error); return; }
      if (d && d.driveWarning) alert(d.driveWarning);
      location.reload();
    }
    async function chiudiPercorso(pid, fineIso, fineIt) {
      const msg = fineIso
        ? ("Chiudere questo percorso? La data di fine sarà " + fineIt + ", il giorno dell'ultima sessione.")
        : 'Chiudere questo percorso? Non ci sono sessioni registrate, quindi la data di fine sarà oggi.';
      if(!confirm(msg)) return;
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid+'/chiudi',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_fine: fineIso || null})});
      location.reload();
    }
    async function delPercorso(pid) {
      if(!confirm('Eliminare questo percorso? Le sue ore spariscono dall\\'estratto ICF. Operazione irreversibile.')) return;
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid,{method:'DELETE'}); location.reload();
    }
    // ⛔ 15/08 — tolte openPayment/savePayment/segnaRicevuto/deletePayment
    // insieme al pulsante «+ Pagamento» e alla sua finestrella. Lasciare
    // funzioni che nessuno chiama e' esattamente la trappola del 10/08 (il finto
    // pulsante "Aggiungi sessione"): chi legge il codice crede che la funzione
    // ci sia. Le rotte del server restano e si tolgono con la pulizia del
    // codice morto, portando la prova che nessuno le chiama.
    // Crea la proforma con TUTTO il maturato non ancora chiesto. Il numero non
    // si riusa mai, quindi prima si chiede conferma: un documento nato per
    // sbaglio brucia un numero e resta nell'elenco.
    async function chiediPagamento() {
      if(!confirm('Creo la proforma con tutte le sessioni non ancora chieste?\\n\\nIl numero che le viene assegnato non potrà essere riusato.')) return;
      var btn = document.getElementById('pf-btn'), err = document.getElementById('pf-error');
      btn.disabled = true; btn.textContent = 'Preparo il documento…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/clients/'+CID+'/proforma', { method:'POST' });
        var d = await r.json();
        if(!r.ok) throw new Error(d.error || 'Errore nella creazione della proforma');
        // 18/08 — niente scheda nuova: l'id viaggia e la finestrella si apre da
        // sola dopo la ricarica (vedi jsModalePdf).
        try { sessionStorage.setItem('pdf-appena-nata',
          JSON.stringify({ id: d.id, titolo: 'Proforma n. ' + d.numero })); } catch(e) {}
        location.reload();
      } catch(ex) {
        err.textContent = ex.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Chiedi il pagamento';
      }
    }
    ${/* ⚠️ `chiediRata()` NON si riscrive qui: la porta piano-ui.js, insieme alla
          finestrella del piano, ed è disponibile ogni volta che c'è una cifra
          concordata — cioè ogni volta che esistono delle rate da chiedere.
          Averla in due punti vorrebbe dire due versioni della stessa conferma. */ ''}
    // Cliccando fuori, la finestrella si chiude. ⚠️ Si SALTA quello che non c'e:
    // alcune finestrelle compaiono solo in certe schede (il piano solo se c'e una
    // cifra concordata) e una di queste e stata tolta il 15/08. Senza il filtro,
    // un getElementById che torna null fa fallire tutto il blocco.
    [document.getElementById('modal-edit'),document.getElementById('modal-percorso'),document.getElementById('modal-seduta'),document.getElementById('modal-piano'),document.getElementById('modal-incasso')]
      .filter(Boolean).forEach(m=>{
        m.addEventListener('click',e=>{ if(e.target===m) m.style.display='none'; });
      });
  </script>
  </body></html>`;
}

function leadsPage(leads, req) {
  const STATO_CFG = {
    nuovo:       { label:'Nuovo',        bg:'#e8f4fd', color:'#1A5280' },
    contattato:  { label:'Contattato',   bg:'#fff8dc', color:'#7a5c00' },
    call_fissata:{ label:'Call fissata', bg:'#e7f1ec', color:'#2e6b52' },
    incontro_fissato:{ label:'Incontro fissato', bg:'#eae6f7', color:'#4c3a86' },
    convertito:  { label:'Convertito',   bg:'#d1fae5', color:'#065f46' },
    perso:       { label:'Perso',        bg:'#fdf0ef', color:'#c0392b' },
  };

  const attivi = leads.filter(l => l.stato !== 'convertito' && l.stato !== 'perso');
  const archiviati = leads.filter(l => l.stato === 'convertito' || l.stato === 'perso');

  function renderRow(l) {
    const sc = STATO_CFG[l.stato] || STATO_CFG.nuovo;
    return `<tr>
      <td><strong>${esc(l.nome)} ${esc(l.cognome||'')}</strong>
        ${l.email ? `<br><span style="font-size:11px;color:#aaa">${esc(l.email)}</span>` : ''}
        ${l.telefono ? `<br><span style="font-size:11px;color:#aaa">${esc(l.telefono)}</span>` : ''}
      </td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
      <td style="font-size:12px;color:#aaa">${FONTE_LABEL[l.fonte]||l.fonte}</td>
      <td style="font-size:12px;color:#aaa">${l.data_prossimo_contatto ? itDate(l.data_prossimo_contatto) : '—'}</td>
      <td style="font-size:12px;color:#4a5568;max-width:180px">${esc(l.note||'')}</td>
      <td style="white-space:nowrap">
        <button onclick="editLead('${l.id}','${attr(l.nome)}','${attr(l.cognome||'')}','${attr(l.email||'')}','${attr(l.telefono||'')}','${l.fonte}','${l.stato}','${attr(l.note||'')}','${l.data_prossimo_contatto?String(l.data_prossimo_contatto).slice(0,10):''}')" class="btn btn-neutral btn-sm">Modifica</button>
        ${l.stato!=='convertito' ? `<button onclick="convertLead('${l.id}')" class="btn btn-neutral btn-sm" style="margin:0 4px" title="Trasforma questo lead in un cliente">→ Cliente</button>` : ''}
        <span style="display:inline-block;width:10px"></span><button onclick="deleteLead('${l.id}')" class="btn btn-danger btn-sm" title="Elimina il lead">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Lead</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'lead' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>Lead</h1><p style="color:#aaa;font-size:13px">${attivi.length} attivi · ${archiviati.length} archiviati</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo lead</button>
    </div>

    <input id="cerca" type="search" placeholder="🔍 Cerca lead (nome, email, telefono…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${attivi.length ? attivi.map(renderRow).join('') : `<tr><td colspan="6" class="empty">Nessun lead attivo.</td></tr>`}
        </tbody>
      </table>
    </div>

    ${archiviati.length ? `
    <h2 style="margin:24px 0 10px;font-size:14px;color:#aaa">Archiviati (convertiti / persi)</h2>
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th></th></tr></thead>
      <tbody>${archiviati.map(renderRow).join('')}</tbody></table>
    </div>` : ''}
  </div>

  <div id="modal-lead" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px" id="modal-lead-title">Nuovo lead</h2>
      <input type="hidden" id="lead-id">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome *</label><input id="l-nome" type="text"></div>
        <div class="form-group"><label>Cognome</label><input id="l-cognome" type="text"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="l-email" type="email"></div>
        <div class="form-group"><label>Telefono</label><input id="l-tel" type="tel"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Fonte</label>
          <select id="l-fonte">${fonteOptions('altro')}</select></div>
        <div class="form-group"><label>Stato</label>
          <select id="l-stato"><option value="nuovo">Nuovo</option><option value="contattato">Contattato</option><option value="call_fissata">Call fissata</option><option value="incontro_fissato">Incontro fissato</option><option value="perso">Perso</option></select></div>
      </div>
      <div class="form-group"><label>Prossimo contatto</label><input id="l-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="l-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeLeadModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveLead()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <div id="modal-area" class="modal-overlay">
    <div class="modal-box" style="width:340px">
      <h2 style="margin-bottom:6px">Converti in cliente</h2>
      <p style="color:#aaa;font-size:13px;margin-bottom:16px">Scegli l'area del nuovo cliente:</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="doConvert('Personal')" class="btn" style="background:#1A5280;color:#fff">Personal</button>
        <button onclick="doConvert('Business')" class="btn" style="background:#4F8B73;color:#fff">Business</button>
        <button onclick="doConvert('Young')" class="btn" style="background:#D8AE2E;color:#fff">Young</button>
      </div>
      <button onclick="closeAreaModal()" class="btn btn-neutral" style="width:100%;margin-top:14px">Annulla</button>
    </div>
  </div>

  <script>
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function openNew() {
      document.getElementById('modal-lead-title').textContent='Nuovo lead';
      document.getElementById('lead-id').value='';
      ['l-nome','l-cognome','l-email','l-tel','l-note','l-data'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('l-fonte').value='altro';
      document.getElementById('l-stato').value='nuovo';
      document.getElementById('modal-lead').style.display='flex';
    }
    function editLead(id,nome,cognome,email,tel,fonte,stato,note,data) {
      document.getElementById('modal-lead-title').textContent='Modifica lead';
      document.getElementById('lead-id').value=id;
      document.getElementById('l-nome').value=nome;
      document.getElementById('l-cognome').value=cognome;
      document.getElementById('l-email').value=email;
      document.getElementById('l-tel').value=tel;
      document.getElementById('l-fonte').value=fonte;
      document.getElementById('l-stato').value=stato;
      document.getElementById('l-note').value=note;
      document.getElementById('l-data').value=data;
      document.getElementById('modal-lead').style.display='flex';
    }
    function closeLeadModal() { document.getElementById('modal-lead').style.display='none'; }
    async function saveLead() {
      const nome = document.getElementById('l-nome').value.trim();
      if (!nome) { alert('Nome obbligatorio'); return; }
      const payload = {
        nome, cognome:document.getElementById('l-cognome').value,
        email:document.getElementById('l-email').value, telefono:document.getElementById('l-tel').value,
        fonte:document.getElementById('l-fonte').value, stato:document.getElementById('l-stato').value,
        note:document.getElementById('l-note').value, data_prossimo_contatto:document.getElementById('l-data').value||null,
      };
      const id = document.getElementById('lead-id').value;
      const url = id ? '/dashboard/leads/'+id : '/dashboard/leads';
      await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      location.reload();
    }
    let convertingLeadId = null;
    function convertLead(id) {
      convertingLeadId = id;
      document.getElementById('modal-area').style.display='flex';
    }
    function closeAreaModal() {
      document.getElementById('modal-area').style.display='none';
      convertingLeadId = null;
    }
    async function doConvert(area) {
      if (!convertingLeadId) return;
      const r = await fetch('/dashboard/leads/'+convertingLeadId+'/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area})});
      const d = await r.json();
      if (d.ok) location.href='/dashboard/clients/'+d.clientId;
      else { alert(d.error||'Errore conversione'); closeAreaModal(); }
    }
    async function deleteLead(id) {
      if(!confirm('Eliminare questo lead?')) return;
      await fetch('/dashboard/leads/'+id,{method:'DELETE'}); location.reload();
    }
    document.getElementById('modal-lead').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-lead')) closeLeadModal(); });
    document.getElementById('modal-area').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-area')) closeAreaModal(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// PAGINA COMMITTENTI / SPONSOR (Fase 1)
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// PAGINA ANOMALIE — «cosa sistemare prima di fatturare»
//
// Layout secondo la spec §8: pochi colori, testo grande sui dati, ogni voce è
// un blocco chiuso, il ruolo (Cliente / Committente / Progetto) è etichettato
// ed è anche colorato. Si legge mentre si lavora, quindi niente decorazioni.
// ═══════════════════════════════════════════════════════
// Le sezioni dell'area Amministrazione. Stanno QUI, sotto il titolo della
// pagina, non nella barra in alto: la barra porta ai quattro mondi, dove si va
// dentro un mondo lo decide il mondo (regola di Germano, 11/08).
// Una funzione sola per tutte le pagine dell'area: due copie della stessa barra
// sono due occasioni di dimenticarsi di aggiornarne una.
// Le voci spente sono le fasi 4 e 5 del cantiere fatturazione.
function amNav(attiva) {
  const voci = [
    { key: 'anomalie',  label: 'Anomalie',             href: '/dashboard/amministrazione' },
    { key: 'proforma',  label: 'Proforma',             href: '/dashboard/amministrazione/proforma' },
    { key: 'incassi',   label: 'Incassi',              off: true },
    { key: 'fatture',   label: 'Fatture da preparare', off: true },
    { key: 'emittente', label: 'Chi emette',           href: '/dashboard/amministrazione/emittente' },
  ];
  return `<nav class="am-nav" style="margin-top:14px">${voci.map(v => v.off
    ? `<span title="In arrivo">${v.label}</span>`
    : `<a href="${v.href}"${v.key === attiva ? ' class="on"' : ''}>${v.label}</a>`).join('')}</nav>`;
}

function anomaliePage(anomalie, conteggi, req) {
  const RUOLO = {
    cliente:     { label: 'Cliente',     bg: '#e8f4fd', color: '#1A5280', href: a => `/dashboard/clients/${a.id}` },
    committente: { label: 'Committente', bg: '#e7f1ec', color: '#2e6b52', href: () => '/dashboard/committenti' },
    progetto:    { label: 'Progetto',    bg: '#fdf6e3', color: '#8a6d1a', href: a => `/dashboard/progetti/${a.id}` },
  };

  // Un riquadro per SOGGETTO, con dentro tutti i suoi problemi (scelta di
  // Germano, 11/08): si apre la scheda di quella persona e si sistema tutto in
  // una volta, invece di ritrovare lo stesso nome in due riquadri diversi.
  const gruppi = fiscale.anomaliePerSoggetto(anomalie);

  const gruppiHtml = gruppi.map(g => {
    const r = RUOLO[g.ruolo];
    return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line);background:#fdfcf7">
        <span class="badge" style="background:${r.bg};color:${r.color}">${r.label}</span>
        <a href="${r.href(g)}" style="font-size:16px;font-weight:700;color:var(--blue);text-decoration:none">${esc(g.nome || '(senza nome)')}</a>
        <span style="font-size:12px;color:var(--hint);margin-left:auto">${g.voci.length} ${g.voci.length === 1 ? 'cosa da sistemare' : 'cose da sistemare'}</span>
      </div>
      ${g.voci.map(v => `
        <div style="padding:13px 18px;border-bottom:1px solid #f1f3f6">
          <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:3px">${esc(v.titolo)}</div>
          <div style="font-size:14px;color:#4A4A4A">${esc(v.messaggio)}</div>
        </div>`).join('')}
      <div style="padding:12px 18px">
        <a href="${r.href(g)}" class="btn btn-neutral btn-sm">Apri la scheda →</a>
      </div>
    </div>`;
  }).join('');

  const vuoto = `
    <div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7">
      <strong style="color:#2e6b52;font-size:15px">✅ Niente da sistemare.</strong>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">
        Tutti i clienti e i committenti con qualcosa da fatturare hanno i dati completi,
        e le quote dei progetti tornano.
      </div>
    </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Amministrazione</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione' })}
  <div class="container">
    <h1>Amministrazione</h1>
    ${amNav('anomalie')}
    <h2 style="margin-bottom:4px">Anomalie</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:6px">
      Quello che va sistemato <strong>prima</strong> di emettere una fattura.
    </p>
    <p style="color:var(--hint);font-size:12px;margin-bottom:20px">
      ${/* Detto in chiaro: qui non c'è tutto l'Hub. Chi non ha soldi in ballo non
            viene controllato, ed è una scelta, non una dimenticanza. */ ''}
      Sotto controllo: ${conteggi.nClienti} ${conteggi.nClienti === 1 ? 'cliente' : 'clienti'} con un percorso a pagamento ·
      ${conteggi.nCommittenti} ${conteggi.nCommittenti === 1 ? 'committente' : 'committenti'} con una quota ·
      ${conteggi.nProgetti} ${conteggi.nProgetti === 1 ? 'progetto' : 'progetti'} con un totale.
      Chi non ha niente da fatturare non compare.
    </p>
    ${anomalie.length ? gruppiHtml : vuoto}
  </div>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGINA PROFORMA (Fase 3, Tappa 3) — la lista dei passaggi.
//
// ⭐ Questa pagina NON è un prospetto di numeri da interpretare: è una sequenza
// di cose da fare, dall'alto in basso — chiedi → rileggi → (manda). È la
// richiesta di Germano del 12/08, ed è un requisito, non una premura:
// l'amministrazione gli pesa, quindi ogni riga deve dire l'AZIONE, col numero
// accanto, e non deve mai restare ferma in silenzio.
//
// I tre passaggi ci sono solo se hanno qualcosa dentro, tranne quando non c'è
// proprio niente: in quel caso lo dice, invece di lasciare la pagina bianca.
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ 18/08 — IL PDF SI APRE, E SI CHIUDE.
// Germano il 17/08: «ho provato ad aprire il pdf della proforma, si è aperto,
// ma non c'è la possibilità di chiuderlo». Il PDF si apriva in una SCHEDA NUOVA
// (target="_blank"), servita «inline»: in una scheda aperta così il tasto
// «indietro» del browser è spento, perché quella scheda non ha una storia. Non
// c'era niente di rotto — semplicemente l'Hub non offriva nessuna via d'uscita
// e per uscire bisognava sapere di dover chiudere la scheda.
// ⭐ Adesso il documento si apre DENTRO l'Hub, con la sua X e il suo «Chiudi».
// ⚠️ Resta anche «Apri in una scheda nuova»: per stampare o salvare il file
// serve il visualizzatore vero del browser, e su un telefono un PDF dentro un
// riquadro si legge male. Una via sola non basterebbe per tutti e due i casi.
// ═══════════════════════════════════════════════════════════════════════════
function modalePdf() {
  return `
    ${/* z-index sopra le altre finestrelle (che stanno a 100): l'anteprima si
          apre anche da DENTRO «Rivedi e manda», e deve starci sopra invece che
          sotto — altrimenti si aprirebbe e non si vedrebbe. */ ''}
    <div class="modal-overlay" id="modal-pdf" style="z-index:150">
      <div class="modal-box" style="max-width:900px;width:900px;padding:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <strong id="pdf-titolo" style="font-size:15px"></strong>
          <span style="flex:1"></span>
          <a id="pdf-scheda" href="#" target="_blank" class="btn btn-neutral btn-sm">Apri in una scheda nuova</a>
          <button onclick="chiudiPdf()" class="btn btn-neutral btn-sm" title="Chiudi">✕</button>
        </div>
        <iframe id="pdf-telaio" title="Anteprima del documento"
                style="width:100%;height:70vh;border:1px solid var(--line);border-radius:8px;background:#f7f9fb"></iframe>
        ${/* ⚠️ Questa riga c'è SEMPRE, e non è pigrizia. Non tutti i browser
              mostrano un PDF dentro un riquadro (su iPhone spesso no), e non
              c'è modo di saperlo da qui: se l'anteprima resta vuota, senza
              questa riga si tornerebbe al vicolo cieco di partenza — un
              documento aperto che non si sa come guardare né come chiudere. */ ''}
        <div style="font-size:11.5px;color:var(--hint);margin-top:6px">
          Non si vede il documento qui sopra? Aprilo in una scheda nuova con il pulsante in alto.
        </div>
        <div class="modal-actions" style="margin-top:12px">
          <span style="flex:1"></span>
          <button onclick="chiudiPdf()" class="btn btn-primary">Chiudi</button>
        </div>
      </div>
    </div>`;
}

function jsModalePdf() {
  return `
    function apriPdf(id, titolo) {
      var t = document.getElementById('pdf-telaio');
      document.getElementById('pdf-titolo').textContent = titolo || 'Documento';
      document.getElementById('pdf-scheda').href = '/dashboard/proforma/' + id + '/pdf';
      t.src = '/dashboard/proforma/' + id + '/pdf';
      document.getElementById('modal-pdf').style.display = 'flex';
    }
    function chiudiPdf() {
      // ⚠️ Si svuota il telaio: senza, il PDF resta caricato sotto la pagina e
      // alla riapertura si vedrebbe per un istante quello di prima.
      document.getElementById('pdf-telaio').src = 'about:blank';
      document.getElementById('modal-pdf').style.display = 'none';
    }
    // ⭐ 18/08 — UNA PROFORMA APPENA NATA SI FA VEDERE DA SOLA.
    // Chi la crea sta su un'altra pagina (la scheda del cliente, quella del
    // progetto) e poi viene portato qui: l'id viaggia nel sessionStorage, e qui
    // la finestrella si apre da sé. Prima al suo posto c'era una scheda nuova
    // del browser — cioè il vicolo cieco che stiamo togliendo.
    try {
      var appenaNata = sessionStorage.getItem('pdf-appena-nata');
      if (appenaNata) {
        sessionStorage.removeItem('pdf-appena-nata');
        var q = JSON.parse(appenaNata);
        if (q && q.id) apriPdf(q.id, q.titolo);
      }
    } catch (e) {}
    // Il tasto Esc chiude, come ci si aspetta da una finestrella.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById('modal-pdf')
          && document.getElementById('modal-pdf').style.display === 'flex') chiudiPdf();
    });`;
}

function proformaPage(daChiedere, proforme, req) {
  const eur = n => '€ ' + fiscale.euro(n);
  // Il numero del documento apre l'anteprima invece di portare via dalla pagina.
  const linkPdf = (p, stile) =>
    `<a href="#" onclick="apriPdf('${p.id}','Proforma n. ${esc(p.numero)}');return false" style="${stile}">n. ${esc(p.numero)}</a>`;

  const passo = (n, titolo, sottotitolo, corpo) => `
    <section style="margin-bottom:26px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:3px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:13px;font-weight:700;flex:none">${n}</span>
        <h2 style="margin:0">${titolo}</h2>
      </div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px 34px">${sottotitolo}</p>
      ${corpo}
    </section>`;

  // ── 1. Da chiedere ────────────────────────────────────────────────────────
  // Un riquadro per PERSONA (regola dell'11/08). Dentro: i mesi, le bozze che
  // resterebbero fuori, e o il pulsante o il motivo per cui non c'è.
  const chiediHtml = daChiedere.map(c => {
    const mesi = c.mesi.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <span style="font-size:14px;text-transform:capitalize">${meseEsteso(m.mese)}</span>
        <span style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--hint)">${m.n} ${m.n === 1 ? 'sessione' : 'sessioni'}${m.nIntake ? ` · ${m.nIntake === 1 ? 'intake' : m.nIntake + ' intake'} ×2` : ''}</span>
          <strong style="font-size:14px">${eur(m.importo)}</strong>
        </span>
      </div>`).join('');

    const bozze = c.nBozze ? `
      <div style="font-size:12px;color:#8a6d1e;background:#fdf6e3;border-radius:8px;padding:9px 12px;margin-top:10px">
        ⚠️ ${c.nBozze === 1 ? 'C’è 1 sessione in bozza' : `Ci sono ${c.nBozze} sessioni in bozza`}
        (${c.bozze.map(b => meseEsteso(b.mese)).join(', ')}):
        finché non ${c.nBozze === 1 ? 'la approvi' : 'le approvi'} non ${c.nBozze === 1 ? 'entra' : 'entrano'} nella proforma.
      </div>` : '';

    // Niente pulsante senza spiegazione: se manca qualcosa si dice cosa e dove.
    const azione = !c.nSessioni ? '' : (c.motivi && c.motivi.length ? `
      <div style="background:#fffdf6;border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;margin-top:12px">
        <div style="font-size:13px;font-weight:700;margin-bottom:5px">Non si può ancora chiedere il pagamento</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#4A4A4A">
          ${c.motivi.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
        </ul>
      </div>` : `
      <div style="margin-top:12px">
        <button onclick="chiedi('${c.id}')" id="ch-${c.id}" class="btn btn-primary btn-sm">
          Chiedi il pagamento — ${eur(c.totale)}
        </button>
      </div>`);

    return `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:2px">
          <a href="/dashboard/clients/${c.id}" style="font-size:16px;font-weight:700;color:var(--blue);text-decoration:none">${esc(c.name || '(senza nome)')}</a>
          ${c.nSessioni ? `<strong style="margin-left:auto;font-size:16px">${eur(c.totale)}</strong>` : ''}
        </div>
        ${mesi}${bozze}${azione}
      </div>`;
  }).join('');

  // ── 2. Da mandare ─────────────────────────────────────────────────────────
  // Chi è «da mandare» lo dice il modulo, non questa pagina: dal 13/08 la stessa
  // domanda la fa anche la home, e due filtri scritti a mano divergerebbero.
  const daMandare = proforme.filter(proforma.daMandare);

  // Quello che la finestrella d'invio deve avere in mano. Il testo lo prepara
  // `proforma.testoMail()`: la pagina non lo scrive, così è lo stesso testo
  // ovunque e si può provare senza aprire un browser.
  // L'indirizzo viene da quello congelato nel documento, e se lì manca da
  // quello del cliente in anagrafica: uno dei due c'è quasi sempre, e comunque
  // resta modificabile prima di mandare.
  const datiInvio = {};
  for (const p of daMandare) {
    const t = proforma.testoMail(p, p.righe);
    datiInvio[p.id] = {
      numero: p.numero,
      to: (p.destinatario_dati || {}).email || p.cliente_email || '',
      subject: t.subject, body: t.body,
      allegato: proforma.nomeFile(p),
    };
  }
  const mandareHtml = daMandare.map(p => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')} · ${p.data_emissione ? itDate(p.data_emissione) : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto">
          <strong style="font-size:15px">${eur(p.da_pagare)}</strong>
          <button onclick="apriPdf('${p.id}','Proforma n. ${esc(p.numero)}')" class="btn btn-neutral btn-sm">Apri il PDF</button>
          <button onclick="apriInvio('${p.id}')" class="btn btn-gold btn-sm">✉️ Rivedi e manda</button>
          <button onclick="annulla('${p.id}','${esc(p.numero)}',false)" class="btn btn-neutral btn-sm">Annulla</button>
        </div>
      </div>
    </div>`).join('');

  // ── 3. Mandate, in attesa di incasso ──────────────────────────────────────
  // ⭐ C4 — prima questa fila non esisteva: una proforma spedita finiva fra le
  // «Già fatte», che è una ricevuta e non chiede mai niente. Ma una proforma
  // mandata e non pagata è il momento in cui si vive per settimane, e senza una
  // riga che lo dica quei soldi si perdono di vista. Qui ogni riga porta il
  // gesto che le tocca: dire che sono arrivati.
  const inAttesa = proforme.filter(p =>
    p.stato === 'inviata' && !incassi.saldata(p));
  const attesaHtml = inAttesa.map(p => {
    const manca = incassi.residuo(p);
    const preso = incassi.sommaIncassi(p.incassi);
    // ⚠️ Quando la scadenza non si sa (rata legata a «metà percorso» senza data)
    // NON si mette il giorno dell'invio al suo posto: si dice che non si sa.
    // Una data inventata qui farebbe scattare un promemoria per un ritardo che
    // non esiste, ed è esattamente il difetto che Germano ha trovato il 18/08.
    const scad = p.scadenzaVera;
    // Le righe già registrate: un acconto si vede, e si può togliere se la data
    // o la cifra erano sbagliate. Non si «corregge» un fatto: si toglie.
    const righeInc = (p.incassi || []).map(i => `
      <div style="font-size:12px;color:var(--muted);margin-top:4px">
        arrivati ${eur(i.importo)} il ${itDate(i.data_incasso)}
        <button onclick="togliIncasso('${i.id}')" class="btn btn-neutral btn-sm" style="margin-left:6px">Togli</button>
      </div>`).join('');
    return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')}
            ${scad ? ' · scadenza ' + itDate(scad)
                   : ' · <span style="color:var(--hint)">scadenza non ancora nota</span>'}
            ${preso > 0 ? ` · <strong>acconto di ${eur(preso)} ricevuto</strong>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto">
          <strong style="font-size:15px">${eur(manca)}</strong>
          <button onclick="apriIncasso('${p.id}','n. ${esc(p.numero)} — ${esc(p.cliente_nome || '')}',${manca})" class="btn btn-gold btn-sm">È arrivato</button>
        </div>
      </div>
      ${righeInc}
    </div>`;
  }).join('');

  // ── 4. Incassate, da fatturare ────────────────────────────────────────────
  // ⭐ È il passaggio che impedisce a tutta la catena di finire in un vicolo
  // cieco: i soldi sono arrivati, e adesso la fattura elettronica va emessa a
  // mano in SuperBill. Il documento resta qui finché non se ne scrive il numero.
  // ⚠️ Il mese della fattura è quello dell'INCASSO, non quello del documento
  // (decisione 2 dell'11/08) — per questo la data la scrive Germano.
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const daFatturare = proforme.filter(incassi.daFatturare);
  const fatturareHtml = daFatturare.map(p => {
    const quando = incassi.dataChiudeIlConto(p.incassi);
    const mese = quando ? MESI[Number(quando.slice(5, 7)) - 1] + ' ' + quando.slice(0, 4) : '';
    return `
    <div class="card" style="margin-bottom:12px;border-left:3px solid #4F8B73">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')}
            ${quando ? ' · incassata il ' + itDate(quando) : ''}
            ${mese ? ` · <strong>fattura di ${mese}</strong>` : ''}
          </div>
          <div style="font-size:12px;color:var(--hint);margin-top:3px">
            Imponibile ${eur(p.imponibile)} · IVA ${eur(p.iva)}${Number(p.ritenuta) > 0 ? ` · ritenuta ${eur(p.ritenuta)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto">
          <label style="margin:0;text-transform:none;letter-spacing:0;font-size:12px;color:var(--muted)">N. fattura</label>
          <input id="fatt-${p.id}" value="${esc(p.fattura_numero || '')}" placeholder="es. 12/2026" style="width:120px">
          <button onclick="salvaFattura('${p.id}')" class="btn btn-primary btn-sm">Fatta</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── 5. Chiuse ─────────────────────────────────────────────────────────────
  // Non è un passaggio da fare: è la ricevuta, e serve a non chiedere due volte.
  // ⚠️ `inviata_data` è un MOMENTO, non una data: con itDate() usciva «Wed Aug
  // 12», perché quella funzione taglia una stringa ISO e qui arriva un timestamp.
  // itDateTime() lo scrive in ora italiana — e su una cosa spedita l'ora serve.
  //
  // 🔴 18/08 — DIVISE IN DUE, dopo che Germano ha guardato la pagina con i suoi
  // dati: «vengono indicate tutte quelle annullate, questo non dovrebbe
  // succedere». Prima un unico elenco «Già fatte» metteva la stessa faccia a
  // tre cose diverse, e tre prove annullate stavano sopra l'unica riga utile.
  // ⛔ Cancellarle NO (era la sua proposta, e gliel'ho detto): il numero resta
  // bruciato comunque, e un buco nella numerazione senza spiegazione è peggio
  // di un documento che dice ANNULLATA — soprattutto se quella proforma era
  // già stata spedita, e il cliente ce l'ha in mano.
  // ⭐ Quindi restano, ma ripiegate: si aprono se servono.
  const chiuse = proforme.filter(p =>
    !proforma.daMandare(p) && !inAttesa.includes(p) && !incassi.daFatturare(p));
  const concluse  = chiuse.filter(p => p.stato !== 'annullata');
  const annullate = chiuse.filter(p => p.stato === 'annullata');

  const rigaConclusa = p => {
    const quando = incassi.dataChiudeIlConto(p.incassi);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-weight:700;color:var(--blue);text-decoration:none")}
          <span style="font-size:13px;color:var(--muted);margin-left:8px">${esc(p.cliente_nome || '—')}</span>
          <div style="font-size:12px;color:var(--hint);margin-top:2px">
            ${quando ? 'incassata il ' + itDate(quando) : 'mandata' + (p.inviata_data ? ' il ' + itDateTime(p.inviata_data) : '')}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--ink)">${eur(p.da_pagare)}</span>
          ${/* ⭐ IL NUMERO DELLA FATTURA SI VEDE. Buco mio, trovato da Germano
                provando: appena lo scrivevi la riga spariva dal passaggio 4 e
                quel numero non compariva più da nessuna parte — se il
                commercialista chiede «che numero hai dato a questa?», bisognava
                andarlo a cercare nel documento. */ ''}
          ${p.fattura_numero
            ? `<span class="badge" style="background:#eafaf1;color:#065f46">Fattura n. ${esc(p.fattura_numero)}${p.fattura_data ? ' del ' + itDate(p.fattura_data) : ''}</span>`
            : `<span class="badge" style="background:#e8f4fd;color:#1A5280">Mandata${p.inviata_data ? ' il ' + itDateTime(p.inviata_data) : ''}</span>`}
          ${p.drive_url
            ? `<a href="${esc(p.drive_url)}" target="_blank" style="font-size:12px;color:var(--muted);text-decoration:none">copia su Drive</a>`
            : `<button onclick="riprovaDrive('${p.id}')" class="btn btn-neutral btn-sm" title="La mail è partita, ma la copia in archivio no">Copia su Drive non riuscita — riprova</button>`}
          <button onclick="annulla('${p.id}','${esc(p.numero)}',true)" class="btn btn-neutral btn-sm">Annulla</button>
        </div>
      </div>`;
  };

  // ⚠️ Un'annullata MAI SPEDITA e una annullata DOPO l'invio non sono la stessa
  // cosa: la seconda il cliente ce l'ha, e va detto. Prima avevano la stessa
  // etichetta grigia.
  const rigaAnnullata = p => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-weight:700;color:var(--hint);text-decoration:none")}
          <span style="font-size:13px;color:var(--hint);margin-left:8px">${esc(p.cliente_nome || '—')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--hint)">${eur(p.da_pagare)}</span>
          ${p.inviata_data
            ? `<span class="badge" style="background:#fdf0ee;color:#a4342a">Annullata dopo essere stata mandata</span>`
            : `<span class="badge" style="background:#f1f3f6;color:#8a8a8a">Annullata, mai mandata</span>`}
        </div>
      </div>`;

  const conclusaHtml = !concluse.length ? '' : `
    <section style="margin-top:34px">
      <h2 style="margin-bottom:4px;font-size:16px;color:var(--muted)">Chiuse</h2>
      <p style="color:var(--hint);font-size:12px;margin:0 0 10px">Incassate e già fatturate: non chiedono più niente.</p>
      <div class="card" style="padding:4px 18px">${concluse.map(rigaConclusa).join('')}</div>
    </section>`;

  // Ripiegate: ci sono, non stanno in mezzo. Il numero resta bruciato e il
  // documento resta consultabile — è tutto quello che serve.
  const annullateHtml = !annullate.length ? '' : `
    <section style="margin-top:22px">
      <details>
        <summary style="cursor:pointer;color:var(--muted);font-size:13px">
          ${annullate.length === 1 ? '1 proforma annullata' : annullate.length + ' proforma annullate'}
          <span style="color:var(--hint)">— il numero resta bruciato, il documento si può ancora aprire</span>
        </summary>
        <div class="card" style="padding:4px 18px;margin-top:10px">${annullate.map(rigaAnnullata).join('')}</div>
      </details>
    </section>`;

  const fatteHtml = conclusaHtml + annullateHtml;

  const nientePerNiente = !daChiedere.length && !proforme.length;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Proforma</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione' })}
  <div class="container">
    <h1>Amministrazione</h1>
    ${amNav('proforma')}
    <h2 style="margin-bottom:4px">Proforma</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:22px">
      Chiedere ai clienti quello che hanno maturato, un passaggio alla volta.
      La proforma <strong>non è una fattura</strong>: la fattura si emette dopo l'incasso.
    </p>

    ${nientePerNiente ? `
      <div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7">
        <strong style="color:#2e6b52;font-size:15px">✅ Non c'è niente da chiedere.</strong>
        <div style="font-size:13px;color:var(--muted);margin-top:6px">
          Nessuna sessione a pagamento in attesa, e nessuna proforma da mandare.
        </div>
      </div>` : `
      ${passo(1, 'Da chiedere', 'Sessioni già fatte e mai chieste. Il pulsante crea la proforma e le raccoglie tutte.',
        daChiedere.length ? chiediHtml : `<div class="card" style="color:var(--muted);font-size:13px">Niente in attesa: tutto quello che era maturato è già stato chiesto.</div>`)}

      ${passo(2, 'Da rileggere e mandare', 'Proforma create e non ancora spedite. Apri il PDF e controllalo prima di mandarlo.',
        daMandare.length ? mandareHtml + `
          <p style="font-size:12px;color:var(--hint);margin:6px 0 0">
            Il PDF si apre in una scheda nuova: rileggilo prima di mandarlo.
            Alla riuscita la proforma passa fra le «Già fatte» e una copia finisce su Drive.
          </p>`
        : `<div class="card" style="color:var(--muted);font-size:13px">Niente da mandare.</div>`)}

      ${passo(3, 'Mandate, in attesa di incasso', 'Proforma partite e non ancora pagate. Quando i soldi arrivano, dillo qui: la data che scrivi decide il mese della fattura.',
        inAttesa.length ? attesaHtml
        : `<div class="card" style="color:var(--muted);font-size:13px">Niente in attesa: tutto quello che è stato chiesto è stato pagato.</div>`)}

      ${passo(4, 'Incassate, da fatturare', 'I soldi sono arrivati: adesso la fattura elettronica va emessa in SuperBill. Scrivi qui il numero che le hai dato, e la riga sparisce.',
        daFatturare.length ? fatturareHtml
        : `<div class="card" style="color:var(--muted);font-size:13px">Nessuna fattura da preparare.</div>`)}

      ${fatteHtml}`}
  </div>

  ${/* ⭐ C4 — la finestrella dell'incasso è la STESSA delle schede col piano di
        pagamento (piano-ui.js): stesso markup, stesse funzioni, stesse parole.
        Registrare un incasso in due modi diversi sarebbe l'errore che questa
        fetta sta togliendo. */ ''}
  ${pianoUi.modaleIncasso()}
  ${modalePdf()}

  ${/* La finestrella è UNA sola per tutte le proforma: quello che cambia lo
        porta dentro `INVIO`, preparato qui dal server. Lo stesso schema di
        Mail 1 e Mail 2, che Germano conosce già. */ ''}
  <div id="modal-invio" class="modal-overlay">
    ${/* 🔴 18/08 — QUI ERA IL DIFETTO CHE GERMANO AVEVA VISTO: «compaiono tutti i
          campi di testo, ma nessuna cornice». La classe scritta era `.modal`, che
          nel foglio di stile non esiste — quindi nessuno sfondo, nessun bordo,
          nessuna ombra. Non era il contenitore che «perdeva» lo stile: non l'ha
          mai avuto. La classe vera è «.modal-box». */ ''}
    <div class="modal-box" style="max-width:640px">
      <h2 style="margin-bottom:4px">Rivedi e manda — <span id="mi-numero"></span></h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">
        Il testo si può cambiare: parte quello che vedi qui sotto.
      </p>
      <div class="form-group"><label>A chi</label><input id="mi-to" type="email"></div>
      <div class="form-group"><label>Oggetto</label><input id="mi-subject" type="text"></div>
      <div class="form-group"><label>Testo della mail</label>
        <textarea id="mi-body" style="min-height:240px;font-family:inherit"></textarea></div>
      <div style="background:#fbfcfd;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:4px">Allegato</div>
        ${/* 🔴 18/08 — L'ULTIMO PUNTO CHE APRIVA UNA SCHEDA NUOVA, e il più
              importante: è QUI che si arriva dopo aver creato una proforma, ed
              è qui che Germano ha continuato a trovarsi la finestra fuori
              dall'Hub («sinceramente non è cambiato niente»). L'avevo lasciato
              apposta per non sovrapporre due finestrelle — un motivo mio, non
              suo, e sbagliato: il vicolo cieco valeva anche qui.
              ⭐ Adesso apre l'anteprima, che ha uno z-index più alto e sta
              sopra questa; chiudendola si torna alla mail, che è rimasta lì
              con tutto quello che avevi scritto. */ ''}
        <a id="mi-pdf" href="#" style="font-size:13px;font-weight:700;color:var(--blue);text-decoration:none"></a>
        <div style="font-size:12px;color:var(--hint);margin-top:4px">Aprilo e rileggilo <strong>prima</strong> di mandarlo: dopo non si torna indietro.</div>
      </div>
      <div id="mi-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button onclick="document.getElementById('modal-invio').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="mi-send" onclick="mandaProforma()" class="btn btn-primary" style="flex:1">✉️ Manda adesso</button>
      </div>
    </div>
  </div>

  <script>
    var INVIO = ${JSON.stringify(datiInvio).replace(/</g, '\\u003c')};
    var invioCorrente = null;
    function apriInvio(id) {
      var d = INVIO[id]; if (!d) return;
      invioCorrente = id;
      document.getElementById('mi-numero').textContent = 'Proforma n. ' + d.numero;
      document.getElementById('mi-to').value = d.to || '';
      document.getElementById('mi-subject').value = d.subject;
      document.getElementById('mi-body').value = d.body;
      var a = document.getElementById('mi-pdf');
      // L'allegato apre l'ANTEPRIMA dentro l'Hub, non una scheda nuova. La
      // finestrella della mail resta aperta sotto: chiusa l'anteprima, il testo
      // che stavi scrivendo e' ancora li'.
      a.href = '#';
      a.onclick = function () { apriPdf(id, 'Proforma n. ' + d.numero); return false; };
      a.textContent = d.allegato;
      document.getElementById('mi-error').style.display = 'none';
      document.getElementById('modal-invio').style.display = 'flex';
    }
    async function mandaProforma() {
      var err = document.getElementById('mi-error');
      var to = document.getElementById('mi-to').value.trim();
      if (!to) { err.textContent = 'Serve un indirizzo destinatario.'; err.style.display = 'block'; return; }
      var d = INVIO[invioCorrente];
      if (!confirm('Mando la proforma n. ' + d.numero + ' a ' + to + '?\\n\\nAllegato: ' + d.allegato)) return;
      var btn = document.getElementById('mi-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/proforma/' + invioCorrente + '/invia', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to,
            subject: document.getElementById('mi-subject').value,
            body: document.getElementById('mi-body').value }) });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block';
          btn.disabled = false; btn.textContent = '✉️ Manda adesso'; return; }
        alert('Mandata a ' + j.to + '.'
          + (j.driveErrore ? '\\n\\nLa mail e\\' partita, ma la copia su Drive no: ' + j.driveErrore
                             + '\\nLa puoi riprovare dall\\'elenco «Gia\\' fatte».' : ''));
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = '✉️ Manda adesso'; }
    }
    async function riprovaDrive(id) {
      try {
        var r = await fetch('/dashboard/proforma/' + id + '/drive', { method: 'POST' });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
    async function chiedi(id) {
      if (!confirm('Creo la proforma con tutte le sessioni non ancora chieste?\\n\\nIl numero che le viene assegnato non potra\\' essere riusato.')) return;
      const btn = document.getElementById('ch-' + id);
      btn.disabled = true; btn.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/clients/' + id + '/proforma', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { alert(d.error || ('Errore ' + r.status)); btn.disabled = false; btn.textContent = 'Riprova'; return; }
        // 18/08 — niente scheda nuova: la finestrella si apre da sola dopo la
        // ricarica, e da li si chiude.
        try { sessionStorage.setItem('pdf-appena-nata',
          JSON.stringify({ id: d.id, titolo: 'Proforma n. ' + d.numero })); } catch (e) {}
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); btn.disabled = false; btn.textContent = 'Riprova'; }
    }
    async function annulla(id, numero, mandata) {
      // Il numero non torna disponibile: si dice prima, non dopo.
      var testo = 'Annullo la proforma n. ' + numero + '?\\n\\n'
        + 'Il numero resta bruciato e non si riusa. Le sessioni tornano fra quelle da chiedere.';
      if (mandata) testo += '\\n\\nATTENZIONE: questa proforma e\\' gia\\' stata mandata al cliente.';
      if (!confirm(testo)) return;
      try {
        const r = await fetch('/dashboard/proforma/' + id + '/annulla', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { alert(d.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }

    ${/* ⭐ C4 — apriIncasso / confermaIncasso / chiudiIncasso arrivano da
          piano-ui.js: sono le stesse delle schede col piano. */ ''}
    ${pianoUi.jsIncasso()}
    ${jsModalePdf()}

    // Un incasso non si corregge: si toglie e si rimette. Un fatto o c'e o non
    // c'e — e togliendolo il documento torna da se fra quelli in attesa.
    async function togliIncasso(id) {
      if (!confirm('Tolgo questo incasso?\\n\\nIl documento torna fra quelli in attesa di pagamento.')) return;
      try {
        var r = await fetch('/dashboard/incassi/' + id + '/togli', { method: 'POST' });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
    // Il numero della fattura emessa a mano in SuperBill. Si puo anche
    // cancellare: scritto sbagliato, la riga uscirebbe dalla fila con un numero
    // che non esiste.
    async function salvaFattura(id) {
      var n = document.getElementById('fatt-' + id).value.trim();
      if (!n && !confirm('Il numero e vuoto: la proforma torna fra quelle da fatturare. Confermi?')) return;
      try {
        var r = await fetch('/dashboard/proforma/' + id + '/fattura', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numero: n }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHI EMETTE (Fatturazione, Fase 3) — i dati che vanno in cima alla proforma.
//
// Nell'Hub non c'erano da nessuna parte: sapeva tutto dei clienti e niente di
// chi manda il documento. Una proforma senza l'IBAN non serve a niente — chi la
// riceve non sa dove pagare — quindi la pagina non si limita a raccogliere i
// dati: dice in cima, con parole intere, se si può emettere o cosa manca.
// ═══════════════════════════════════════════════════════════════════════════
function emittentePage(e, verdetto, salvato, req) {
  const v = k => attr(e[k] || '');
  const campo = (id, etichetta, extra = '') =>
    `<div class="form-group"><label>${etichetta}</label><input id="em-${id}" type="text" value="${v(id)}" ${extra}></div>`;
  const riga = (...campi) =>
    `<div style="display:grid;grid-template-columns:${campi.map(() => '1fr').join(' ')};gap:12px">${campi.join('')}</div>`;

  // Il verdetto sta in cima e non in fondo: è la prima cosa da sapere, e deve
  // essere leggibile senza contare i campi vuoti a occhio.
  const cartello = verdetto.pronto
    ? `<div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7;margin-bottom:18px">
         <strong style="color:#2e6b52;font-size:15px">✅ Puoi emettere proforma.</strong>
         ${verdetto.consigliati.length ? `<div style="font-size:13px;color:var(--muted);margin-top:6px">
           Non è obbligatorio, ma sul documento starebbe meglio anche: ${esc(verdetto.consigliati.join(', '))}.
         </div>` : ''}
       </div>`
    : `<div class="card" style="border-left:3px solid var(--gold);background:#fffdf6;margin-bottom:18px">
         <strong style="font-size:15px">Prima di poter mandare una proforma manca ancora qualcosa.</strong>
         <ul style="margin:8px 0 0;padding-left:20px;font-size:14px;color:#4A4A4A">
           ${verdetto.mancanti.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
         </ul>
       </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Chi emette</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione' })}
  <div class="container" style="max-width:1200px">
    <h1>Amministrazione</h1>
    ${amNav('emittente')}
    <h2 style="margin-bottom:4px">Chi emette</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
      I tuoi dati, quelli che finiscono in cima a ogni proforma. Si compilano una volta
      sola e si correggono quando cambiano.
    </p>
    ${salvato ? `<div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7;margin-bottom:18px;font-size:14px;color:#2e6b52"><strong>Salvato.</strong></div>` : ''}
    ${cartello}

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Chi sei</div>
      ${riga(campo('denominazione', 'Denominazione', 'placeholder="es. Noesys Professional Coaching"'))}
      ${riga(campo('nome', 'Nome'), campo('cognome', 'Cognome'))}
      ${riga(campo('partita_iva', 'Partita IVA'), campo('codice_fiscale', 'Codice fiscale'))}
      ${riga(
        `<div class="form-group"><label>Regime fiscale</label><select id="em-regime">
           <option value="ordinario"${(e.regime || 'ordinario') === 'ordinario' ? ' selected' : ''}>IVA ordinaria</option>
           <option value="forfettario"${e.regime === 'forfettario' ? ' selected' : ''}>Forfettario</option>
         </select></div>`,
        campo('ateco', 'Codice ATECO', 'placeholder="es. 70.20.09"'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Dove sei</div>
      ${riga(campo('via', 'Indirizzo', 'placeholder="via e numero civico"'))}
      ${riga(campo('cap', 'CAP'), campo('citta', 'Città'), campo('provincia', 'Provincia', 'placeholder="es. MI"'))}
      ${riga(campo('paese', 'Paese', 'placeholder="IT"'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Dove ti pagano</div>
      ${riga(campo('iban', 'IBAN', 'placeholder="IT.."'))}
      ${riga(campo('intestatario', 'Intestatario del conto'), campo('banca', 'Banca'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Come ti si contatta</div>
      ${riga(campo('email', 'Email'), campo('telefono', 'Telefono'))}
    </div>

    <div id="em-error" style="display:none" class="flash-error"></div>
    <button onclick="salvaEmittente()" id="em-btn" class="btn btn-primary">Salva</button>
  </div>

  <script>
    async function salvaEmittente() {
      var campi = ['denominazione','nome','cognome','partita_iva','codice_fiscale','regime',
                   'ateco','via','cap','citta','provincia','paese','iban','intestatario',
                   'banca','email','telefono'];
      var dati = {};
      campi.forEach(function (c) { dati[c] = (document.getElementById('em-' + c).value || '').trim(); });
      var btn = document.getElementById('em-btn'), err = document.getElementById('em-error');
      btn.disabled = true; btn.textContent = 'Salvo…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/amministrazione/emittente', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dati) });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Errore nel salvataggio');
        location.href = '/dashboard/amministrazione/emittente?salvato=1';
      } catch (ex) {
        err.textContent = ex.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Salva';
      }
    }
  </script>
  </body></html>`;
}

function committentiPage(committenti, req) {
  const TIPO_CFG = {
    azienda: { label: 'Azienda',  bg: '#e7f1ec', color: '#2e6b52' },
    persona: { label: 'Persona',  bg: '#e8f4fd', color: '#1A5280' },
  };

  function renderRow(k) {
    const tc = TIPO_CFG[k.tipo] || TIPO_CFG.azienda;
    const fatt = [k.partita_iva ? 'P.IVA '+esc(k.partita_iva) : '', k.codice_fiscale ? 'CF '+esc(k.codice_fiscale) : '']
      .filter(Boolean).join(' · ');
    // Il verdetto «pronto per fatturare» (11/08). Come per i clienti, compare solo
    // dove ci sono soldi veri in gioco: un committente senza quota da pagare non
    // ha niente da fatturare, quindi non ha niente da segnalare.
    const st = fiscale.statoFatturabilita(fiscale.daCommittente(k));
    const STILE = {
      pronto:        { bg:'#e7f1ec', color:'#2e6b52', segno:'✅ ' },
      incompleto:    { bg:'#fdf6e3', color:'#8a6d1a', segno:'⚠️ ' },
      da_verificare: { bg:'#e8f4fd', color:'#1A5280', segno:'⚠️ ' },
    }[st.stato];
    const verdetto = Number(k.quota_totale) > 0
      ? `<div style="margin-top:5px"><span style="display:inline-block;padding:3px 8px;border-radius:4px;background:${STILE.bg};color:${STILE.color};font-size:11px;line-height:1.5">${STILE.segno}${esc(st.messaggio)}</span></div>`
      : '';
    return `<tr>
      <td><strong>${esc(k.denominazione)}</strong>
        ${k.referente ? `<br><span style="font-size:11px;color:#aaa">${esc(k.referente)}${k.ruolo ? ' — '+esc(k.ruolo) : ''}</span>` : ''}
      </td>
      <td><span class="badge" style="background:${tc.bg};color:${tc.color}">${tc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">
        ${k.email ? esc(k.email) : ''}${k.email && k.telefono ? '<br>' : ''}${k.telefono ? `<span style="color:#aaa">${esc(k.telefono)}</span>` : ''}${!k.email && !k.telefono ? '<span style="color:#ccc">—</span>' : ''}
      </td>
      <td style="font-size:12px;color:#aaa">${fatt || '—'}${verdetto}</td>
      <td style="white-space:nowrap">
        <button onclick='editComm(${JSON.stringify(k).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <span style="display:inline-block;width:10px"></span>
        <button onclick="deleteComm('${k.id}')" class="btn btn-danger btn-sm" title="Elimina il committente">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Committenti</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'committenti' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Committenti</h1><p style="color:#aaa;font-size:13px">${committenti.length} ${committenti.length===1?'committente':'committenti'}</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo committente</button>
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Chi commissiona o paga un percorso (azienda o persona). Non ha accesso all'Hub.</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca committente (nome, referente, email…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Committente</th><th>Tipo</th><th>Contatto</th><th>Fatturazione</th><th></th></tr></thead>
        <tbody>
          ${committenti.length ? committenti.map(renderRow).join('') : `<tr><td colspan="5" class="empty">Nessun committente. Crea il primo con il pulsante qui sopra.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div id="modal-comm" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:16px" id="modal-comm-title">Nuovo committente</h2>
      <input type="hidden" id="c-id">
      <div style="display:grid;grid-template-columns:150px 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="c-tipo"><option value="azienda">Azienda</option><option value="persona">Persona</option></select></div>
        <div class="form-group"><label id="c-denom-label">Ragione sociale *</label><input id="c-denominazione" type="text"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Referente</label><input id="c-referente" type="text" placeholder="persona di contatto"></div>
        <div class="form-group"><label>Ruolo</label><input id="c-ruolo" type="text" placeholder="es. HR, dirigente, genitore"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="c-email" type="email"></div>
        <div class="form-group"><label>Telefono</label><input id="c-tel" type="tel"></div>
      </div>
      <h2 style="font-size:13px;margin:6px 0 12px;color:var(--muted)">Dati fatturazione</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Partita IVA</label><input id="c-piva" type="text"></div>
        <div class="form-group"><label>Codice fiscale</label><input id="c-cf" type="text"></div>
      </div>
      ${/* 11/08 — l'indirizzo era una riga sola e PEC e codice destinatario stavano
            in un campo unico. Per fatturare servono separati. Il vecchio campo
            `pec_sdi` resta nel database e non si tocca: il suo contenuto è già
            finito nel campo giusto (chi ha la chiocciola è una PEC). */ ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Regime fiscale</label>
          <select id="c-regime">
            <option value="">— non indicato —</option>
            <option value="ordinario">Ordinario</option>
            <option value="forfettario">Forfettario</option>
          </select></div>
        <div class="form-group"><label>Natura giuridica</label>
          <select id="c-natura">
            <option value="">— dal tipo —</option>
            <option value="persona_fisica">Persona fisica</option>
            <option value="persona_giuridica">Persona giuridica</option>
          </select></div>
      </div>
      <div class="form-group"><label>Indirizzo di fatturazione</label><input id="c-indirizzo" type="text" placeholder="es. Via Roma 12"></div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr 0.8fr;gap:12px">
        <div class="form-group"><label>CAP</label><input id="c-cap" type="text"></div>
        <div class="form-group"><label>Città</label><input id="c-citta" type="text"></div>
        <div class="form-group"><label>Prov.</label><input id="c-provincia" type="text" maxlength="4" placeholder="MI"></div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>PEC</label><input id="c-pec" type="email"></div>
        <div class="form-group"><label>Codice destinatario SDI</label><input id="c-sdi" type="text" maxlength="7"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px">
        <div class="form-group"><label>Paese</label><input id="c-paese" type="text" maxlength="2" placeholder="IT" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Identificativo fiscale estero</label><input id="c-idestero" type="text"></div>
      </div>
      <div class="form-group"><label>Note</label><input id="c-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeCommModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveComm()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    const F = ['tipo','denominazione','referente','ruolo','email','telefono','codice_fiscale','partita_iva','indirizzo','note',
               'regime','natura_giuridica','cap','citta','provincia','pec','codice_sdi','paese','identificativo_estero'];
    const ID = { tipo:'c-tipo', denominazione:'c-denominazione', referente:'c-referente', ruolo:'c-ruolo',
      email:'c-email', telefono:'c-tel', codice_fiscale:'c-cf', partita_iva:'c-piva',
      indirizzo:'c-indirizzo', note:'c-note',
      regime:'c-regime', natura_giuridica:'c-natura', cap:'c-cap', citta:'c-citta',
      provincia:'c-provincia', pec:'c-pec', codice_sdi:'c-sdi', paese:'c-paese',
      identificativo_estero:'c-idestero' };
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function syncDenomLabel() {
      document.getElementById('c-denom-label').textContent =
        document.getElementById('c-tipo').value === 'persona' ? 'Nome e cognome *' : 'Ragione sociale *';
    }
    document.getElementById('c-tipo').addEventListener('change', syncDenomLabel);
    function openNew() {
      document.getElementById('modal-comm-title').textContent = 'Nuovo committente';
      document.getElementById('c-id').value = '';
      Object.values(ID).forEach(id => document.getElementById(id).value = '');
      document.getElementById('c-tipo').value = 'azienda';
      document.getElementById('c-paese').value = 'IT';
      syncDenomLabel();
      document.getElementById('modal-comm').style.display = 'flex';
    }
    function editComm(k) {
      document.getElementById('modal-comm-title').textContent = 'Modifica committente';
      document.getElementById('c-id').value = k.id;
      F.forEach(f => document.getElementById(ID[f]).value = k[f] || '');
      syncDenomLabel();
      document.getElementById('modal-comm').style.display = 'flex';
    }
    function closeCommModal() { document.getElementById('modal-comm').style.display = 'none'; }
    async function saveComm() {
      const denominazione = document.getElementById('c-denominazione').value.trim();
      if (!denominazione) { alert('Denominazione obbligatoria'); return; }
      const payload = {};
      F.forEach(f => payload[f] = document.getElementById(ID[f]).value);
      const id = document.getElementById('c-id').value;
      const url = id ? '/dashboard/committenti/'+id : '/dashboard/committenti';
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    async function deleteComm(id) {
      if (!confirm('Eliminare questo committente?')) return;
      const r = await fetch('/dashboard/committenti/'+id, { method:'DELETE' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    document.getElementById('modal-comm').addEventListener('click', e => { if (e.target === document.getElementById('modal-comm')) closeCommModal(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// PAGINA PROGETTI (Fase 2)
// ═══════════════════════════════════════════════════════
function progettiPage(progetti, committenti, req) {
  const STATO_CFG = {
    'attivo':   { label:'Attivo',   bg:'#d1fae5', color:'#065f46' },
    'in pausa': { label:'In pausa', bg:'#fff8dc', color:'#7a5c00' },
    'concluso': { label:'Concluso', bg:'#eef1f5', color:'#7a8089' },
  };
  const TIPO_LABEL = { individuale:'Individuale', 'individuale-multiplo':'Individuale per più Clienti', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };

  const noComm = committenti.length === 0;
  const commOptions = committenti.map(c => `<option value="${c.id}">${esc(c.denominazione)}</option>`).join('');

  function renderRow(p) {
    const sc = STATO_CFG[p.stato] || STATO_CFG['attivo'];
    const ac = AREA_COL[p.area] || '#1A5280';
    const n = Number(p.n_coachee) || 0;
    return `<tr onclick="location.href='/dashboard/progetti/${p.id}'" style="cursor:pointer">
      <td><strong>${esc(p.titolo)}</strong>
        <br><span style="font-size:11px;color:#aaa">${esc(p.committente_nome)}</span>
      </td>
      <td><span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span></td>
      <td style="font-size:12px;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">${n > 0 ? `${n} ${n===1?'cliente':'clienti'}` : '<span style="color:#ccc">—</span>'}</td>
      <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        <button onclick='editProg(${JSON.stringify(p).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <span style="display:inline-block;width:10px"></span>
        <button onclick="deleteProg('${p.id}')" class="btn btn-danger btn-sm" title="Elimina il progetto">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Progetti Strutturati</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'progetti' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Progetti Strutturati</h1><p style="color:#aaa;font-size:13px">${progetti.length} ${progetti.length===1?'progetto':'progetti'}</p></div>
      ${noComm
        ? `<a href="/dashboard/committenti" class="btn btn-primary">+ Crea prima un committente</a>`
        : `<button onclick="openNew()" class="btn btn-primary">+ Nuovo progetto</button>`}
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Il percorso commissionato da un committente, che lo paga in tutto o in parte (ambito Business o Young). Lo stato segue la relazione: attivo · in pausa · concluso.</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca progetto (titolo, committente…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Progetto</th><th>Area</th><th>Tipo</th><th>Stato</th><th>Clienti</th><th>Inizio</th><th></th></tr></thead>
        <tbody>
          ${progetti.length ? progetti.map(renderRow).join('') : `<tr><td colspan="7" class="empty">Nessun progetto. ${noComm ? 'Crea prima un committente.' : 'Crea il primo con il pulsante qui sopra.'}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div id="modal-prog" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:16px" id="modal-prog-title">Nuovo progetto</h2>
      <input type="hidden" id="p-id">
      <div class="form-group"><label>Committente *</label>
        <select id="p-committente"><option value="">— scegli —</option>${commOptions}</select></div>
      <div class="form-group"><label>Titolo *</label><input id="p-titolo" type="text" placeholder="es. Percorso team vendite — Rossi SpA"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label>
          <select id="p-area"><option value="Business">Business</option><option value="Young">Young</option></select></div>
        <div class="form-group"><label>Tipo</label>
          <select id="p-tipo"><option value="individuale">Individuale</option><option value="individuale-multiplo">Individuale per più Clienti</option><option value="team">Team</option><option value="group">Group</option></select></div>
        <div class="form-group"><label>Stato</label>
          <select id="p-stato"><option value="attivo">Attivo</option><option value="in pausa">In pausa</option><option value="concluso">Concluso</option></select></div>
      </div>
      <div class="form-group"><label>Referente del progetto</label>
        <select id="p-ref-modo" onchange="toggleRef()">
          <option value="sponsor">Lo stesso committente</option>
          <option value="altra">Un'altra persona</option>
        </select></div>
      <div id="ref-extra" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Nome referente</label><input id="p-ref-nome" type="text" placeholder="Nome Cognome"></div>
          <div class="form-group"><label>Ruolo</label><input id="p-ref-ruolo" type="text" placeholder="es. HR, dirigente, genitore"></div>
        </div>
        <div class="form-group"><label>Email referente</label><input id="p-ref-email" type="email" placeholder="referente@azienda.it"></div>
      </div>
      <div class="form-group"><label>Data inizio</label><input id="p-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="p-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeProgModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveProg()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    const F = ['committente_id','titolo','area','tipo','stato','data_inizio','note','referente_modo','referente_nome','referente_ruolo','referente_email'];
    const ID = { committente_id:'p-committente', titolo:'p-titolo', area:'p-area', tipo:'p-tipo',
      stato:'p-stato', data_inizio:'p-data', note:'p-note',
      referente_modo:'p-ref-modo', referente_nome:'p-ref-nome', referente_ruolo:'p-ref-ruolo', referente_email:'p-ref-email' };
    function toggleRef() {
      var m = document.getElementById('p-ref-modo').value;
      document.getElementById('ref-extra').style.display = (m === 'altra') ? 'block' : 'none';
    }
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function openNew() {
      document.getElementById('modal-prog-title').textContent = 'Nuovo progetto';
      document.getElementById('p-id').value = '';
      Object.values(ID).forEach(id => document.getElementById(id).value = '');
      document.getElementById('p-committente').value = '';
      document.getElementById('p-area').value = 'Business';
      document.getElementById('p-tipo').value = 'individuale';
      document.getElementById('p-stato').value = 'attivo';
      document.getElementById('p-ref-modo').value = 'sponsor';
      toggleRef();
      document.getElementById('modal-prog').style.display = 'flex';
    }
    function editProg(p) {
      document.getElementById('modal-prog-title').textContent = 'Modifica progetto';
      document.getElementById('p-id').value = p.id;
      F.forEach(f => document.getElementById(ID[f]).value = (f==='data_inizio' && p[f]) ? String(p[f]).slice(0,10) : (p[f] || ''));
      document.getElementById('p-ref-modo').value = p.referente_modo || 'sponsor';
      toggleRef();
      document.getElementById('modal-prog').style.display = 'flex';
    }
    function closeProgModal() { document.getElementById('modal-prog').style.display = 'none'; }
    async function saveProg() {
      const committente_id = document.getElementById('p-committente').value;
      const titolo = document.getElementById('p-titolo').value.trim();
      if (!committente_id) { alert('Scegli un committente'); return; }
      if (!titolo) { alert('Titolo obbligatorio'); return; }
      const payload = {};
      F.forEach(f => payload[f] = document.getElementById(ID[f]).value);
      payload.data_inizio = payload.data_inizio || null;
      const id = document.getElementById('p-id').value;
      const url = id ? '/dashboard/progetti/'+id : '/dashboard/progetti';
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    async function deleteProg(id) {
      if (!confirm('Eliminare questo progetto?')) return;
      const r = await fetch('/dashboard/progetti/'+id, { method:'DELETE' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    document.getElementById('modal-prog').addEventListener('click', e => { if (e.target === document.getElementById('modal-prog')) closeProgModal(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// PAGINA DETTAGLIO PROGETTO (Fase 3a) — dati + coachee collegati
// ═══════════════════════════════════════════════════════
function progettoDettaglioPage(p, coachee, req, disponibili, percorsi, fasi, seduteColl, piano, rateChieste) {
  // ⭐ C3 — l'insieme delle rate gia dentro una proforma viva: da qui esce lo
  // stato «Chiesta». Se non arriva, `statoDi` ripiega sulla colonna salvata.
  rateChieste = rateChieste || new Map();
  // Fetta B (Mattone 2) — il percorso CONDIVISO (team/group) e le sue sessioni collettive.
  seduteColl = seduteColl || [];
  const percCond = (percorsi || []).find(x => !x.client_id) || null;
  // Come nella Scheda Cliente: il percorso finisce il giorno dell'ultima sessione
  // confermata, e quella data si propone alla chiusura.
  const ultimaColl = seduteColl
    .filter(s => s.stato === 'confermata' && s.data)
    .map(s => new Date(s.data)).sort((a, b) => b - a)[0];
  const collFineIso = ultimaColl ? ultimaColl.toISOString().slice(0, 10) : '';
  const collFineIt  = ultimaColl ? itDate(ultimaColl.toISOString()) : '';
  const collCard = !percCond ? '' : (() => {
    const hasDrive = !!(percCond.drive_url && percCond.drive_url.trim());
    const body = seduteColl.length === 0
      ? `<div style="font-size:13px;color:var(--muted)">Nessuna sessione ancora. Salva i report (file "Report… .docx") nelle sottocartelle Intake/Ongoing/Final della cartella del percorso, poi premi "Cerca nuovi report".</div>`
      : `<div style="overflow-x:auto">
          <table class="scheda-cliente">
            <thead><tr><th>Data</th><th>Sessione</th><th>Obiettivo</th><th>Argomenti trattati</th><th>Attività concordate</th><th>Scadenza</th><th>Eseg.</th><th>Note</th><th></th></tr></thead>
            <tbody>${seduteColl.map(renderSedutaRow).join('')}</tbody>
          </table>
        </div>`;
    return `
    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px;flex-wrap:wrap">
        <h2 style="margin:0">Scheda ${percCond.tipo === 'Group' ? 'del Gruppo' : 'del ' + esc(percCond.tipo)} <span style="font-weight:400;font-size:13px;color:#aaa">(${(Number(percCond.n_sessioni_fatte)||0)} ${(Number(percCond.n_sessioni_fatte)||0)===1?'sessione confermata':'sessioni confermate'} · ${fmtOre(percCond.ore_fatte)} h)</span></h2>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${hasDrive ? `<button id="scan-coll-btn" onclick="scanCollettivo()" class="btn btn-gold btn-sm" title="Legge i report Word nuovi dalla cartella del percorso e ne crea la bozza">⟳ Cerca nuovi report</button>` : ''}
          <span style="display:inline-block;width:10px"></span>
          ${percCond.stato === 'attivo'
            ? `<button onclick="chiudiPercorsoColl()" class="btn btn-neutral btn-sm" title="Concludi il percorso di gruppo">Chiudi il percorso</button>`
            : `<span class="badge badge-inactive">Percorso concluso</span>`}
        </div>
      </div>
      ${!hasDrive ? `<div style="font-size:12px;color:#b45309;margin-bottom:10px">Crea prima la cartella Drive del percorso (colonna "Cartella sessioni" qui sopra) per l'automazione dei report.</div>` : ''}
      ${body}
    </div>`;
  })();
  // Fase 3a — le tappe con lo sponsor. La card parte VUOTA: si aggiungono a mano da
  // una tendina ("+ Aggiungi fase"). In futuro l'automazione (report nella cartella
  // Drive del progetto) le riconoscerà e le spunterà da sola, come già per le sessioni
  // dei percorsi individuali. FASI_CFG = tipi previsti, in ordine; ORDER dà l'ordine
  // di visualizzazione anche se aggiunte in un ordine diverso.
  const FASI_CFG = [
    { tipo:'pre-intake',       label:'Pre-Intake',           opt:false },
    // Etichette a schermo con la terminologia bloccata: si dice COMMITTENTE, non
    // "Sponsor". I `tipo` nel database restano quelli di prima (intake-sponsor,
    // chiusura-sponsor): cambia solo la parola che si legge.
    { tipo:'intake-sponsor',   label:'Intake con il Committente',   opt:false },
    { tipo:'kick-off',         label:'Kick-Off',                    opt:false },
    { tipo:'chiusura-open',    label:'Chiusura Open',               opt:true  },
    { tipo:'chiusura-sponsor', label:'Chiusura con il Committente', opt:false },
  ];
  const FASE_LABELS = {}, FASE_ORDER = {};
  FASI_CFG.forEach((c, i) => { FASE_LABELS[c.tipo] = c.label; FASE_ORDER[c.tipo] = i; });

  // Voci del report per ciascun tipo di fase (mattone 2). key = campo nella scatola
  // JSON `contenuto`; label = etichetta mostrata; proj = voce che è verità di PROGETTO
  // (Intake) e va su `progetti`, non nel contenuto. Comuni a tutte: Partecipanti · Note.
  const VOCI_FASE = {
    'pre-intake': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti discussi' },
      { key:'obiettivo_grezzo', label:'Obiettivo grezzo (pre-SMARTER)' },
      { key:'ipotesi_partecipanti', label:'Ipotesi n° partecipanti e caratteristiche' },
      { key:'richieste', label:'Eventuali richieste specifiche' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'intake-sponsor': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti discussi' },
      { key:'obiettivo_smarter', label:'Obiettivo di progetto (SMARTER)', proj:'obiettivo_smarter' },
      { key:'parametri', label:'Parametri di verifica del successo', proj:'parametri' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'kick-off': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti presentati (Committente/Coach)' },
      { key:'interventi', label:'Interventi importanti dei partecipanti' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'chiusura-open': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti trattati' },
      { key:'traguardi', label:'Traguardi celebrati' },
      { key:'note', label:'Note' },
    ],
    'chiusura-sponsor': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti trattati' },
      { key:'feedback_sponsor', label:'Feedback del Committente' },
      { key:'note', label:'Note' },
    ],
  };
  // Pre-Intake: dal #2 in poi due voci cambiano etichetta (conferma/modifica).
  const PRE_SUCC_LABELS = {
    obiettivo_grezzo: 'Obiettivo grezzo (conferma/modifica)',
    ipotesi_partecipanti: 'Conferma/modifica n° partecipanti e caratteristiche',
  };
  const projVals = { obiettivo_smarter: p.obiettivo_smarter || '', parametri: p.parametri || '' };
  const faseDetail = (tipo, contenuto, isPrimoPre) => {
    const voci = VOCI_FASE[tipo] || [];
    const c = contenuto || {};
    return voci.map(v => {
      let label = v.label;
      if (tipo === 'pre-intake' && !isPrimoPre && PRE_SUCC_LABELS[v.key]) label = PRE_SUCC_LABELS[v.key];
      const val = v.proj ? (projVals[v.proj] || '') : (c[v.key] != null ? c[v.key] : '');
      return `<div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;font-weight:600;color:#4a5568;margin-bottom:3px">${esc(label)}${v.proj ? ' <span style="color:#2563eb;font-weight:400">· obiettivo di progetto</span>' : ''}</label>
        <textarea class="f-voce" data-key="${esc(v.key)}"${v.proj ? ` data-proj="${esc(v.proj)}"` : ''} rows="2" style="width:100%;font-size:13px;resize:vertical">${esc(String(val))}</textarea>
      </div>`;
    }).join('');
  };
  const faseRow = (tipo, f, isPrimoPre, num) => {
    const fid  = f ? f.id : '';
    const data = f && f.data ? f.data : '';
    const fatta = f ? !!f.fatta : false;
    const stato = f ? (f.stato || 'confermata') : 'confermata';
    const contenuto = f ? (f.contenuto || {}) : {};
    const ord = FASE_ORDER[tipo] != null ? FASE_ORDER[tipo] : 9;
    const label = (FASE_LABELS[tipo] || tipo) + (tipo === 'pre-intake' && num ? ' #' + num : '');
    const isBozza = stato === 'bozza';
    return `<div class="fase-block" data-tipo="${tipo}" data-fid="${esc(fid)}" data-order="${ord}" style="padding:10px 0;border-top:1px solid #eef1f5">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <span class="fase-label" style="min-width:150px;font-weight:600;font-size:13px;color:var(--ink)">${esc(label)}</span>
        ${isBozza ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 7px;border-radius:6px">bozza</span>` : ''}
        <input type="date" class="f-data" value="${esc(data)}" style="width:150px">
        <label style="font-size:12px;color:#4a5568;display:flex;align-items:center;gap:5px;flex:0 0 auto;white-space:nowrap;text-transform:none;letter-spacing:0;font-weight:500;margin:0"><input type="checkbox" class="f-fatta" style="width:auto;margin:0" ${fatta ? 'checked' : ''}> fatta</label>
        <button type="button" onclick="toggleDettaglio(this)" class="btn btn-neutral btn-sm">Dettaglio ▾</button>
        ${isBozza ? `<button type="button" onclick="approvaFase(this)" class="btn btn-sm" style="background:#e7f1ec;color:#2e6b52" title="Approva la fase in bozza">✓ Approva</button>` : ''}
        <button type="button" onclick="salvaFase(this)" class="btn btn-neutral btn-sm">Salva</button>
        <span style="display:inline-block;width:14px"></span>
        <button type="button" onclick="delFase(this)" class="btn btn-danger btn-sm" title="Elimina la fase">🗑</button>
      </div>
      <div class="fase-dettaglio" style="display:none;margin-top:10px;padding:10px;background:#f9fafb;border-radius:8px">
        ${faseDetail(tipo, contenuto, isPrimoPre)}
      </div>
    </div>`;
  };
  const fasiSorted = (fasi || []).slice().sort((a, b) =>
    (FASE_ORDER[a.tipo] != null ? FASE_ORDER[a.tipo] : 9) - (FASE_ORDER[b.tipo] != null ? FASE_ORDER[b.tipo] : 9));
  let preN = 0;
  const fasiRows = fasiSorted.map(f => {
    let num = 0, isPrimo = true;
    if (f.tipo === 'pre-intake') { preN += 1; num = preN; isPrimo = (preN === 1); }
    return faseRow(f.tipo, f, isPrimo, num);
  }).join('');
  const fasiMenuItems = FASI_CFG.map(c =>
    `<button type="button" onclick="addFase('${c.tipo}')" style="display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;font-size:13px;color:var(--ink);cursor:pointer">${c.label}${c.opt ? ' <span style="color:#aaa;font-size:11px">(facoltativa)</span>' : ''}</button>`
  ).join('');
  const fasiCard = `
    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">Fasi del progetto</h2>
        ${p.drive_url
          ? `<button id="scan-fasi-btn" onclick="scanProgetto()" class="btn btn-gold btn-sm" title="Legge i report nuovi dalle sottocartelle di fase su Drive e ne crea la riga in bozza">⟳ Cerca nuovi report</button>`
          : `<span style="font-size:12px;color:var(--muted)">crea la cartella Drive per l'automazione</span>`}
      </div>
      <div id="fasi-list">${fasiRows}</div>
      <div id="fasi-empty" style="display:${fasiSorted.length ? 'none' : 'block'};font-size:13px;color:var(--muted);padding:6px 0">Nessuna fase ancora. Aggiungila con il pulsante qui sotto.</div>
      <div style="position:relative;margin-top:12px">
        <button type="button" onclick="toggleFaseMenu()" class="btn btn-primary btn-sm">+ Aggiungi fase ▾</button>
        <div id="fase-menu" style="display:none;position:absolute;left:0;top:100%;margin-top:4px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);min-width:220px;z-index:50;overflow:hidden">
          ${fasiMenuItems}
        </div>
      </div>
    </div>`;
  const STATO_CFG = {
    'attivo':   { label:'Attivo',   bg:'#d1fae5', color:'#065f46' },
    'in pausa': { label:'In pausa', bg:'#fff8dc', color:'#7a5c00' },
    'concluso': { label:'Concluso', bg:'#eef1f5', color:'#7a8089' },
  };
  const TIPO_LABEL = { individuale:'Individuale', 'individuale-multiplo':'Individuale per più Clienti', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };
  const sc = STATO_CFG[p.stato] || STATO_CFG['attivo'];
  const ac = AREA_COL[p.area] || '#1A5280';

  // Clienti esistenti (non ancora in questo progetto) da collegare senza doppioni.
  disponibili = disponibili || [];
  const nDisponibili = disponibili.length;
  const opzioniClienti = disponibili.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name || c.cognome || 'Senza nome')}${c.area ? ' — ' + esc(c.area) : ''}</option>`
  ).join('');

  // Fase 3B — quota del progetto (pg restituisce i NUMERIC come stringa).
  const qTot     = p.quota_totale      != null ? Number(p.quota_totale)      : null;
  const qComm    = p.quota_committente != null ? Number(p.quota_committente) : null;
  // Senza il valore del progetto non c'è niente da riepilogare: i quattro numeri
  // restano nascosti e la scheda lo dice.
  const ammQuoteSet = qTot != null && qTot > 0;
  const eur = fiscale.euro;

  // ── IL PIANO DI PAGAMENTO DEL COMMITTENTE (12/08) ───────────────────────
  // Un committente non paga il totale in una volta. Finché non c'è un piano,
  // «chiedi la quota» chiederebbe tutti i 7.000 in un colpo — che non è mai
  // quello che succede. Qui il piano si propone (30/40/30 a 30 giorni) e si
  // corregge; quello che si salva sono gli EURO, la percentuale è solo un modo
  // di scriverli.
  const pianoSalvato = piano || [];
  const inneschiOpt = Object.entries(tranche.INNESCHI)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  // Chi paga, in ordine: prima il committente, poi i partecipanti che hanno una
  // quota loro. Un progetto senza quote dei partecipanti mostra solo il primo —
  // niente sezioni vuote da saltare con gli occhi.
  const pagatori = [];
  if (qComm) {
    pagatori.push({ key: 'comm', pid: null, nome: p.committente_nome,
      ruolo: 'committente', quota: Math.round(qComm), tipo: 'committente' });
  }
  // ⚠️ TUTTI i partecipanti, anche quelli senza quota: e' da questa riga che la
  // quota si scrive, e un partecipante che non compare non si puo' compilare.
  coachee.forEach(k => {
    pagatori.push({ key: k.part_id, pid: k.part_id, nome: k.name, email: k.email || '',
      client_id: k.client_id,
      ruolo: 'partecipante', quota: k.quota_coachee != null ? Math.round(Number(k.quota_coachee)) : 0,
      tipo: 'partecipante' });
  });

  const piani = pagatori.map(pg => {
    const suoi = pianoSalvato.filter(t => (t.partecipazione_id || null) === pg.pid);
    return { ...pg, nuovo: !suoi.length,
      righe: pianoUi.righeDi(suoi, pg.quota, pg.tipo, rateChieste) };
  });

  // ⭐ I QUATTRO NUMERI si contano dalle tranche SALVATE, non dalle proposte:
  // una proposta non è un impegno con nessuno.
  const tot4 = tranche.totali(pianoSalvato, qTot, rateChieste);

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(p.titolo)}</title>${baseStyle()}
  <style>
    /* ⭐ AMMINISTRAZIONE COMPATTA (12/08). Germano: «dovrebbe potersi leggere
       tutta la scheda in un'unica schermata… è tutto troppo grande».
       ⚠️ Solo da 1025px in su. Sotto restano intatte le misure per il dito
       (44px / 16px / 11px), che valgono fino a 1024px e non si toccano: le due
       richieste non si contraddicono, riguardano schermi diversi. */
    @media (min-width: 1025px) {
      #amm { padding: 14px 18px; }
      #amm h2 { font-size: 14px; margin-bottom: 4px; }
      #amm th { padding: 4px 10px; font-size: 10px; }
      #amm td { padding: 3px 10px; font-size: 12.5px; }
      /* Gli ultimi 47 pixel per far stare la scheda in una schermata: sono
         venuti da qui e dal margine in alto della pagina, non da altri tagli
         al contenuto. */
      .container { padding-top: 16px; }
      #amm input, #amm select { padding: 5px 9px; font-size: 12.5px; border-radius: 7px; }
      #amm .btn-sm { padding: 4px 10px; font-size: 11.5px; }
      #amm .badge { padding: 2px 8px; font-size: 10px; }
      #amm .form-group { margin-bottom: 8px; }
      #amm label { font-size: 10px; margin-bottom: 2px; }
      #amm .amm-num { padding: 8px 10px; }
      /* ⚠️ Col dito, la finestrella del piano deve stare dentro lo schermo.
         La regola generale delle finestrelle sotto i 768px è width:auto, e
         "auto" con dentro una TABELLA vuol dire «larga quanto la tabella»: il
         riquadro sbordava di 4px e faceva scorrere di lato TUTTA la pagina.
         Qui si fissa al 100% dello spazio disponibile, così è la tabella a
         scorrere dentro il suo riquadro (che ha overflow-x) invece della
         pagina. Regola mirata a questa sola finestrella: le altre non hanno
         tabelle dentro e non vanno toccate. */
      #amm .amm-num-v { font-size: 15px; }
      #amm .amm-pagatore { margin-top: 10px; padding-top: 9px; }
      #amm .amm-sep { margin-top: 16px; padding-top: 12px; }
      #amm #q-riepilogo { padding: 6px 10px; font-size: 12px; margin-top: 8px; }
      #amm p { font-size: 12px; }
    }
    ${/* ⚠️ QUESTO BLOCCO STA FUORI da quello qui sopra, e ci deve restare.
          L'avevo scritto dentro `@media (min-width: 1025px)`: «sopra 1025 E
          insieme sotto 768» non è mai vero, quindi la regola non si applicava
          mai e la misura non cambiava di un pixel. Prima di dire che una regola
          non funziona, guardare dentro quale media query è finita. */ ''}
    @media (max-width: 768px) {
      /* Col dito la finestrella del piano deve stare nello schermo: la regola
         generale delle finestrelle è width:auto, e "auto" con dentro una
         TABELLA vuol dire «larga quanto la tabella». */
      #modal-piano .modal-box { width: 100% !important; }
      /* 🔴 IL VERO COLPEVOLE dello scorrimento laterale su telefono — e non era
         la finestrella: i QUATTRO NUMERI stanno in quattro colonne fisse e a
         375px sbordavano di 36px, trascinandosi dietro tutta la pagina,
         finestrella compresa (un overlay si misura sul documento). Difetto che
         c'era già dal 12/08. Sotto i 768px vanno su due righe da due. */
      #amm-body > div { grid-template-columns: repeat(2, 1fr) !important; }
      #amm .amm-num { min-width: 0; }
    }
  </style></head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'progetti', briciole: [
    { label: 'Progetti Strutturati', href: '/dashboard/progetti' },
    { label: p.titolo },
  ] })}
  <div class="container">
    <div style="margin-bottom:18px">
      <h1>${esc(p.titolo)}</h1>
      <p style="color:#aaa;font-size:13px">Committente: <strong style="color:var(--ink)">${esc(p.committente_nome)}</strong>${p.committente_email ? ` · ${esc(p.committente_email)}` : ''}</p>
      <p style="color:#aaa;font-size:13px">Referente: <strong style="color:var(--ink)">${
        (p.referente_modo || 'sponsor') === 'altra'
          ? `${esc(p.referente_nome || '—')}`
          : `${esc(p.committente_nome)}`
      }</strong>${
        (p.referente_modo || 'sponsor') === 'altra'
          ? `${p.referente_ruolo ? ` · ${esc(p.referente_ruolo)}` : ''}${p.referente_email ? ` · ${esc(p.referente_email)}` : ''}`
          : ` <span style="color:#aaa">(il committente stesso)</span>`
      }</p>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span>
        <span class="badge" style="background:#eef1f5;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</span>
        <span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
        ${p.data_inizio ? `<span class="badge" style="background:#eef1f5;color:#7a8089">Inizio ${itDate(p.data_inizio)}</span>` : ''}
      </div>
      ${p.drive_url
        ? `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><a href="${esc(p.drive_url)}" target="_blank" style="font-size:13px;word-break:break-all">${esc(p.drive_url)}</a></div>`
        : `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><button id="drive-folders-btn" onclick="creaCartelleProgetto()" class="btn btn-neutral btn-sm">🔄 Crea cartelle Drive</button><span id="drive-folders-msg" style="font-size:12px;color:#6B7280;margin-left:8px"></span></div>`}
    </div>

    ${(p.obiettivo_smarter || p.parametri || p.note) ? `<div class="card">
      ${p.obiettivo_smarter ? `<div style="margin-bottom:10px"><div class="field-label">Obiettivo di progetto (SMARTER)</div><div class="field-value" style="white-space:pre-wrap">${esc(p.obiettivo_smarter)}</div></div>` : ''}
      ${p.parametri ? `<div style="margin-bottom:10px"><div class="field-label">Parametri di verifica del successo</div><div class="field-value" style="white-space:pre-wrap">${esc(p.parametri)}</div></div>` : ''}
      ${p.note ? `<div><div class="field-label">Note</div><div class="field-value" style="white-space:pre-wrap">${esc(p.note)}</div></div>` : ''}
    </div>` : ''}

    ${/* ═══ UNA SOLA TABELLA (12/08, secondo ripensamento) ═══════════════
          Germano, misurando: «dovrebbe potersi leggere tutta la scheda in
          un'unica schermata». Misurata: era alta 1376px su una finestra di 900.
          E il problema NON era la dimensione dei caratteri — quelli erano già
          stretti: erano **tre tabelle separate, una per pagatore, ognuna con la
          sua intestazione**, 623px per cinque righe di dati; più i nomi dei
          pagatori scritti due volte, nelle quote e di nuovo nel piano.
          Qui c'è una tabella sola: ogni pagatore è una RIGA DI GRUPPO con la sua
          quota, e sotto stanno le sue rate. Le intestazioni si scrivono una
          volta, e la tabella delle quote sparisce perché la quota è diventata
          una colonna di questa. */ ''}
    <div class="card" id="amm" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <h2 style="margin:0">Amministrazione
          <span style="font-size:12px;font-weight:400;color:#aaa;margin-left:10px">
            Valore del progetto: <strong style="color:var(--ink)">${qTot != null ? '€ ' + eur(qTot) : '—'}</strong>
          </span>
        </h2>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button onclick="apriPiano()" class="btn btn-primary btn-sm">Modifica il piano</button>
          <button onclick="openAdd()" class="btn btn-neutral btn-sm">+ Aggiungi cliente</button>
        </div>
      </div>

      <div id="amm-empty" style="display:${ammQuoteSet ? 'none' : 'block'};font-size:13px;color:var(--muted);margin-bottom:12px">Imposta il valore del progetto per vedere il riepilogo.</div>
      ${/* QUATTRO numeri: «chiesto ma non ancora pagato» è lo stato in cui si
            vive per settimane, e dentro un generico «da incassare» spariva.
            Vengono dalle rate SALVATE — una proposta non è un impegno. */ ''}
      <div id="amm-body" style="display:${ammQuoteSet ? 'block' : 'none'};margin-bottom:12px">
        ${pianoUi.quattroNumeri(tot4, pianoSalvato.length > 0)}
      </div>

      ${/* ⭐ 15/08 — LA SCHEDA NON SI SCRIVE PIÙ, SI LEGGE. Germano: «la trovo
            caotica e poco immediata… %/Da chiedere/Incassata/+ rata si scrive
            male e fa casino». La causa era meccanica: OGNI tasto rifaceva la
            tabella con innerHTML, quindi il campo in cui stavi scrivendo veniva
            distrutto e il cursore saltava fuori — 22 campi su 22. Provato:
            digitando «4» su una percentuale da 30 restava «4», cioè 280 € invece
            di 2.800.
            Ora le due cose stanno in due posti: qui SI GUARDA (chi, quanto,
            quando scade, a che punto), nella finestrella SI IMPOSTA. Il piano lo
            tocchi una volta a progetto; lo stato lo guardi ogni settimana.
            Le colonne «%», «Quando» e «Giorni» sono sparite di qui: la prima è
            un'etichetta accanto all'importo, le altre due sono già riassunte da
            «Scade il». */ ''}
      <div style="overflow-x:auto;margin:0 -4px">
        <table style="min-width:560px">
          <thead><tr>
            <th style="text-align:left">Chi paga · rata</th>
            <th style="text-align:left">Importo</th>
            <th style="text-align:left">Scade il</th>
            <th style="text-align:left">A che punto</th>
            <th></th>
          </tr></thead>
          <tbody id="amm-righe"></tbody>
        </table>
      </div>

      <div id="q-riepilogo" style="margin-top:8px;font-size:12.5px;color:#4a5568"></div>
    </div>

    ${/* ── LA FINESTRELLA DEL PIANO ────────────────────────────────────────
          Un posto solo dove si imposta tutto: valore del progetto, quota di
          ciascun pagatore, e le sue rate. Un solo «Salva».
          ⚠️ Gli id `q-totale`, `q-comm` e la classe `.q-coachee` restano QUELLI
          DI PRIMA anche se ora vivono qui dentro: li leggono `salvaAmmSilenzioso`
          e `ricaricaConservando`, che tengono le modifiche non salvate quando la
          pagina si ricarica per altri motivi (aggiungi partecipante, cartelle,
          fasi). Cambiarli avrebbe rotto quella rete in silenzio. */ ''}
    ${/* ⚠️ 15/08 — QUI SERVE `width`, NON `max-width`. Germano: «la finestra non
          contiene tutti i campi, bisogna scorrere orizzontalmente». Avevo scritto
          max-width:720px credendo di allargarla, ma `.modal-box` ha
          **width: 520px** fisso: un max-width più grande non allarga niente, e
          la finestrella è sempre rimasta da 520 mentre la tabella dentro ne
          chiedeva 718. Misurato: 198px fuori dal bordo.
          860 = 718 della tabella + i due padding (box 52 + riquadro pagatore 26)
          e un margine per le etichette lunghe. Sta dentro un portatile e anche
          un iPad in orizzontale; sotto i 768px il CSS lo riporta già a tutta
          larghezza da solo. */ ''}
    ${pianoUi.modale({
      labelValore: 'Valore del progetto',
      valore: qTot,
      dataMeta: p.data_meta ? String(p.data_meta).slice(0, 10) : '',
      dataFine: p.data_fine ? String(p.data_fine).slice(0, 10) : '',
      sottotitolo: 'Quanto vale il progetto, chi paga quanto, e in quante volte. Si scrivono gli euro: la percentuale la calcola l\'Hub.',
      mostraDividi: true,
    })}
    ${pianoUi.modaleIncasso()}

    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h2 style="margin:0">Percorsi</h2>
        <span style="font-size:12px;color:var(--muted)">nascono da soli dai clienti del progetto</span>
      </div>
      ${(percorsi && percorsi.length) ? `<div style="overflow-x:auto;margin:0 -4px"><table style="min-width:480px">
        <thead><tr>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Tipo</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Cliente/i</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Lavoro svolto</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Stato</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Cartella sessioni</th>
        </tr></thead>
        <tbody>${percorsi.map(pc => {
          const condiviso = !pc.client_id;
          const sess = Number(pc.n_sessioni_fatte) || 0;
          const ore  = Number(pc.ore_fatte) || 0;
          const chi = condiviso
            ? (pc.partecipanti ? esc(pc.partecipanti) : `<span style="color:#aaa">nessun partecipante</span>`)
            : `<a href="/dashboard/clients/${pc.client_id}" style="color:#1A5280;text-decoration:none">${esc(pc.client_name || '—')}</a>`;
          // Cartella Drive: solo per il percorso CONDIVISO (i report di sessione collettiva
          // vivono lì). Gli individuali usano la cartella del cliente → '—'.
          const drive = !condiviso
            ? `<span style="color:#aaa">—</span>`
            : (pc.drive_url
                ? `<a href="${esc(pc.drive_url)}" target="_blank" style="font-size:12px;color:#1A5280">Apri su Drive ↗</a>`
                : `<button onclick="creaCartelleSessioni('${pc.id}', this)" class="btn btn-neutral btn-sm">Crea cartelle su Drive</button>`);
          return `<tr>
            <td><strong>${esc(pc.tipo)}</strong>${condiviso ? ` <span class="badge" style="background:#eef1f5;color:#4a5568">condiviso</span>` : ''}</td>
            <td style="font-size:13px">${chi}</td>
            <td style="font-size:12px;white-space:nowrap">
              <span style="font-size:13px;font-weight:700;color:var(--blue)">${sess}</span> <span style="font-size:11px;color:#aaa">${sess === 1 ? 'sessione' : 'sessioni'}</span>${ore > 0 ? `<span style="color:#dfe3e8"> · </span><span style="font-weight:700;color:var(--green)">${fmtOre(ore)}</span> <span style="font-size:11px;color:#aaa">h</span>` : ''}
            </td>
            <td><span class="badge ${pc.stato === 'attivo' ? 'badge-active' : 'badge-inactive'}">${pc.stato === 'attivo' ? 'Attivo' : 'Concluso'}</span></td>
            <td style="white-space:nowrap">${drive}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
      : `<div style="font-size:13px;color:var(--muted)">Nessun percorso ancora: si generano da soli quando aggiungi i clienti al progetto.</div>`}
    </div>

    ${collCard}

    ${fasiCard}
  </div>

  <div id="modal-coachee" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px">Aggiungi cliente</h2>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button type="button" id="mode-new" onclick="setAddMode('new')" class="btn btn-primary btn-sm" style="flex:1">Cliente nuovo</button>
        <button type="button" id="mode-existing" onclick="setAddMode('existing')" class="btn btn-neutral btn-sm" style="flex:1">Cliente esistente</button>
      </div>

      <div id="add-new">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Nome</label><input id="k-nome" type="text"></div>
          <div class="form-group"><label>Cognome *</label><input id="k-cognome" type="text"></div>
        </div>
        <div class="form-group"><label>Email</label><input id="k-email" type="email"></div>
        <p style="color:var(--muted);font-size:12px;margin-bottom:12px">Nasce come cliente con il suo link alla piattaforma. La cartella Drive si crea dopo, dalla sua scheda.</p>
      </div>

      <div id="add-existing" style="display:none">
        ${nDisponibili
          ? `<div class="form-group"><label>Scegli un cliente già in anagrafica</label>
               <select id="k-existing"><option value="">— seleziona —</option>${opzioniClienti}</select></div>
             <p style="color:var(--muted);font-size:12px;margin-bottom:12px">Lo colleghi al progetto senza doppioni. I suoi dati non vengono toccati.</p>`
          : `<p style="color:var(--muted);font-size:13px;margin-bottom:12px">Non ci sono altri clienti da collegare: o sono già tutti in questo progetto, o non ne hai ancora altri in anagrafica.</p>`}
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="closeAdd()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveCoachee()" class="btn btn-primary" style="flex:1">Aggiungi</button>
      </div>
    </div>
  </div>

  <!-- Fetta B (Mattone 2) — modale sessione collettiva (crea/modifica) -->
  <div id="modal-seduta" class="modal-overlay">
    <div class="modal-box" style="width:600px;max-width:94vw">
      <h2 id="seduta-title" style="margin-bottom:16px">Aggiungi sessione</h2>
      <input id="s-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="s-tipo" onchange="oreAuto()"><option value="Intake">Intake</option><option value="Ongoing" selected>Ongoing</option><option value="Final">Final</option></select></div>
        <div class="form-group"><label>Data</label><input id="s-data" type="date"></div>
      </div>
      <div class="form-group" style="max-width:220px"><label>Ore <span id="s-ore-hint" style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0"></span></label><input id="s-ore" type="number" step="0.5" min="0"></div>
      <div class="form-group"><label>Obiettivo <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(comune al gruppo, una frase)</span></label><textarea id="s-obiettivo" style="min-height:54px"></textarea></div>
      <div class="form-group"><label>Argomenti trattati <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga; cita i nomi dei singoli dove serve)</span></label><textarea id="s-argomenti" style="min-height:72px" placeholder="- primo argomento&#10;- **Marco:** ha portato…"></textarea></div>
      <div class="form-group"><label>Attività concordate <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga)</span></label><textarea id="s-attivita" style="min-height:60px" placeholder="- attività comune&#10;- **Anna:** attività individuale"></textarea></div>
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr 1fr;gap:12px">
        <div class="form-group"><label>Scadenza <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(data)</span></label><input id="s-scadenza" type="date"></div>
        <div class="form-group"><label>Ora <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(prossimo)</span></label><input id="s-ora" type="time"></div>
        <div class="form-group"><label>Eseguita</label><select id="s-eseguita"><option value="">—</option><option value="✓">✓ fatta</option><option value="✗">✗ non fatta</option></select></div>
      </div>
      <div class="form-group"><label>Note</label><textarea id="s-note" style="min-height:60px"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-seduta').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveSeduta()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#223B6E;color:#fff;padding:10px 18px;border-radius:22px;font-size:13px;z-index:200">Link copiato!</div>

  <script>
    const PID = ${JSON.stringify(p.id)};

    ${/* ⭐ 15/08 — LA FINESTRELLA DEL PIANO NON STA PIÙ QUI DENTRO.
          Sta in `piano-ui.js` e la usa anche la scheda del cliente, perché un
          percorso a Pacchetto paga a rate esattamente come un progetto
          (decisione di Germano del 15/08). Tenerne due copie avrebbe voluto
          dire due occasioni di divergere — lo stesso guaio che avevamo appena
          finito di riparare fra la scheda del progetto e quella del cliente. */ ''}
    ${pianoUi.js({
      piani,
      dataFirma: p.data_inizio ? String(p.data_inizio).slice(0, 10) : '',
      quotaPerPagatore: true,
    })}

    // ── Quello che cambia da pagina a pagina ─────────────────────────────
    // I comandi sulla riga di un pagatore. Qui si apre la sua scheda e lo si
    // toglie dal progetto; sulla scheda del cliente non c'è niente da fare,
    // perché il pagatore è la persona di cui stai già guardando la scheda.
    function azioniPagatore(pg) {
      if (pg.tipo === 'committente') return '';
      return '<a href="/dashboard/clients/' + pg.client_id + '" class="btn btn-neutral btn-sm">Scheda</a>'
        + ' <button onclick="removeCoachee(\\'' + pg.pid + '\\')" class="btn btn-danger btn-sm" title="Togli dal progetto">🗑</button>';
    }
    // Il riepilogo in cima alla scheda si rifà dopo la tabella: è un testo
    // derivato, non un campo, e qui nessuno sta scrivendo.
    function dopoDisegnaPiano() { recalcQuota(); }

    // Fetta B (Mattone 2) — sessioni collettive del percorso condiviso.
    const COLL_PID = ${JSON.stringify(percCond ? percCond.id : '')};
    const COLL_FINE_ISO = ${JSON.stringify(collFineIso)};   // data dell'ultima sessione confermata
    const COLL_FINE_IT  = ${JSON.stringify(collFineIt)};
    const SEDUTE = ${JSON.stringify(Object.fromEntries(seduteColl.map(s => [s.id, { id: s.id, percorso_id: s.percorso_id, tipo: s.tipo, data: s.data, ore: Number(s.ore), obiettivo: s.obiettivo || '', argomenti: s.argomenti || '', attivita: s.attivita || '', scadenza: s.scadenza || '', prossima_ora: s.prossima_ora || '', eseguita: s.eseguita || '', note: s.note || '' }]))).replace(/</g, '\\u003c')};
    const ORE_TIPO_COLL = { Intake: 2, Ongoing: 1, Final: null };
    function oreAuto() {
      const t = document.getElementById('s-tipo').value;
      const auto = ORE_TIPO_COLL[t];
      const ore = document.getElementById('s-ore'), hint = document.getElementById('s-ore-hint');
      if (auto != null) { ore.value = auto; hint.textContent = '(preimpostate per ' + t + ', modificabili)'; }
      else { hint.textContent = '(Final: a mano)'; }
    }
    function openSeduta() {
      document.getElementById('seduta-title').textContent = 'Aggiungi sessione';
      document.getElementById('s-id').value = '';
      document.getElementById('s-tipo').value = 'Ongoing';
      document.getElementById('s-data').value = new Date().toISOString().slice(0, 10);
      ['s-obiettivo','s-argomenti','s-attivita','s-scadenza','s-ora','s-eseguita','s-note'].forEach(id => document.getElementById(id).value = '');
      oreAuto();
      document.getElementById('modal-seduta').style.display = 'flex';
    }
    function editSeduta(sid) {
      const s = SEDUTE[sid]; if (!s) return;
      document.getElementById('seduta-title').textContent = 'Modifica sessione';
      document.getElementById('s-id').value = s.id;
      document.getElementById('s-tipo').value = s.tipo;
      document.getElementById('s-data').value = s.data ? String(s.data).slice(0, 10) : '';
      document.getElementById('s-obiettivo').value = s.obiettivo || '';
      document.getElementById('s-argomenti').value = s.argomenti || '';
      document.getElementById('s-attivita').value = s.attivita || '';
      document.getElementById('s-scadenza').value = s.scadenza || '';
      // \\d e non \d: siamo dentro una template literal, dove \d diventerebbe una
      // semplice "d" e la regola non riconoscerebbe piu' un orario (campo vuoto).
      document.getElementById('s-ora').value = /^\\d{1,2}:\\d{2}$/.test(s.prossima_ora || '') ? s.prossima_ora : '';
      document.getElementById('s-eseguita').value = s.eseguita || '';
      document.getElementById('s-note').value = s.note || '';
      oreAuto();
      document.getElementById('s-ore').value = s.ore;
      document.getElementById('modal-seduta').style.display = 'flex';
    }
    async function saveSeduta() {
      const sid = document.getElementById('s-id').value;
      const g = id => document.getElementById(id).value;
      const body = { tipo: g('s-tipo'), data: g('s-data') || null, ore: g('s-ore') || 0, obiettivo: g('s-obiettivo'), argomenti: g('s-argomenti'), attivita: g('s-attivita'), scadenza: g('s-scadenza'), prossima_ora: g('s-ora'), eseguita: g('s-eseguita'), note: g('s-note') };
      const url = '/dashboard/progetti/' + PID + '/percorsi/' + COLL_PID + '/sedute' + (sid ? ('/' + sid) : '');
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      ricaricaConservando();
    }
    async function delSeduta(sid, pid) {
      if (!confirm('Eliminare questa sessione? Le ore si ricalcolano.')) return;
      await fetch('/dashboard/progetti/' + PID + '/percorsi/' + pid + '/sedute/' + sid, { method: 'DELETE' }); ricaricaConservando();
    }
    async function approvaSeduta(sid, pid) {
      if (!confirm('Approvare questa scheda? Da bozza diventa una sessione confermata e le ore entrano nel conteggio (categoria Team/Group).')) return;
      const r = await fetch('/dashboard/progetti/' + PID + '/percorsi/' + pid + '/sedute/' + sid + '/approva', { method: 'POST' });
      let d = {}; try { d = await r.json(); } catch (e) {}
      if (d.proponiChiusura && confirm('Questa era la sessione Final. Chiudo anche il percorso, con data ' + d.dataFineIt + '?')) {
        await fetch('/dashboard/progetti/' + PID + '/percorsi/' + pid + '/chiudi',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_fine: d.dataFine }) });
      }
      ricaricaConservando();
    }
    async function chiudiPercorsoColl() {
      const msg = COLL_FINE_ISO
        ? ("Concludere il percorso di gruppo? La data di fine sarà " + COLL_FINE_IT + ", il giorno dell'ultima sessione.")
        : 'Concludere il percorso di gruppo? Non ci sono sessioni registrate, quindi la data di fine sarà oggi.';
      if (!confirm(msg)) return;
      await fetch('/dashboard/progetti/' + PID + '/percorsi/' + COLL_PID + '/chiudi',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_fine: COLL_FINE_ISO || null }) });
      ricaricaConservando();
    }
    async function scanCollettivo() {
      const btn = document.getElementById('scan-coll-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/progetti/' + PID + '/scan-collettivo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : '. Controlla che il file inizi con "Report" e sia nelle sottocartelle Intake/Ongoing/Final del percorso.'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto, da approvare.');
        ricaricaConservando();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }

    // Cartella Drive del progetto: crea (o ripristina) l'albero se drive_url è vuoto.
    async function creaCartelleProgetto() {
      const btn = document.getElementById('drive-folders-btn');
      const msg = document.getElementById('drive-folders-msg');
      btn.disabled = true; msg.style.color='#6B7280'; msg.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (d.error) { msg.style.color='#b45309'; msg.textContent = d.error; btn.disabled = false; return; }
        ricaricaConservando();
      } catch(e) { msg.style.color='#b45309'; msg.textContent = 'Errore di rete, riprova'; btn.disabled = false; }
    }

    // Fetta B / Mattone 1 — crea la cartella Drive del percorso CONDIVISO (team/group)
    // dentro il progetto (sottocartelle Intake/Ongoing/Final). Poi ricarica per mostrare il link.
    async function creaCartelleSessioni(pid, btn) {
      const old = btn.textContent; btn.disabled = true; btn.textContent = 'Creo…';
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/percorsi/'+pid+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || 'Errore');
        ricaricaConservando();
      } catch(e) { alert('Errore: '+e.message); btn.disabled = false; btn.textContent = old; }
    }

    // ── Fase 3B: quota del progetto ──
    // Gemella di fiscale.euro() per il BROWSER (il modulo del server non si puo
    // chiamare qui). useGrouping always = il punto delle migliaia anche sotto le
    // 5 cifre, scelta di Germano del 17/08.
    function euro(n) { return Number(n||0).toLocaleString('it-IT', { minimumFractionDigits:2, maximumFractionDigits:2, useGrouping:'always' }); }

    // ── I quattro numeri in cima ──
    // ⚠️ Qui si aggiorna SOLO «Concordato», che è la quota totale scritta nel
    // campo qui accanto. Gli altri tre vengono dalle tranche SALVATE e li scrive
    // il server: aggiornarli mentre si digita vorrebbe dire contare come
    // «da chiedere» delle rate che ancora non esistono, cioe' mostrare un numero
    // che sparisce ricaricando la pagina.
    function renderAmministrazione() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      const body = document.getElementById('amm-body');
      const empty = document.getElementById('amm-empty');
      if (!isFinite(tot) || tot <= 0) { body.style.display = 'none'; empty.style.display = 'block'; return; }
      body.style.display = 'block'; empty.style.display = 'none';
      document.getElementById('amm-atteso').textContent = '€ ' + euro(tot);
    }
    function recalcQuota() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      // ⚠️ q-comm nasce dentro la tabella, che disegna il JS: al primo giro puo'
      // non esserci ancora. Prima si leggeva senza guardare, e la pagina si
      // fermava con la tabella vuota — un guasto muto, la scheda sembrava solo
      // «senza dati».
      const elComm = document.getElementById('q-comm');
      const comm = elComm ? parseFloat(elComm.value) : NaN;
      // Una riga sola di verifica: prima ce n'erano due che dicevano la stessa
      // cosa da due punti di vista (quanto resta / quanto coprono i clienti).
      const box = document.getElementById('q-riepilogo');
      if (!isFinite(tot) || tot <= 0) {
        box.textContent = 'Scrivi il valore del progetto per vedere la divisione.';
        renderAmministrazione();
        return;
      }
      const c = isFinite(comm) ? comm : 0;
      const somma = (typeof PIANI !== 'undefined')
        ? PIANI.reduce(function (s2, pg) { return s2 + (Number(pg.quota) || 0); }, 0) : c;
      const pct = Math.round(c / tot * 100);
      const diff = tot - somma;
      box.innerHTML = diff === 0
        ? '<span style="color:#4F8B73">Le quote coprono € ' + euro(tot) + ' — torna.</span>'
          + ' <span style="color:var(--hint)">Il committente copre il ' + pct + '%.</span>'
        : '<span style="color:#b45309">Le quote sommano € ' + euro(somma) + ' su € ' + euro(tot)
          + (diff > 0 ? ': mancano € ' + euro(diff) : ': € ' + euro(-diff) + ' di troppo') + '.</span>';
      renderAmministrazione();
    }

    // ── Fase 3B Pezzo 2: divisione tra i coachee ──
    function getResto() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      const elC = document.getElementById('q-comm');
      const comm = elC ? parseFloat(elC.value) : NaN;
      if (!isFinite(tot) || tot <= 0) return null;
      const c = isFinite(comm) ? comm : 0;
      return Math.max(tot - c, 0);
    }
    function coacheeInputs() { return Array.prototype.slice.call(document.querySelectorAll('.q-coachee')); }
    // Divide il resto (valore del progetto meno la quota del committente) fra i
    // partecipanti. ⚠️ Dal 15/08 scrive NEI CAMPI della finestrella, che sono la
    // verita' finche' e' aperta — non piu' in PIANI, che ormai e' solo lo stato
    // di partenza. Qui si puo' toccare il DOM: e' un clic esplicito, non una
    // digitazione, quindi non c'e' nessun cursore da far saltare.
    function dividiEqui() {
      const resto = getResto();
      if (resto === null) { alert('Scrivi prima il valore del progetto.'); return; }
      const campi = coacheeInputs();
      if (!campi.length) return;
      // Cifre INTERE (regola del 27/07) e il resto della divisione al
      // committente: 3.000 diviso 3 e' tondo, 100 diviso 3 no.
      const base = Math.floor(resto / campi.length);
      campi.forEach(function (i) { i.value = base; });
      const avanzo = resto - base * campi.length;
      const comm = document.getElementById('q-comm');
      if (avanzo && comm) comm.value = (Math.round(Number(comm.value) || 0)) + avanzo;
      // Chi non ha ancora nessuna rata riceve la proposta sulla quota nuova:
      // un pagatore con la quota e senza piano resterebbe un buco da riempire
      // a mano, ed e' proprio il lavoro che la proposta esiste per evitare.
      document.querySelectorAll('#piano-pagatori .pg-box').forEach(function (box) {
        const tb = box.querySelector('.pg-righe');
        if (tb.querySelectorAll('tr').length) return;
        const key = box.getAttribute('data-key');
        const pg = pianoDi(key);
        if (!pg) return;
        const quota = quotaDi(box);
        if (quota <= 0) return;
        tb.innerHTML = proponiRate({ tipo: pg.tipo, quota: quota })
          .map(function (t) { return rigaPianoHtml(key, t); }).join('');
        tb.querySelectorAll('tr').forEach(function (tr, i) {
          const s = tr.querySelector('.pr-inn');
          if (s) s.value = proponiRate({ tipo: pg.tipo, quota: quota })[i].innesco;
        });
      });
      ricalcolaPiano();
    }
    // La stessa proposta che fa il server, per quando la quota cambia in pagina:
    // 30/40/30 al committente, una rata anticipata al partecipante.
    function proponiRate(pg) {
      if (pg.tipo === 'partecipante') {
        return [{ id: null, etichetta: 'Quota', importo: pg.quota, innesco: 'firma', giorni: 0, stato: 'da_chiedere', data_incasso: null }];
      }
      const a = Math.round(pg.quota * 0.30), b = Math.round(pg.quota * 0.40);
      return [
        { id: null, etichetta: 'Acconto', importo: a, innesco: 'firma', giorni: 30, stato: 'da_chiedere', data_incasso: null },
        { id: null, etichetta: 'Metà percorso', importo: b, innesco: 'meta', giorni: 30, stato: 'da_chiedere', data_incasso: null },
        { id: null, etichetta: 'Saldo', importo: pg.quota - a - b, innesco: 'fine', giorni: 30, stato: 'da_chiedere', data_incasso: null },
      ];
    }
    // ⭐ UN SOLO «Salva»: quote e rate insieme. Erano due pulsanti — «Salva le
    // quote» e «Salva il piano» — e salvarne uno solo lasciava la scheda a
    // metà, con le rate che non tornavano piu' con la quota.
    async function salvaTutto() {
      const err = document.getElementById('piano-error');
      err.style.display = 'none';
      try {
        // ⚠️ Si legge dai CAMPI della finestrella, non da PIANI: è il DOM la
        // verità mentre si scrive, ed è l'unico modo di non ridisegnare gli
        // input a ogni tasto (il difetto D1). Lo fa leggiFinestrella(), che sta
        // nel modulo condiviso perche serve identica alle due pagine.
        // (⚠️ niente apici inversi qui dentro: chiudono la template literal.)
        const perKey = leggiFinestrella();
        const chiavi = Object.keys(perKey);
        const commKey = chiavi.filter(function (k) { return perKey[k].tipo === 'committente'; })[0];

        const rq = await fetch('/dashboard/progetti/'+PID+'/quota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quota_totale: document.getElementById('q-totale').value, quota_committente: commKey ? perKey[commKey].quota : '' }) });
        const dq = await rq.json();
        if (!dq.ok) { err.textContent = dq.error || 'Errore nel salvataggio del valore del progetto'; err.style.display='block'; return; }

        const quote = chiavi.filter(function (k) { return perKey[k].tipo === 'partecipante'; })
          .map(function (k) { return { part_id: perKey[k].pid, quota: perKey[k].quota }; });
        if (quote.length) {
          const rc = await fetch('/dashboard/progetti/'+PID+'/quote-coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quote }) });
          const dc = await rc.json();
          if (!dc.ok) { err.textContent = dc.error || 'Errore nel salvataggio delle quote'; err.style.display='block'; return; }
        }

        const rp = await fetch('/dashboard/progetti/'+PID+'/piano', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            piani: chiavi.map(function (k) { return { partecipazione_id: perKey[k].pid, righe: perKey[k].righe }; }),
            data_meta: document.getElementById('pi-meta').value,
            data_fine: document.getElementById('pi-fine').value }) });
        const dp = await rp.json().catch(function () { return {}; });
        if (!rp.ok) { err.textContent = dp.error || ('Errore ' + rp.status); err.style.display='block'; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; }
    }
    // Fetta B fix (2026-07-23) — salva in silenzio (best-effort) i valori dell'Amministrazione
    // già in pagina (quota totale/committente + quote dei clienti), SENZA avvisi. Serve prima
    // di una ricarica strutturale (aggiungi/togli partecipante, crea cartelle, fasi): la
    // ricarica ripesca i valori dal DB, quindi senza questo le modifiche non ancora salvate
    // col pulsante "Salva" sparirebbero (era il bug segnalato).
    async function salvaAmmSilenzioso() {
      try {
        const qt = document.getElementById('q-totale');
        if (qt) {
          const qc = document.getElementById('q-comm');
          await fetch('/dashboard/progetti/'+PID+'/quota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quota_totale: qt.value, quota_committente: qc ? qc.value : '' }) });
        }
        const quote = coacheeInputs().map(i => ({ part_id: i.getAttribute('data-part'), quota: i.value }));
        if (quote.length) {
          await fetch('/dashboard/progetti/'+PID+'/quote-coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quote }) });
        }
      } catch (e) { /* best-effort: non deve bloccare la ricarica */ }
    }
    // Ricarica la pagina conservando le modifiche non salvate dell'Amministrazione.
    function ricaricaConservando() {
      salvaAmmSilenzioso().finally(function(){ location.reload(); });
    }
    // ⛔ TOLTE il 12/08: paintPagCoachee / togglePagCoachee / renderPag /
    // togglePagComm — l'interruttore «Incassato / Da incassare» sull'intera
    // quota. Era il secondo modo, incompatibile, di dire la stessa cosa che
    // dicono le tranche («dicono cose diverse», Germano). Adesso lo stato è di
    // ogni rata: vedi segnaStato().
    // Le colonne stato_pag_committente e stato_pag_coachee restano nel
    // database e non le legge più nessuno: si tolgono con la pulizia del codice
    // morto, non di nascosto adesso.

    let addMode = 'new';
    function setAddMode(m) {
      addMode = m;
      document.getElementById('add-new').style.display      = m === 'new'      ? 'block' : 'none';
      document.getElementById('add-existing').style.display = m === 'existing' ? 'block' : 'none';
      document.getElementById('mode-new').className      = 'btn btn-sm ' + (m === 'new'      ? 'btn-primary' : 'btn-neutral');
      document.getElementById('mode-existing').className = 'btn btn-sm ' + (m === 'existing' ? 'btn-primary' : 'btn-neutral');
    }
    function openAdd() {
      ['k-nome','k-cognome','k-email'].forEach(id=>document.getElementById(id).value='');
      const sel = document.getElementById('k-existing'); if (sel) sel.value='';
      setAddMode('new');
      document.getElementById('modal-coachee').style.display='flex';
    }
    function closeAdd() { document.getElementById('modal-coachee').style.display='none'; }
    async function saveCoachee() {
      let payload;
      if (addMode === 'existing') {
        const sel = document.getElementById('k-existing');
        const clientId = sel ? sel.value : '';
        if (!clientId) { alert('Scegli un cliente dalla lista.'); return; }
        payload = { clientId };
      } else {
        const cognome = document.getElementById('k-cognome').value.trim();
        if (!cognome) { alert('Cognome obbligatorio'); return; }
        payload = { nome:document.getElementById('k-nome').value, cognome, email:document.getElementById('k-email').value };
      }
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) ricaricaConservando(); else alert(d.error || 'Errore');
    }
    async function removeCoachee(partId) {
      if (!confirm('Togliere questo cliente dal progetto? Se non ha ancora dati, viene eliminato anche dall\\'anagrafica.')) return;
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee/'+partId, { method:'DELETE' });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      if (d.kept && d.message) alert(d.message);
      ricaricaConservando();
    }
    // ── Fase 3a: le tappe del progetto (aggiunte a mano da una tendina) ──
    const FASE_LABELS = ${JSON.stringify(FASE_LABELS)};
    const FASE_ORDER  = ${JSON.stringify(FASE_ORDER)};
    function toggleFaseMenu() {
      const m = document.getElementById('fase-menu');
      m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
    }
    document.addEventListener('click', function(e) {
      const m = document.getElementById('fase-menu');
      if (!m || m.style.display !== 'block') return;
      if (!m.contains(e.target) && !(e.target.getAttribute && e.target.getAttribute('onclick') === 'toggleFaseMenu()')) m.style.display = 'none';
    });
    function toggleDettaglio(btn) {
      const b = btn.closest('.fase-block');
      const d = b.querySelector('.fase-dettaglio');
      const open = d.style.display !== 'none';
      d.style.display = open ? 'none' : 'block';
      btn.textContent = open ? 'Dettaglio ▾' : 'Dettaglio ▴';
    }
    async function salvaFase(btn) {
      const b = btn.closest('.fase-block');
      const contenuto = {};
      let obiettivo, parametri;
      b.querySelectorAll('.f-voce').forEach(function(el) {
        const proj = el.dataset.proj || '';
        if (proj === 'obiettivo_smarter') obiettivo = el.value;
        else if (proj === 'parametri') parametri = el.value;
        else contenuto[el.dataset.key] = el.value;
      });
      const payload = {
        tipo: b.dataset.tipo,
        fid: b.dataset.fid || '',
        data: b.querySelector('.f-data').value || null,
        fatta: b.querySelector('.f-fatta').checked,
        contenuto: contenuto
      };
      if (obiettivo !== undefined) payload.obiettivo = obiettivo;
      if (parametri !== undefined) payload.parametri = parametri;
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      if (d.id) b.dataset.fid = d.id;
      showToast('Fase salvata');
    }
    async function approvaFase(btn) {
      const b = btn.closest('.fase-block');
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ fid:b.dataset.fid, tipo:b.dataset.tipo, approva:true }) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      ricaricaConservando();
    }
    async function addFase(tipo) {
      document.getElementById('fase-menu').style.display = 'none';
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ tipo }) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      ricaricaConservando();
    }
    async function scanProgetto() {
      const btn = document.getElementById('scan-fasi-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/scan-drive', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : '. Controlla che il file inizi con "Report" e sia nella sottocartella di fase giusta.'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto: apri il Dettaglio e approva.');
        ricaricaConservando();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }
    async function delFase(btn) {
      const b = btn.closest('.fase-block');
      const fid = b.dataset.fid;
      if (fid && !confirm('Rimuovere questa tappa?')) return;
      if (fid) {
        const r = await fetch('/dashboard/progetti/'+PID+'/fasi/'+fid, { method:'DELETE' });
        const d = await r.json();
        if (!d.ok) { alert(d.error || 'Errore'); return; }
      }
      b.remove();
      const list = document.getElementById('fasi-list');
      if (!list.querySelector('.fase-block')) document.getElementById('fasi-empty').style.display = 'block';
    }
    function showToast(msg) {
      const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2000);
    }
    function copyLink(url) {
      navigator.clipboard.writeText(url).then(() => showToast('Link copiato!'));
    }
    document.getElementById('modal-coachee').addEventListener('click', e => { if (e.target === document.getElementById('modal-coachee')) closeAdd(); });
    ${/* ⚠️ ORDINE DI AVVIO — la finestrella PRIMA della tabella. È lei a creare
          i campi delle quote (q-comm, .q-coachee), che recalcQuota() legge alla
          fine di disegnaPiano(). Invertendo, la tabella nascerebbe vuota e senza
          nessun messaggio: è il guasto muto del 12/08, quello che sembra
          «non ci sono dati». */ ''}
    costruisciFinestrella();
    disegnaPiano();
    ['pi-meta', 'pi-fine'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', disegnaPiano);
    });
    // Cliccare fuori chiude, come le altre finestrelle della pagina.
    ['modal-piano', 'modal-incasso'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m) m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
    });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// RENDER DATI STRUMENTI (sola lettura)
// ═══════════════════════════════════════════════════════

// Anteprima delle tre MATRICI. Un disegno solo: cambiano le etichette (cfg) e,
// per Covey, la percentuale di tempo su ogni voce più il subtotale del quadrante.
function renderMatrice(d, cfg) {
  const pesi = (cfg.pesi && d.pesi) ? d.pesi : null;
  const chip = (testo, p) => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(testo)}${p ? ` <strong style="color:#223B6E">${p}%</strong>` : ''}</span>`;
  let totale = 0;
  const blocks = cfg.quads.map(qd => {
    const voci = (d[qd.key] || []).filter(c => c && c.text);
    const sub = pesi ? voci.reduce((s, c) => s + (Number(pesi[c.id]) || 0), 0) : null;
    if (sub) totale += sub;
    return `<div style="margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:#6B7280;display:inline-flex;align-items:center">
        <span style="display:inline-block;min-width:18px;height:16px;line-height:16px;text-align:center;padding:0 4px;border-radius:8px;background:#223B6E;color:#fff;font-size:10px;font-weight:700;margin-right:6px">${qd.r}</span>${esc(qd.q)}${sub != null ? ` <span style="color:#9AA0AA;font-weight:600;margin-left:6px">${sub}% del tempo</span>` : ''}</span><br>
      ${voci.length ? voci.map(c => chip(c.text, pesi ? (Number(pesi[c.id]) || 0) : null)).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}
    </div>`;
  }).join('');
  const testa = d.decisione
    ? `<div style="margin-bottom:10px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">${esc(cfg.campo)}</span><br><span style="font-size:14px;font-weight:700;color:#223B6E">${esc(d.decisione)}</span></div>`
    : '';
  const coda = (pesi && totale)
    ? `<div style="font-size:11px;color:#9AA0AA;margin-top:6px">Tempo distribuito: <strong style="color:${totale === 100 ? '#4F8B73' : '#9AA0AA'}">${totale}%</strong></div>`
    : '';
  return `${testa}${blocks}${coda}`;
}

function renderSessionData(tool, jsonStr) {
  let d;
  try { d = JSON.parse(jsonStr); } catch(e) { return '<em style="color:#aaa">Dati non leggibili</em>'; }

  switch(tool) {
    case 'valori': {
      const top5 = (d.top5 || []).filter(Boolean);
      const zone = (d.zone || []).map(z => z.value).filter(Boolean);
      const altri = zone.filter(v => !top5.includes(v));
      return `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Top 5</span><br>
        ${top5.length ? top5.map((v,i) => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#1A5280;color:#fff;font-size:12px;font-weight:600">${i+1}. ${esc(v)}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}</div>
        ${altri.length ? `<div><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Altri valori selezionati</span><br>${altri.map(v => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(v)}</span>`).join('')}</div>` : ''}`;
    }
    case 'abilita': {
      const abilita = (d.zone || []).map(z => z.value).filter(Boolean);
      return `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Abilità selezionate</span><br>
        ${abilita.length ? abilita.map(v => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(v)}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}`;
    }
    // Le due ruote nuove salvano esattamente come la Ruota della Vita
    // ({areas:[{name,value}]}): stesso disegno, nessuna riga in più.
    case 'ruotavita':
    case 'ruota-leadership':
    case 'ruota-management': {
      const aree = (d.areas || []).filter(a => a.value !== null && a.value !== undefined);
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${aree.map(a => {
          const pct = Math.round((a.value / 10) * 100);
          const col = a.value >= 7 ? '#4F8B73' : a.value >= 4 ? '#D8AE2E' : '#C0392B';
          return `<div style="background:#f8f9fb;border-radius:8px;padding:8px 10px">
            <div style="font-size:11px;font-weight:700;color:#6B7280;margin-bottom:4px">${esc(a.name)}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:#e6e9ee;border-radius:3px"><div style="width:${pct}%;height:100%;background:${col};border-radius:3px"></div></div>
              <span style="font-size:13px;font-weight:800;color:${col}">${a.value}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }
    case 'lineavita': {
      const eventi = (d.events || []).slice().sort((a,b) => a.year - b.year);
      return eventi.length ? `<div style="display:flex;flex-direction:column;gap:6px">
        ${eventi.map(e => `<div style="display:flex;gap:10px;align-items:baseline">
          <span style="font-size:12px;font-weight:800;color:#1A5280;min-width:38px">${e.year}</span>
          <span style="font-size:11px;color:${e.type==='negative'?'#C0392B':'#4F8B73'}">${e.type==='negative'?'↓':'↑'}</span>
          <span style="font-size:12px;color:#2C3E50">${esc(e.desc)}</span>
        </div>`).join('')}
      </div>` : '<span style="color:#aaa;font-size:12px">Nessun evento</span>';
    }
    case 'brainstorming': {
      const esplorate = (d.exploreCards || []).map(c => c.text).filter(Boolean);
      const selezionate = (d.selectCards || []).map(c => c.text).filter(Boolean);
      return `${esplorate.length ? `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Idee esplorate</span><br>${esplorate.map(t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(t)}</span>`).join('')}</div>` : ''}
        ${selezionate.length ? `<div><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Idee selezionate</span><br>${selezionate.map(t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#1A5280;color:#fff;font-size:12px">${esc(t)}</span>`).join('')}</div>` : ''}
        ${!esplorate.length && !selezionate.length ? '<span style="color:#aaa;font-size:12px">—</span>' : ''}`;
    }
    case 'genogramma': {
      const persone = (d.persons || []).filter(p => p.name);
      return `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Persone</span><br>
        ${persone.length ? persone.map(p => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(p.name)}${p.role ? ` <em style="color:#9AA0AA">${esc(p.role)}</em>` : ''}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}`;
    }
    // Le tre MATRICI (Logica Cartesiana, SWOT, Covey/Eisenhower) sono lo stesso
    // strumento con parole diverse: un campo in cima + quattro elenchi di voci
    // {id,text}. Cambiano solo le etichette. Covey ha in più la percentuale di
    // tempo per singola voce (la sua Fase 2): quella si mostra, ed è il motivo per
    // cui lo strumento esiste (deciso da Germano 28/07).
    case 'logica-cartesiana':
      return renderMatrice(d, { campo: 'Decisione', quads: [
        { r:'I',   key:'accade_faccio',       q:'Cosa accade se lo faccio?' },
        { r:'II',  key:'accade_nonfaccio',    q:'Cosa accade se non lo faccio?' },
        { r:'III', key:'nonaccade_faccio',    q:'Cosa non accade se lo faccio?' },
        { r:'IV',  key:'nonaccade_nonfaccio', q:'Cosa non accade se non lo faccio?' },
      ] });
    case 'swot':
      return renderMatrice(d, { campo: 'Attività analizzata', quads: [
        { r:'I',   key:'forze',       q:'Forze · interni, positivi' },
        { r:'II',  key:'debolezze',   q:'Debolezze · interni, negativi' },
        { r:'III', key:'opportunita', q:'Opportunità · esterni, positivi' },
        { r:'IV',  key:'minacce',     q:'Minacce · esterni, negativi' },
      ] });
    case 'covey-eisenhower':
      // NIENTE nomi dei quadranti (Crisi/Qualità/Delega/Sprechi): Germano li ha
      // fatti togliere dallo strumento perché giudicanti. Restano gli assi.
      return renderMatrice(d, { campo: 'Ambito osservato', pesi: true, quads: [
        { r:'I',   key:'crisi',    q:'Urgente · importante' },
        { r:'II',  key:'qualita',  q:'Non urgente · importante' },
        { r:'III', key:'delega',   q:'Urgente · non importante' },
        { r:'IV',  key:'sprechi',  q:'Non urgente · non importante' },
      ] });
    default:
      // Le quattro anteprime mancanti (ruote leadership/management, SWOT,
      // Covey/Eisenhower) sono una fetta a sé: qui si dichiara, non si finge.
      return '<span style="color:#aaa;font-size:12px">Anteprima in arrivo per questo strumento. Intanto la scheda si legge dagli strumenti del cliente.</span>';
  }
}

// ═══════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════

// Data e ora all'italiana (12/06/2026 10:40). Prima usciva in formato tecnico
// (2026-06-12 10:40), l'unico posto in tutto l'Hub che non parlava italiano.
function fmtDate(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString() : String(d);
  const giorno = itDate(s);
  const ora = s.slice(11, 16);
  return ora ? `${giorno} ${ora}` : giorno;
}

// Data 'AAAA-MM-GG' → 'GG/MM/AAAA' (formato italiano per la visualizzazione).
// Oggi in ORA ITALIANA, come 'AAAA-MM-GG'. ⚠️ Non si usa toISOString(): quella
// dà l'ora di Greenwich e fino alle 2 di notte scriverebbe il giorno prima.
function oggiIso() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
}

// Una sessione FISSATA ma non ancora avvenuta. Sta in tabella come bozza — così non
// conta né ore né sessioni, come tutte le bozze — ma non è una proposta da approvare:
// è un appuntamento preso, ed è la riga da cui nasce il Documento di chiusura.
// Si riconosce dalla data: nel futuro = deve ancora succedere.
function isProgrammata(s) {
  return s && s.stato === 'bozza' && !!s.data && String(s.data).slice(0, 10) > oggiIso();
}

function itDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

// Momento preciso (data + ora) in ORA ITALIANA: '11/08/2026 alle 10:30'.
// Serve per le scadenze dei permessi, dove l'ora conta davvero. Non si può usare
// fmtDate: quella taglia la stringa ISO, cioè mostra l'ora di Greenwich, e d'estate
// scriverebbe due ore in meno di quella che il coach e il cliente hanno all'orologio.
function itDateTime(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(dt).replace(', ', ' alle ');
}

// Data ISO (2026-07-11) → nome cartella Drive italiano con trattini (11-07-2026).
// Trattini e non "/" perché lo slash non è ammesso nei nomi di cartella su Drive.
function itFolderDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// '2026-01' → 'gennaio 2026'. Il giorno 15 e il fuso di Roma evitano che il mese
// scivoli a quello prima passando per l'ora di Greenwich.
function meseEsteso(aaaaMm) {
  const m = String(aaaaMm || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(aaaaMm || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long', year: 'numeric' }).format(d);
}

// Il prezzo di un percorso da solo è ambiguo: 900 € può essere il costo di una sessione
// o il totale di un pacchetto. Qui si scrive sempre accanto cosa significa, così la
// cifra che finirà nel contratto si legge senza doverla interpretare.
function prezzoPercorso(p) {
  if (!p.prezzo) return '<span style="color:#aaa">—</span>';
  const cifra = `€ ${fiscale.euro(p.prezzo)}`;
  if (p.modalita === 'Pacchetto') {
    const n = Number(p.n_sessioni_previste) || 0;
    return `${cifra}<br><span style="font-size:11px;color:#aaa">pacchetto${n ? ` di ${n} sessioni` : ''}</span>`;
  }
  return `${cifra}<br><span style="font-size:11px;color:#aaa">a sessione</span>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Per valori dentro attributi HTML e stringhe JS inline (apici singoli/doppi).
function attr(str) {
  return esc(str).replace(/&#39;/g, '&#39;');
}

// Ore con al più un decimale, senza ".0" inutile: 25 → "25", 1.5 → "1,5" (virgola IT).
function fmtOre(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',');
}

// ── Estratto ICF: tabella percorsi + riepilogo, con download CSV. ──
// Pagina dei risultati di ricerca (fase 1c). Sola lettura: ogni risultato è un
// link alla sua scheda, nessun pulsante che agisca.
// NIENTE <script> qui dentro, di proposito: senza JS inline non c'è il rischio
// degli apostrofi dentro il template literal, e la pagina non ha nulla da fare
// nel browser. Committenti e Lead non hanno una scheda propria nell'Hub: il
// risultato mostra i loro dati sul posto e porta al rispettivo elenco.
function cercaPage(q, ris, req) {
  // il conteggio dice anche quando la lista è tagliata: un "30" muto farebbe
  // credere che siano tutti (il limite delle query è 30 per gruppo)
  const testa = (t, n) => `<div style="display:flex;align-items:baseline;gap:8px;margin:22px 0 8px">
      <h2 style="margin:0">${t}</h2><span style="font-size:12px;color:#aaa">${n >= 30 ? 'primi 30 — restringi la ricerca' : n}</span></div>`;
  const riga = (titolo, href, sotto, badge) => `<div class="ce-riga">
      <div style="min-width:0">
        ${href ? `<a href="${href}" class="ce-nome">${titolo}</a>` : `<span class="ce-nome">${titolo}</span>`}
        ${sotto ? `<div class="ce-sotto">${sotto}</div>` : ''}
      </div>
      ${badge || ''}
    </div>`;
  const pezzi = (...v) => v.filter(Boolean).join(' · ');
  // nome e cognome di una persona si uniscono con uno SPAZIO, non col puntino
  // che separa le informazioni: altrimenti si legge "Marco · Bianchi"
  const nomeCognome = (n, c) => [n, c].filter(Boolean).join(' ');

  let corpo;
  if (!q) {
    corpo = `<div class="card"><p style="color:var(--muted);font-size:13.5px;margin:0">
      Scrivi un nome nella casella qui sopra e premi Invio. Si cercano <strong>clienti</strong>, <strong>committenti</strong>, <strong>progetti</strong> e <strong>lead</strong>.</p></div>`;
  } else if (ris && ris.errore) {
    corpo = `<div class="card"><p style="color:#c0392b;font-size:13.5px;margin:0">La ricerca non è riuscita. Riprova fra un momento.</p></div>`;
  } else {
    const { clienti, committenti, progetti, leads } = ris;
    const totale = clienti.length + committenti.length + progetti.length + leads.length;
    if (!totale) {
      corpo = `<div class="card"><p style="color:var(--muted);font-size:13.5px;margin:0">
        Nessun risultato per <strong>${esc(q)}</strong>.<br>
        <span style="font-size:12.5px">Si cercano i nomi di clienti, committenti, progetti e lead — non il contenuto di sessioni, report o note.</span></p></div>`;
    } else {
      corpo = `
      ${clienti.length ? testa('Clienti', clienti.length) + `<div class="card ce-card">${clienti.map(c => riga(
        esc(c.name || nomeCognome(c.nome, c.cognome) || '—'),
        `/dashboard/clients/${c.id}`,
        pezzi(c.area ? esc(c.area) : '', c.societa ? esc(c.societa) : '', c.email ? esc(c.email) : ''),
        c.stato_cliente ? `<span class="badge">${esc(c.stato_cliente)}</span>` : ''
      )).join('')}</div>` : ''}

      ${committenti.length ? testa('Committenti', committenti.length) + `<div class="card ce-card">${committenti.map(k => riga(
        esc(k.denominazione),
        null,
        pezzi(k.referente ? esc(k.referente) + (k.ruolo ? ' — ' + esc(k.ruolo) : '') : '', k.email ? esc(k.email) : '', k.telefono ? esc(k.telefono) : ''),
        `<a href="/dashboard/committenti" class="ce-vai">Elenco Committenti ↗</a>`
      )).join('')}</div>` : ''}

      ${progetti.length ? testa('Progetti Strutturati', progetti.length) + `<div class="card ce-card">${progetti.map(p => riga(
        esc(p.titolo),
        `/dashboard/progetti/${p.id}`,
        pezzi(esc(p.denominazione), p.area ? esc(p.area) : ''),
        p.stato ? `<span class="badge">${esc(p.stato)}</span>` : ''
      )).join('')}</div>` : ''}

      ${leads.length ? testa('Lead', leads.length) + `<div class="card ce-card">${leads.map(l => riga(
        esc(nomeCognome(l.nome, l.cognome) || '—'),
        null,
        pezzi(l.email ? esc(l.email) : '', l.telefono ? esc(l.telefono) : ''),
        `<a href="/dashboard/leads" class="ce-vai">Elenco Lead ↗</a>`
      )).join('')}</div>` : ''}`;
    }
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Ricerca</title>${baseStyle()}
  <style>
    .ce-card { padding: 4px 0; }
    .ce-riga { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 20px; border-bottom: 1px solid #f1f3f6; }
    .ce-riga:last-child { border-bottom: none; }
    .ce-nome { font-size: 14px; font-weight: 700; color: var(--ink); text-decoration: none; }
    a.ce-nome:hover { color: var(--blue); text-decoration: underline; }
    .ce-sotto { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .ce-vai { font-size: 12px; color: var(--muted); text-decoration: none; white-space: nowrap; }
    .ce-vai:hover { color: var(--blue); }
  </style></head><body>
  ${headerNoesys({ q })}
  <div class="container">
    <h1>Ricerca</h1>
    ${q ? `<p style="color:#aaa;font-size:13px">Risultati per <strong style="color:var(--ink)">${esc(q)}</strong></p>` : ''}
    ${corpo}
  </div>
  </body></html>`;
}

function icfPage(rows, tot, clientiUnici, req) {
  const body = rows.length === 0
    ? `<tr><td colspan="9" class="empty">Nessun percorso registrato. I percorsi si aggiungono dalla scheda cliente.</td></tr>`
    : rows.map(r => `<tr>
        <td><strong>${esc(r.client_name)}</strong></td>
        <td style="font-size:12px;color:#aaa">${esc(r.email || r.telefono || '—')}</td>
        <td style="font-size:12px">${esc(r.tipo || 'Individuale')}</td>
        <td style="font-size:12px">${esc(r.modalita || 'Standard')}</td>
        <td style="font-size:12px">${r.data_inizio ? itDate(r.data_inizio) : '<span style="color:#ccc">—</span>'}</td>
        <td style="font-size:12px">${r.data_fine ? itDate(r.data_fine) : '<span style="color:#ccc">in corso</span>'}</td>
        <td style="text-align:right">${fmtOre(r.pagate)}</td>
        <td style="text-align:right;color:#7a5c00">${r.proBono ? fmtOre(r.proBono) : '<span style="color:#ccc">—</span>'}</td>
        <td style="text-align:right"><strong>${fmtOre(r.ore)}</strong></td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Estratto ICF</title>${baseStyle()}</head><body>
  ${headerNoesys({ briciole: [{ label: 'Estratto ICF' }] })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:12px">
      <div><h1>Estratto ICF</h1><p style="color:#aaa;font-size:13px">Log ore di coaching per la certificazione</p></div>
      <a href="/dashboard/icf/export.csv" class="btn btn-gold">⬇ Scarica CSV (Excel)</a>
    </div>
    <p style="color:var(--muted);font-size:12px;margin-bottom:18px;line-height:1.5">
      Le ore contano come <strong>pagate</strong> salvo la modalità <strong>Pro bono</strong>. Lo <em>Scambio servizi</em> vale come pagato ai fini ICF.
      Le ore si aggiornano dalla scheda di ogni cliente (campo “ore svolte” del percorso).
    </p>

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr>
          <th>Cliente</th><th>Contatto</th><th>Tipo</th><th>Modalità</th>
          <th>Inizio</th><th>Fine</th>
          <th style="text-align:right">Pagate</th><th style="text-align:right">Pro bono</th><th style="text-align:right">Totale</th>
        </tr></thead>
        <tbody>${body}</tbody>
        ${rows.length ? `<tfoot><tr style="background:#f7f9fb;font-weight:700">
          <td colspan="6" style="border-top:2px solid var(--line)">Totale</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.pagate)}</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.proBono)}</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.ore)}</td>
        </tr></tfoot>` : ''}
      </table>
    </div>

    ${rows.length ? `<div class="card" style="display:flex;gap:26px;flex-wrap:wrap">
      <div><div class="field-label">Clienti</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${clientiUnici}</div></div>
      <div><div class="field-label">Percorsi</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${rows.length}</div></div>
      <div><div class="field-label">Ore totali</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${fmtOre(tot.ore)}</div></div>
      <div><div class="field-label">Individuali</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--green)">${fmtOre(tot.indivOre)}<span style="font-size:13px;color:#aaa"> · ${tot.indivN}</span></div></div>
      <div><div class="field-label">Gruppo</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--green)">${fmtOre(tot.gruppoOre)}<span style="font-size:13px;color:#aaa"> · ${tot.gruppoN}</span></div></div>
      <div><div class="field-label">Pagate / Pro bono</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${fmtOre(tot.pagate)}<span style="font-size:15px;color:#aaa"> / ${fmtOre(tot.proBono)}</span></div></div>
    </div>` : ''}
  </div>
  </body></html>`;
}
