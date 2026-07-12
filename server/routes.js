const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('./db');
const { signToken, requireCoach, COOKIE_NAME } = require('./auth');
const { logoCompact } = require('./logo');
const drive = require('./google-drive');
const scan = require('./scan');

const router = express.Router();

// URL della piattaforma strumenti (app separata). Il link di accesso del cliente
// porta agli STRUMENTI, non all'Hub: qui gestiamo solo il CRM.
const PLATFORM_URL = process.env.PLATFORM_URL || 'https://coaching-tools-production.up.railway.app';

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

router.get('/dashboard', requireCoach, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT s.tool) FROM sessions s WHERE s.client_id = c.id) AS tool_count,
        pp.tipo AS p_tipo, pp.n_sessioni_fatte AS p_sess, pp.ore_fatte AS p_ore, pp.stato AS p_stato
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT p.tipo, p.n_sessioni_fatte, p.ore_fatte, p.stato
        FROM percorsi p WHERE p.client_id = c.id
        ORDER BY (p.stato = 'attivo') DESC, p.created_at DESC LIMIT 1
      ) pp ON true
      ORDER BY c.created_at DESC
    `);
    res.send(dashboardPage(result.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento dashboard');
  }
});

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
    if (!client) return res.redirect('/dashboard');
    const [sr, pr, payr, sedr] = await Promise.all([
      db.query('SELECT * FROM sessions WHERE client_id=$1 ORDER BY tool, created_at DESC', [req.params.id]),
      db.query('SELECT * FROM percorsi WHERE client_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM payments WHERE client_id=$1 ORDER BY created_at DESC', [req.params.id]),
      db.query('SELECT * FROM sedute WHERE client_id=$1 ORDER BY data ASC NULLS LAST, created_at ASC', [req.params.id]),
    ]);
    res.send(clientDetailPage(client, sr.rows, pr.rows, payr.rows, sedr.rows, req));
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
        consenso_privacy=$20,
        consenso_data = CASE WHEN $20 AND consenso_data IS NULL THEN CURRENT_DATE
                             WHEN $20 THEN consenso_data ELSE NULL END
       WHERE id=$21`,
      [name, (b.email||'').trim(), (b.telefono||'').trim(), (b.altro_recapito||'').trim(),
       (b.social_tipo||'').trim(), (b.via||'').trim(), (b.cap||'').trim(), (b.citta||'').trim(),
       (b.provincia||'').trim(), b.data_nascita||null, (b.professione||'').trim(),
       b.area||'Personal', b.fonte||'altro', (b.obiettivo||'').trim(), b.stato_cliente||'attivo',
       (b.prossima_azione||'').trim(), b.prossima_azione_data||null, (b.drive_url||'').trim(),
       (b.note_preliminari||'').trim(), consenso, req.params.id, nome, cognome, (b.societa||'').trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore salvataggio' });
  }
});

router.post('/dashboard/clients/:id/toggle', requireCoach, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: 'Cliente non trovato' });
    await db.query('UPDATE clients SET active = $1 WHERE id = $2', [!client.active, client.id]);
    res.json({ active: !client.active });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
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

router.post('/dashboard/clients/:id/percorsi', requireCoach, express.json(), async (req, res) => {
  const { tipo, n_sessioni_previste, n_sessioni_fatte, prezzo, promo, sconto_note,
          data_inizio, data_fine, modalita, ore_fatte, stato } = req.body;
  try {
    const pid = uuidv4();
    await db.query(
      `INSERT INTO percorsi (id,client_id,tipo,n_sessioni_previste,n_sessioni_fatte,prezzo,promo,sconto_note,data_inizio,data_fine,modalita,ore_fatte,stato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [pid, req.params.id, tipo||'Individuale', n_sessioni_previste||8, n_sessioni_fatte||0,
       prezzo||null, promo||false, sconto_note||'', data_inizio||null, data_fine||null,
       modalita||'Standard', ore_fatte||0, stato||'attivo']
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
    res.json({ ok: true, id: pid, driveWarning });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/clients/:id/percorsi/:pid/sessione', requireCoach, express.json(), async (req, res) => {
  try {
    await db.query(
      'UPDATE percorsi SET n_sessioni_fatte = GREATEST(0, n_sessioni_fatte + $1) WHERE id=$2',
      [req.body.delta || 1, req.params.pid]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/clients/:id/percorsi/:pid/chiudi', requireCoach, async (req, res) => {
  try {
    await db.query("UPDATE percorsi SET stato='concluso', data_fine=COALESCE(data_fine, CURRENT_DATE) WHERE id=$1", [req.params.pid]);
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

router.post('/dashboard/clients/:id/percorsi/:pid/ore', requireCoach, express.json(), async (req, res) => {
  const ore = parseFloat(req.body.ore_fatte);
  if (isNaN(ore) || ore < 0) return res.status(400).json({ error: 'Ore non valide' });
  try {
    await db.query('UPDATE percorsi SET ore_fatte=$1 WHERE id=$2 AND client_id=$3',
      [ore, req.params.pid, req.params.id]);
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
  await db.query(
    `UPDATE percorsi SET
       n_sessioni_fatte = (SELECT COUNT(*)             FROM sedute WHERE percorso_id = $1 AND stato <> 'bozza'),
       ore_fatte        = (SELECT COALESCE(SUM(ore),0) FROM sedute WHERE percorso_id = $1 AND stato <> 'bozza')
     WHERE id = $1`, [pid]);
}

function sedutaFields(b) {
  b = b || {};
  const val = k => { const v = b[k]; return (v == null || String(v).trim() === '') ? null : String(v).trim(); };
  return {
    obiettivo: val('obiettivo'), argomenti: val('argomenti'), attivita: val('attivita'),
    scadenza: val('scadenza'), eseguita: val('eseguita'), note: val('note'),
  };
}

// Crea una seduta (riga della Scheda Cliente)
router.post('/dashboard/clients/:id/percorsi/:pid/sedute', requireCoach, express.json(), async (req, res) => {
  try {
    const t = normTipo(req.body.tipo);
    const f = sedutaFields(req.body);
    const sid = uuidv4();
    await db.query(
      `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, obiettivo, argomenti, attivita, scadenza, eseguita, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [sid, req.params.pid, req.params.id, t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.eseguita, f.note]
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
      `UPDATE sedute SET tipo=$1, data=$2, ore=$3, obiettivo=$4, argomenti=$5, attivita=$6, scadenza=$7, eseguita=$8, note=$9
       WHERE id=$10 AND percorso_id=$11`,
      [t, req.body.data || null, oreForTipo(t, req.body.ore),
       f.obiettivo, f.argomenti, f.attivita, f.scadenza, f.eseguita, f.note, req.params.sid, req.params.pid]
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
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Errore' }); }
});

// Lancio MANUALE dell'automazione report→scheda (oltre al controllo automatico ogni
// 8h). Coach-only: legge i report nuovi da Drive e crea le bozze. client_id opzionale.
router.post('/dashboard/scan-drive', requireCoach, express.json(), async (req, res) => {
  try {
    const out = await scan.scanClientReports({ onlyClientId: (req.body && req.body.client_id) || undefined });
    res.json({ ok: true, ...out });
  } catch (err) { console.error('[scan-drive]', err); res.status(500).json({ error: err.message }); }
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
async function loadIcf() {
  const result = await db.query(`
    SELECT p.*, c.name AS client_name, c.email, c.telefono
    FROM percorsi p
    JOIN clients c ON c.id = p.client_id
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
    const result = await db.query('SELECT * FROM committenti ORDER BY denominazione');
    res.send(committentiPage(result.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

router.post('/dashboard/committenti', requireCoach, express.json(), async (req, res) => {
  const { tipo, denominazione, referente, ruolo, email, telefono,
          codice_fiscale, partita_iva, indirizzo, pec_sdi, note } = req.body;
  if (!denominazione || !denominazione.trim()) return res.status(400).json({ error: 'Denominazione obbligatoria' });
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO committenti (id,tipo,denominazione,referente,ruolo,email,telefono,
         codice_fiscale,partita_iva,indirizzo,pec_sdi,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, TIPI_COMMITTENTE.includes(tipo) ? tipo : 'azienda', denominazione.trim(),
       (referente||'').trim(), (ruolo||'').trim(), (email||'').trim(), (telefono||'').trim(),
       (codice_fiscale||'').trim(), (partita_iva||'').trim(), (indirizzo||'').trim(),
       (pec_sdi||'').trim(), (note||'').trim()]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/committenti/:id', requireCoach, express.json(), async (req, res) => {
  const { tipo, denominazione, referente, ruolo, email, telefono,
          codice_fiscale, partita_iva, indirizzo, pec_sdi, note } = req.body;
  if (!denominazione || !denominazione.trim()) return res.status(400).json({ error: 'Denominazione obbligatoria' });
  try {
    await db.query(
      `UPDATE committenti SET tipo=$1,denominazione=$2,referente=$3,ruolo=$4,email=$5,telefono=$6,
         codice_fiscale=$7,partita_iva=$8,indirizzo=$9,pec_sdi=$10,note=$11,updated_at=NOW()
       WHERE id=$12`,
      [TIPI_COMMITTENTE.includes(tipo) ? tipo : 'azienda', denominazione.trim(),
       (referente||'').trim(), (ruolo||'').trim(), (email||'').trim(), (telefono||'').trim(),
       (codice_fiscale||'').trim(), (partita_iva||'').trim(), (indirizzo||'').trim(),
       (pec_sdi||'').trim(), (note||'').trim(), req.params.id]
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
// PROGETTI (Fase 2) — il percorso commissionato da un committente.
// In Business / Young-con-sponsor il progetto È il lead (nasce in pre-intake).
// I coachee si agganciano in Fase 3 (con le quote).
// ═══════════════════════════════════════════════════════

const AREE_PROGETTO  = ['Business', 'Young'];
const TIPI_PROGETTO  = ['individuale', 'team', 'group'];
const STATI_PROGETTO = ['pre-intake', 'proposta', 'attivo', 'chiuso', 'perso'];

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
  const { committente_id, titolo, area, tipo, stato, obiettivi, note, data_inizio } = req.body;
  if (!committente_id) return res.status(400).json({ error: 'Committente obbligatorio' });
  if (!titolo || !titolo.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
  try {
    const c = await db.query('SELECT 1 FROM committenti WHERE id=$1', [committente_id]);
    if (!c.rows.length) return res.status(400).json({ error: 'Committente non valido' });
    const id = uuidv4();
    await db.query(
      `INSERT INTO progetti (id,committente_id,titolo,area,tipo,stato,obiettivi,note,data_inizio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, committente_id, titolo.trim(),
       AREE_PROGETTO.includes(area) ? area : 'Business',
       TIPI_PROGETTO.includes(tipo) ? tipo : 'individuale',
       STATI_PROGETTO.includes(stato) ? stato : 'pre-intake',
       (obiettivi||'').trim(), (note||'').trim(), data_inizio||null]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore' });
  }
});

router.post('/dashboard/progetti/:id', requireCoach, express.json(), async (req, res) => {
  const { committente_id, titolo, area, tipo, stato, obiettivi, note, data_inizio } = req.body;
  if (!committente_id) return res.status(400).json({ error: 'Committente obbligatorio' });
  if (!titolo || !titolo.trim()) return res.status(400).json({ error: 'Titolo obbligatorio' });
  try {
    await db.query(
      `UPDATE progetti SET committente_id=$1,titolo=$2,area=$3,tipo=$4,stato=$5,
         obiettivi=$6,note=$7,data_inizio=$8,updated_at=NOW() WHERE id=$9`,
      [committente_id, titolo.trim(),
       AREE_PROGETTO.includes(area) ? area : 'Business',
       TIPI_PROGETTO.includes(tipo) ? tipo : 'individuale',
       STATI_PROGETTO.includes(stato) ? stato : 'pre-intake',
       (obiettivi||'').trim(), (note||'').trim(), data_inizio||null, req.params.id]
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
      SELECT pa.id AS part_id, cl.id AS client_id, cl.name, cl.email, cl.token
      FROM partecipazioni pa JOIN clients cl ON cl.id = pa.client_id
      WHERE pa.progetto_id=$1 ORDER BY cl.cognome NULLS LAST, cl.nome`, [req.params.id]);
    res.send(progettoDettaglioPage(pr.rows[0], coachee.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore');
  }
});

// Aggiunge un coachee al progetto CREANDO la persona nuova (client + partecipazione).
// La scelta di un cliente esistente è rara: non la implementiamo (scelta di Germano).
// NB: qui NON creiamo cartelle Drive (dove va la cartella nei progetti è deciso dopo):
// il coachee nasce col suo token/link piattaforma, drive_url resta vuoto.
router.post('/dashboard/progetti/:id/coachee', requireCoach, express.json(), async (req, res) => {
  const cognome = (req.body.cognome || '').trim();
  const nome    = (req.body.nome || '').trim();
  const email   = (req.body.email || '').trim();
  if (!cognome) return res.status(400).json({ error: 'Cognome obbligatorio' });
  try {
    const pr = await db.query('SELECT area FROM progetti WHERE id=$1', [req.params.id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Progetto non trovato' });
    const area = pr.rows[0].area || 'Business';
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
        --bg:#F4F6F8; --card:#FFFFFF; --line:#E6E9EE;
        --grad:linear-gradient(90deg,#D8AE2E,#B7B342,#4F8B73,#1A5280);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Manrope', system-ui, -apple-system, sans-serif; background: var(--bg); min-height: 100vh; color: var(--ink); -webkit-font-smoothing: antialiased; }
      .container { max-width: 900px; margin: 0 auto; padding: 28px 18px; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 1px 3px rgba(16,33,60,0.04); padding: 22px; margin-bottom: 16px; }
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
      .appbar { position: sticky; top: 0; z-index: 50; background: #fff; border-bottom: 1px solid var(--line); }
      .appbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 14px; max-width: 980px; margin: 0 auto; padding: 8px 18px; }
      .appbar-brand { display: flex; align-items: center; text-decoration: none; line-height: 0; }
      .appbar-actions { display: flex; align-items: center; gap: 10px; }
      .appbar-accent { height: 3px; background: var(--grad); }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); }
      td { padding: 13px 14px; border-bottom: 1px solid #f1f3f6; font-size: 13px; vertical-align: middle; }
      tr:last-child td { border-bottom: none; }
      .empty { text-align: center; color: var(--hint); font-style: italic; padding: 34px; font-size: 14px; }
      .flash-error { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; border-radius: 9px; padding: 11px 14px; margin-bottom: 16px; font-size: 13px; }
      .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:100; align-items:center; justify-content:center; padding:16px; }
      .modal-box { background:#fff; border-radius:12px; padding:26px; width:520px; max-width:100%; box-shadow:0 8px 32px rgba(0,0,0,0.18); max-height:90vh; overflow-y:auto; }
      .field-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; font-weight:600; margin-bottom:3px; }
      .field-value { font-size:13px; color:var(--ink); }
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
    </style>
  `;
}

function appBar({ home = '#', right = '' } = {}) {
  return `<header class="appbar"><div class="appbar-inner">
    <a class="appbar-brand" href="${home}" aria-label="Noesys">${logoCompact(52)}</a>
    <div class="appbar-actions">${right}</div>
  </div><div class="appbar-accent"></div></header>`;
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

function dashboardPage(clients, req) {
  const rows = clients.length === 0
    ? `<tr><td colspan="6" class="empty">Nessun cliente. Crea il primo con il pulsante qui sopra.</td></tr>`
    : clients.map(c => {
      const area = c.area || 'Personal';
      const ac = AREA_COLOR[area] || '#1A5280';
      const st = STATO_CLIENTE[c.stato_cliente] || STATO_CLIENTE.attivo;
      const recall = c.prossima_azione
        ? `${esc(c.prossima_azione)}${c.prossima_azione_data ? `<br><span style="font-size:11px;color:#aaa">${itDate(c.prossima_azione_data)}</span>` : ''}`
        : '<span style="color:#ccc">—</span>';
      const sess = Number(c.p_sess) || 0;
      const ore  = Number(c.p_ore) || 0;
      const percorso = c.p_tipo
        ? `${esc(c.p_tipo)} · ${sess} ${sess === 1 ? 'sessione' : 'sessioni'}${ore > 0 ? ` · ${fmtOre(ore)} h` : ''}${c.p_stato !== 'attivo' ? ` · <span style="color:#999">concluso</span>` : ''}`
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

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Clienti</title>${baseStyle()}</head><body>
  ${appBar({ home: '/dashboard', right: `<a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/dashboard/committenti" class="btn btn-neutral btn-sm">Committenti</a><a href="/dashboard/progetti" class="btn btn-neutral btn-sm">Progetti</a><a href="/dashboard/icf" class="btn btn-neutral btn-sm">Estratto ICF</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>Clienti</h1><p style="color:#aaa;font-size:13px">${clients.length} clienti registrati</p></div>
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
  ${appBar({ home: '/dashboard', right: `<a href="/dashboard" class="btn btn-neutral btn-sm">← Dashboard</a>` })}
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
  const isBozza = s.stato === 'bozza';
  const cell = v => (v && String(v).trim() && String(v).trim() !== '—') ? esc(String(v)) : '<span style="color:#ccc">—</span>';
  const noteVal = (s.note && s.note.trim()) ? s.note : (s.scheda || ''); // recupera il vecchio formato
  const approvaBtn = isBozza
    ? `<button onclick="approvaSeduta('${s.id}','${s.percorso_id}')" class="btn btn-sm" style="background:#e7f1ec;color:#2e6b52;display:block;margin-bottom:5px" title="Approva">✓ Approva</button>` : '';
  return `<tr style="${isBozza ? 'background:#fffdf3' : ''}">
    <td style="white-space:nowrap">${s.data ? itDate(s.data) : '—'}</td>
    <td style="white-space:nowrap"><span class="badge" style="background:${T.bg};color:${T.c}">${esc(s.tipo)}</span>${isBozza ? '<div style="margin-top:5px"><span class="badge" style="background:#fdf6e3;color:#8a6d1e;border:1px solid #efdfa8">bozza</span></div>' : ''}</td>
    <td>${cellText(s.obiettivo)}</td>
    <td>${cellList(s.argomenti)}</td>
    <td>${cellList(s.attivita)}</td>
    <td style="white-space:nowrap">${cellDate(s.scadenza)}</td>
    <td style="text-align:center">${cellEseg(s.eseguita)}</td>
    <td>${cellText(noteVal)}</td>
    <td style="white-space:nowrap">${approvaBtn}<button onclick="editSeduta('${s.id}')" class="btn btn-neutral btn-sm" title="Modifica">✎</button> <button onclick="delSeduta('${s.id}','${s.percorso_id}')" class="btn btn-danger btn-sm" title="${isBozza ? 'Scarta' : 'Elimina'}">🗑</button></td>
  </tr>`;
}

function clientDetailPage(client, sessions, percorsi, payments, sedute, req) {
  const link = PLATFORM_URL + '/c/' + client.token;
  sedute = sedute || [];
  const area = client.area || 'Personal';
  const ac = AREA_COLOR[area] || '#1A5280';
  const st = STATO_CLIENTE[client.stato_cliente] || STATO_CLIENTE.attivo;
  const val = v => v ? esc(v) : '<span style="color:#ccc">—</span>';

  // ── Percorsi ────────────────────────────────────────
  const percorsiHtml = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">Percorsi</h2>
        <button onclick="openPercorso()" class="btn btn-primary btn-sm">+ Nuovo percorso</button>
      </div>
      ${percorsi.length === 0 ? `<div class="empty">Nessun percorso registrato.</div>` : `
      <table>
        <thead><tr><th>Tipo</th><th>Sessioni</th><th>Ore</th><th>Modalità</th><th>Prezzo</th><th>Periodo</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          ${percorsi.map(p => `<tr>
            <td><strong>${esc(p.tipo)}</strong></td>
            <td>
              <span style="font-size:13px;font-weight:700;color:var(--blue)">${p.n_sessioni_fatte}</span>
              <span style="font-size:11px;color:#aaa"> ${p.n_sessioni_fatte === 1 ? 'sessione' : 'sessioni'}</span>
              ${p.stato==='attivo' ? `
              <button onclick="addSessione('${p.id}',1)" class="btn btn-neutral btn-sm" style="margin-left:6px" title="Aggiungi sessione">+1</button>
              ${p.n_sessioni_fatte > 0 ? `<button onclick="addSessione('${p.id}',-1)" class="btn btn-neutral btn-sm" title="Rimuovi sessione">-1</button>` : ''}` : ''}
            </td>
            <td style="white-space:nowrap"><span style="font-weight:700;color:var(--green)">${fmtOre(p.ore_fatte)}</span> <span style="font-size:11px;color:#aaa">h</span>
              <button onclick="editOre('${p.id}', ${Number(p.ore_fatte||0)})" class="btn btn-neutral btn-sm" style="margin-left:4px" title="Correggi ore">✎</button></td>
            <td>${p.modalita==='Scambio servizi' ? `<span class="badge" style="background:#e8f4fd;color:#1A5280">Scambio servizi</span>` : p.modalita==='Pro bono' ? `<span class="badge badge-pausa">Pro bono</span>` : `<span style="font-size:12px;color:#4a5568">Standard</span>`}</td>
            <td>${p.prezzo ? `€ ${Number(p.prezzo).toLocaleString('it-IT',{minimumFractionDigits:2})}` : '<span style="color:#aaa">—</span>'}${p.promo ? `<br><span class="badge badge-pausa">Promo</span>${p.sconto_note ? ` <span style="font-size:11px;color:#aaa">${esc(p.sconto_note)}</span>` : ''}` : ''}</td>
            <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}${p.data_fine ? `<br>→ ${itDate(p.data_fine)}` : ''}</td>
            <td><span class="badge ${p.stato==='attivo'?'badge-active':'badge-inactive'}">${p.stato==='attivo'?'Attivo':'Concluso'}</span></td>
            <td style="white-space:nowrap">${p.stato==='attivo' ? `<button onclick="chiudiPercorso('${p.id}')" class="btn btn-neutral btn-sm">Chiudi</button> ` : ''}<button onclick="delPercorso('${p.id}')" class="btn btn-danger btn-sm" title="Elimina percorso">🗑</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  // ── Scheda Cliente (una riga per sessione: la tabella storica di Cowork) ──
  const seduteBody = percorsi.length === 0
    ? `<div class="empty">Crea prima un percorso per registrare le sessioni.</div>`
    : sedute.length === 0
      ? `<div class="empty">Nessuna sessione. Usa "+ Aggiungi sessione", oppure "⟳ Cerca nuovi report" se hai messo un report su Drive.</div>`
      : `<div style="overflow-x:auto">
          <table class="scheda-cliente">
            <thead><tr><th>Data</th><th>Sessione</th><th>Obiettivo</th><th>Argomenti trattati</th><th>Attività concordate</th><th>Scadenza</th><th>Eseg.</th><th>Note</th><th></th></tr></thead>
            <tbody>${sedute.map(renderSedutaRow).join('')}</tbody>
          </table>
        </div>`;
  const seduteHtml = `
    <div class="card">
      <details class="sec" open>
        <summary style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer">
          <span style="display:flex;align-items:center;gap:8px"><span class="sec-caret">▸</span><h2 style="margin:0">Scheda Cliente <span style="font-weight:400;font-size:13px;color:#aaa">(${sedute.length} ${sedute.length === 1 ? 'sessione' : 'sessioni'})</span></h2></span>
          <span style="display:inline-flex;gap:8px;align-items:center">
            ${client.drive_url ? `<button id="scan-btn" onclick="event.stopPropagation();scanDrive()" class="btn btn-neutral btn-sm" title="Legge i report Word nuovi dalla cartella Drive e ne aggiunge la riga in bozza">⟳ Cerca nuovi report</button>` : ''}
            ${percorsi.length ? `<button onclick="event.stopPropagation();openSeduta()" class="btn btn-primary btn-sm">+ Aggiungi sessione</button>` : ''}
          </span>
        </summary>
        <div style="margin-top:14px">${seduteBody}</div>
      </details>
    </div>`;

  // ── Pagamenti ────────────────────────────────────────
  const totRicevuto = payments.filter(p=>p.stato==='ricevuto').reduce((s,p)=>s+Number(p.importo),0);
  const totAtteso   = payments.filter(p=>p.stato==='atteso').reduce((s,p)=>s+Number(p.importo),0);
  const paymentsHtml = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">Amministrazione
          <span style="font-size:12px;font-weight:400;color:#aaa;margin-left:10px">
            Ricevuto: <strong style="color:#4F8B73">€ ${totRicevuto.toLocaleString('it-IT',{minimumFractionDigits:2})}</strong>
            ${totAtteso > 0 ? ` · In attesa: <strong style="color:#D8AE2E">€ ${totAtteso.toLocaleString('it-IT',{minimumFractionDigits:2})}</strong>` : ''}
          </span>
        </h2>
        <button onclick="openPayment()" class="btn btn-primary btn-sm">+ Pagamento</button>
      </div>
      ${payments.length === 0 ? `<div class="empty">Nessun pagamento registrato.</div>` : `
      <table>
        <thead><tr><th>Importo</th><th>Tipo</th><th>Data</th><th>Stato</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr>
            <td><strong>€ ${Number(p.importo).toLocaleString('it-IT',{minimumFractionDigits:2})}</strong></td>
            <td style="font-size:12px">${esc(p.tipo)}</td>
            <td style="font-size:12px;color:#aaa">${p.data_pagamento ? itDate(p.data_pagamento) : '—'}</td>
            <td>${p.stato==='ricevuto' ? `<span class="badge badge-active">Ricevuto</span>` : `<span class="badge badge-inactive">In attesa</span>`}</td>
            <td style="font-size:12px;color:#aaa">${esc(p.note||'')}</td>
            <td style="white-space:nowrap">
              ${p.stato==='atteso' ? `<button onclick="segnaRicevuto('${p.id}')" class="btn btn-neutral btn-sm">✓ Ricevuto</button>` : ''}
              <button onclick="deletePayment('${p.id}')" class="btn btn-danger btn-sm" style="margin-left:4px">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  // ── Strumenti utilizzati — sezione a fisarmonica ─────
  const TOOL_LABEL = {valori:'💎 Valori',abilita:'⭐ Abilità',lineavita:'📈 Linea della Vita',genogramma:'🔗 Genogramma',ruotavita:'🎯 Ruota della Vita',brainstorming:'💡 Brainstorming','logica-cartesiana':'🧭 Logica Cartesiana'};
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

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(client.name)}</title>${baseStyle()}</head><body>
  ${appBar({ home: '/dashboard', right: `<a href="/dashboard" class="btn btn-neutral btn-sm">← Clienti</a><a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">

    <!-- SCHEDA CLIENTE -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <h1 style="margin:0">${esc(client.name)}</h1>
            <span class="badge" style="background:${ac}18;color:${ac}">${area}</span>
            <span class="badge ${st.cls}">${st.label}</span>
            ${!client.active ? `<span class="badge badge-inactive" title="Accesso agli strumenti disattivato">🔒 Accesso off</span>` : ''}
          </div>
          <div style="margin-top:14px"><div class="field-label">Indirizzo</div><div class="field-value">${composeAddress(client) ? esc(composeAddress(client)) : '<span style="color:#ccc">—</span>'}</div></div>
          <div style="margin-top:12px"><div class="field-label">Contatti</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:4px">
              <div><span style="font-size:11px;color:var(--hint)">Telefono</span><div class="field-value">${val(client.telefono)}</div></div>
              <div><span style="font-size:11px;color:var(--hint)">Email</span><div class="field-value">${val(client.email)}</div></div>
              <div><span style="font-size:11px;color:var(--hint)">Social</span><div class="field-value">${client.altro_recapito ? `${client.social_tipo ? `<strong>${esc(client.social_tipo)}</strong> · ` : ''}${esc(client.altro_recapito)}` : '<span style="color:#ccc">—</span>'}</div></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px">
            <div><div class="field-label">Data di nascita</div><div class="field-value">${client.data_nascita ? itDate(client.data_nascita) : '<span style="color:#ccc">—</span>'}</div></div>
            <div><div class="field-label">Professione</div><div class="field-value">${val(client.professione)}</div></div>
            <div><div class="field-label">Società</div><div class="field-value">${val(client.societa)}</div></div>
            <div><div class="field-label">Come ci ha conosciuto</div><div class="field-value">${FONTE_LABEL[client.fonte]||val(client.fonte)}</div></div>
            <div><div class="field-label">Consenso privacy</div><div class="field-value">${client.consenso_privacy ? `Sì${client.consenso_data ? ` (${itDate(client.consenso_data)})` : ''}` : '<span style="color:#ccc">No</span>'}</div></div>
          </div>
          ${client.note_preliminari ? `<div style="margin-top:10px"><div class="field-label">Note CRM</div><div style="font-size:13px;color:#6B7280">${esc(client.note_preliminari)}</div></div>` : ''}
          ${client.drive_url
            ? `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><a href="${esc(client.drive_url)}" target="_blank" style="font-size:13px;word-break:break-all">${esc(client.drive_url)}</a></div>`
            : `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><button id="drive-folders-btn" onclick="createDriveFolders()" class="btn btn-neutral btn-sm">🔄 Crea cartelle Drive</button><span id="drive-folders-msg" style="font-size:12px;color:#6B7280;margin-left:8px"></span></div>`}
          ${recallHtml}
        </div>
        <div style="text-align:right;min-width:210px">
          <button onclick="openEdit()" class="btn btn-primary btn-sm" style="margin-bottom:10px">✎ Modifica dati</button>
          <div class="field-label" style="margin-top:6px">Link accesso strumenti</div>
          <code style="display:block;font-size:10px;background:#f5f5f5;padding:5px 8px;border-radius:5px;word-break:break-all;margin-bottom:8px">${link}</code>
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            <button onclick="copyLink('${link}')" class="btn btn-neutral btn-sm">📋 Copia</button>
            <button onclick="toggleAccess()" class="btn ${client.active?'btn-gold':'btn-primary'} btn-sm">${client.active?'Disattiva accesso':'Riattiva accesso'}</button>
            <button onclick="deleteClient()" class="btn btn-danger btn-sm">🗑</button>
          </div>
        </div>
      </div>
    </div>

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

  <!-- MODAL NUOVO PERCORSO -->
  <div id="modal-percorso" class="modal-overlay">
    <div class="modal-box" style="width:420px">
      <h2 style="margin-bottom:16px">Nuovo percorso</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="p-tipo"><option>Individuale</option><option>Business</option><option>Young</option><option>Team</option><option>Group</option></select></div>
        <div class="form-group"><label>Modalità</label>
          <select id="p-modalita"><option value="Scambio servizi" selected>Scambio servizi</option><option value="Standard">Pagamento standard</option><option value="Pro bono">Pro bono</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Ore svolte</label><input id="p-ore" type="number" step="0.5" min="0" value="0"></div>
        <div class="form-group"><label>Prezzo (€)</label><input id="p-prezzo" type="number" step="0.01" placeholder="es. 900"></div>
      </div>
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Scadenza <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(data)</span></label><input id="s-scadenza" type="date"></div>
        <div class="form-group"><label>Eseguita</label><select id="s-eseguita"><option value="">—</option><option value="✓">✓ fatta</option><option value="✗">✗ non fatta</option></select></div>
      </div>
      <div class="form-group"><label>Note</label><textarea id="s-note" style="min-height:60px"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-seduta').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveSeduta()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <!-- MODAL NUOVO PAGAMENTO -->
  <div id="modal-payment" class="modal-overlay">
    <div class="modal-box" style="width:380px">
      <h2 style="margin-bottom:16px">Registra pagamento</h2>
      <div class="form-group"><label>Importo (€) *</label><input id="pay-importo" type="number" step="0.01" placeholder="es. 450.00"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="pay-tipo"><option value="acconto">Acconto</option><option value="saldo">Saldo</option><option value="sessione">Sessione singola</option><option value="scambio servizi">Scambio servizi</option><option value="altro">Altro</option></select></div>
        <div class="form-group"><label>Stato</label>
          <select id="pay-stato"><option value="atteso">In attesa</option><option value="ricevuto">Ricevuto</option></select></div>
      </div>
      <div class="form-group"><label>Data</label><input id="pay-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="pay-note" type="text" placeholder="opzionale"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-payment').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="savePayment()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:200">Fatto!</div>
  <script>
    const CID = '${client.id}';
    const SEDUTE = ${JSON.stringify(Object.fromEntries(sedute.map(s => [s.id, { id: s.id, percorso_id: s.percorso_id, tipo: s.tipo, data: s.data, ore: Number(s.ore), obiettivo: s.obiettivo || '', argomenti: s.argomenti || '', attivita: s.attivita || '', scadenza: s.scadenza || '', eseguita: s.eseguita || '', note: s.note || '' }]))).replace(/</g, '\\u003c')};
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
      ['s-obiettivo','s-argomenti','s-attivita','s-scadenza','s-eseguita','s-note'].forEach(id => document.getElementById(id).value = '');
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
      const body = { tipo: g('s-tipo'), data: g('s-data') || null, ore: g('s-ore') || 0, obiettivo: g('s-obiettivo'), argomenti: g('s-argomenti'), attivita: g('s-attivita'), scadenza: g('s-scadenza'), eseguita: g('s-eseguita'), note: g('s-note') };
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
      await fetch('/dashboard/clients/' + CID + '/percorsi/' + pid + '/sedute/' + sid + '/approva', { method: 'POST' }); location.reload();
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
    function copyLink(url) { navigator.clipboard.writeText(url).then(() => { const t=document.getElementById('toast'); t.textContent='Link copiato!'; t.style.display='block'; setTimeout(()=>t.style.display='none',2000); }); }
    function openEdit() { document.getElementById('modal-edit').style.display='flex'; }
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
    async function toggleAccess() { await fetch('/dashboard/clients/'+CID+'/toggle',{method:'POST'}); location.reload(); }
    async function deleteClient() {
      if (!confirm('Eliminare ${attr(client.name)} e tutti i suoi dati? Operazione irreversibile.')) return;
      await fetch('/dashboard/clients/'+CID,{method:'DELETE'}); location.href='/dashboard';
    }
    function openPercorso() { document.getElementById('modal-percorso').style.display='flex'; }
    async function savePercorso() {
      const r = await fetch('/dashboard/clients/'+CID+'/percorsi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        tipo: document.getElementById('p-tipo').value,
        modalita: document.getElementById('p-modalita').value,
        ore_fatte: document.getElementById('p-ore').value || 0,
        prezzo: document.getElementById('p-prezzo').value || null,
        promo: document.getElementById('p-promo').checked,
        sconto_note: document.getElementById('p-sconto').value,
        data_inizio: document.getElementById('p-data').value || null,
      })});
      const d = await r.json().catch(()=>({}));
      if (d && d.driveWarning) alert(d.driveWarning);
      location.reload();
    }
    async function addSessione(pid,delta) {
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid+'/sessione',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delta})});
      location.reload();
    }
    async function chiudiPercorso(pid) {
      if(!confirm('Chiudere questo percorso?')) return;
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid+'/chiudi',{method:'POST'}); location.reload();
    }
    async function editOre(pid, cur) {
      const v = prompt('Ore svolte del percorso (es. 14 oppure 1,5):', cur);
      if (v === null) return;
      const n = parseFloat(String(v).replace(',', '.'));
      if (isNaN(n) || n < 0) { alert('Inserisci un numero valido, es. 14 oppure 1,5'); return; }
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid+'/ore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ore_fatte:n})}); location.reload();
    }
    async function delPercorso(pid) {
      if(!confirm('Eliminare questo percorso? Le sue ore spariscono dall\\'estratto ICF. Operazione irreversibile.')) return;
      await fetch('/dashboard/clients/'+CID+'/percorsi/'+pid,{method:'DELETE'}); location.reload();
    }
    function openPayment() { document.getElementById('modal-payment').style.display='flex'; }
    async function savePayment() {
      const importo = document.getElementById('pay-importo').value;
      if (!importo) { alert('Importo obbligatorio'); return; }
      await fetch('/dashboard/clients/'+CID+'/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        importo, tipo: document.getElementById('pay-tipo').value,
        stato: document.getElementById('pay-stato').value,
        data_pagamento: document.getElementById('pay-data').value || null,
        note: document.getElementById('pay-note').value,
      })});
      location.reload();
    }
    async function segnaRicevuto(pid) {
      await fetch('/dashboard/clients/'+CID+'/payments/'+pid+'/ricevuto',{method:'POST'}); location.reload();
    }
    async function deletePayment(pid) {
      if(!confirm('Eliminare questo pagamento?')) return;
      await fetch('/dashboard/clients/'+CID+'/payments/'+pid,{method:'DELETE'}); location.reload();
    }
    [document.getElementById('modal-edit'),document.getElementById('modal-percorso'),document.getElementById('modal-payment'),document.getElementById('modal-seduta')].forEach(m=>{
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
        ${l.stato!=='convertito' ? `<button onclick="convertLead('${l.id}')" class="btn btn-primary btn-sm" style="margin:0 4px">→ Cliente</button>` : ''}
        <button onclick="deleteLead('${l.id}')" class="btn btn-danger btn-sm">✕</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Lead</title>${baseStyle()}</head><body>
  ${appBar({ home:'/dashboard', right:`<a href="/dashboard" class="btn btn-neutral btn-sm">← Clienti</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>Lead</h1><p style="color:#aaa;font-size:13px">${attivi.length} attivi · ${archiviati.length} archiviati</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo lead</button>
    </div>

    <input id="cerca" type="search" placeholder="🔍 Cerca lead (nome, email, telefono…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th>Azioni</th></tr></thead>
        <tbody>
          ${attivi.length ? attivi.map(renderRow).join('') : `<tr><td colspan="6" class="empty">Nessun lead attivo.</td></tr>`}
        </tbody>
      </table>
    </div>

    ${archiviati.length ? `
    <h2 style="margin:24px 0 10px;font-size:14px;color:#aaa">Archiviati (convertiti / persi)</h2>
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th>Azioni</th></tr></thead>
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
function committentiPage(committenti, req) {
  const TIPO_CFG = {
    azienda: { label: 'Azienda',  bg: '#e7f1ec', color: '#2e6b52' },
    persona: { label: 'Persona',  bg: '#e8f4fd', color: '#1A5280' },
  };

  function renderRow(k) {
    const tc = TIPO_CFG[k.tipo] || TIPO_CFG.azienda;
    const fatt = [k.partita_iva ? 'P.IVA '+esc(k.partita_iva) : '', k.codice_fiscale ? 'CF '+esc(k.codice_fiscale) : '']
      .filter(Boolean).join(' · ');
    return `<tr>
      <td><strong>${esc(k.denominazione)}</strong>
        ${k.referente ? `<br><span style="font-size:11px;color:#aaa">${esc(k.referente)}${k.ruolo ? ' — '+esc(k.ruolo) : ''}</span>` : ''}
      </td>
      <td><span class="badge" style="background:${tc.bg};color:${tc.color}">${tc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">
        ${k.email ? esc(k.email) : ''}${k.email && k.telefono ? '<br>' : ''}${k.telefono ? `<span style="color:#aaa">${esc(k.telefono)}</span>` : ''}${!k.email && !k.telefono ? '<span style="color:#ccc">—</span>' : ''}
      </td>
      <td style="font-size:12px;color:#aaa">${fatt || '—'}</td>
      <td style="white-space:nowrap">
        <button onclick='editComm(${JSON.stringify(k).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <button onclick="deleteComm('${k.id}')" class="btn btn-danger btn-sm">✕</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Committenti</title>${baseStyle()}</head><body>
  ${appBar({ home:'/dashboard', right:`<a href="/dashboard" class="btn btn-neutral btn-sm">← Clienti</a><a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/dashboard/progetti" class="btn btn-neutral btn-sm">Progetti</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Committenti / Sponsor</h1><p style="color:#aaa;font-size:13px">${committenti.length} ${committenti.length===1?'committente':'committenti'}</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo committente</button>
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Chi commissiona o paga un percorso (azienda o persona). Non ha accesso all'Hub.</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca committente (nome, referente, email…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Committente</th><th>Tipo</th><th>Contatto</th><th>Fatturazione</th><th>Azioni</th></tr></thead>
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
      <div class="form-group"><label>Indirizzo di fatturazione</label><input id="c-indirizzo" type="text" placeholder="Via, CAP Città (Prov.)"></div>
      <div class="form-group"><label>PEC / Codice SDI</label><input id="c-pecsdi" type="text" placeholder="fattura elettronica"></div>
      <div class="form-group"><label>Note</label><input id="c-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeCommModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveComm()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    const F = ['tipo','denominazione','referente','ruolo','email','telefono','codice_fiscale','partita_iva','indirizzo','pec_sdi','note'];
    const ID = { tipo:'c-tipo', denominazione:'c-denominazione', referente:'c-referente', ruolo:'c-ruolo',
      email:'c-email', telefono:'c-tel', codice_fiscale:'c-cf', partita_iva:'c-piva',
      indirizzo:'c-indirizzo', pec_sdi:'c-pecsdi', note:'c-note' };
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
    'pre-intake': { label:'Pre-intake', bg:'#eae6f7', color:'#4c3a86' },
    'proposta':   { label:'Proposta',   bg:'#fff8dc', color:'#7a5c00' },
    'attivo':     { label:'Attivo',     bg:'#d1fae5', color:'#065f46' },
    'chiuso':     { label:'Chiuso',     bg:'#eef1f5', color:'#7a8089' },
    'perso':      { label:'Perso',      bg:'#fdf0ef', color:'#c0392b' },
  };
  const TIPO_LABEL = { individuale:'Individuale', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };

  const noComm = committenti.length === 0;
  const commOptions = committenti.map(c => `<option value="${c.id}">${esc(c.denominazione)}</option>`).join('');

  function renderRow(p) {
    const sc = STATO_CFG[p.stato] || STATO_CFG['pre-intake'];
    const ac = AREA_COL[p.area] || '#1A5280';
    const n = Number(p.n_coachee) || 0;
    return `<tr onclick="location.href='/dashboard/progetti/${p.id}'" style="cursor:pointer">
      <td><strong>${esc(p.titolo)}</strong>
        <br><span style="font-size:11px;color:#aaa">${esc(p.committente_nome)}</span>
      </td>
      <td><span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span></td>
      <td style="font-size:12px;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">${n > 0 ? `${n} ${n===1?'coachee':'coachee'}` : '<span style="color:#ccc">—</span>'}</td>
      <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        <button onclick='editProg(${JSON.stringify(p).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <button onclick="deleteProg('${p.id}')" class="btn btn-danger btn-sm">✕</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Progetti</title>${baseStyle()}</head><body>
  ${appBar({ home:'/dashboard', right:`<a href="/dashboard" class="btn btn-neutral btn-sm">← Clienti</a><a href="/dashboard/committenti" class="btn btn-neutral btn-sm">Committenti</a><a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Progetti</h1><p style="color:#aaa;font-size:13px">${progetti.length} ${progetti.length===1?'progetto':'progetti'}</p></div>
      ${noComm
        ? `<a href="/dashboard/committenti" class="btn btn-primary">+ Crea prima un committente</a>`
        : `<button onclick="openNew()" class="btn btn-primary">+ Nuovo progetto</button>`}
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Il percorso commissionato da un committente. In Business/Young con sponsor è qui che nasce la trattativa (pre-intake → proposta → attivo).</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca progetto (titolo, committente…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Progetto</th><th>Area</th><th>Tipo</th><th>Stato</th><th>Coachee</th><th>Inizio</th><th>Azioni</th></tr></thead>
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
          <select id="p-tipo"><option value="individuale">Individuale</option><option value="team">Team</option><option value="group">Group</option></select></div>
        <div class="form-group"><label>Stato</label>
          <select id="p-stato"><option value="pre-intake">Pre-intake</option><option value="proposta">Proposta</option><option value="attivo">Attivo</option><option value="chiuso">Chiuso</option><option value="perso">Perso</option></select></div>
      </div>
      <div class="form-group"><label>Data inizio</label><input id="p-data" type="date"></div>
      <div class="form-group"><label>Obiettivi (aziendali)</label><textarea id="p-obiettivi" placeholder="obiettivi del committente per questo progetto"></textarea></div>
      <div class="form-group"><label>Note</label><input id="p-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeProgModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveProg()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    const F = ['committente_id','titolo','area','tipo','stato','data_inizio','obiettivi','note'];
    const ID = { committente_id:'p-committente', titolo:'p-titolo', area:'p-area', tipo:'p-tipo',
      stato:'p-stato', data_inizio:'p-data', obiettivi:'p-obiettivi', note:'p-note' };
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
      document.getElementById('p-stato').value = 'pre-intake';
      document.getElementById('modal-prog').style.display = 'flex';
    }
    function editProg(p) {
      document.getElementById('modal-prog-title').textContent = 'Modifica progetto';
      document.getElementById('p-id').value = p.id;
      F.forEach(f => document.getElementById(ID[f]).value = (f==='data_inizio' && p[f]) ? String(p[f]).slice(0,10) : (p[f] || ''));
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
function progettoDettaglioPage(p, coachee, req) {
  const STATO_CFG = {
    'pre-intake': { label:'Pre-intake', bg:'#eae6f7', color:'#4c3a86' },
    'proposta':   { label:'Proposta',   bg:'#fff8dc', color:'#7a5c00' },
    'attivo':     { label:'Attivo',     bg:'#d1fae5', color:'#065f46' },
    'chiuso':     { label:'Chiuso',     bg:'#eef1f5', color:'#7a8089' },
    'perso':      { label:'Perso',      bg:'#fdf0ef', color:'#c0392b' },
  };
  const TIPO_LABEL = { individuale:'Individuale', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };
  const sc = STATO_CFG[p.stato] || STATO_CFG['pre-intake'];
  const ac = AREA_COL[p.area] || '#1A5280';

  const coacheeRows = coachee.length ? coachee.map(k => `
    <tr>
      <td><strong>${esc(k.name)}</strong>${k.email ? `<br><span style="font-size:11px;color:#aaa">${esc(k.email)}</span>` : ''}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        <button onclick="copyLink('${PLATFORM_URL}/c/${k.token}')" class="btn btn-neutral btn-sm">🔗 Link</button>
        <a href="/dashboard/clients/${k.client_id}" class="btn btn-neutral btn-sm">Scheda</a>
        <button onclick="removeCoachee('${k.part_id}')" class="btn btn-danger btn-sm">✕</button>
      </td>
    </tr>`).join('') : `<tr><td colspan="2" class="empty">Nessun coachee collegato. Aggiungi la prima persona.</td></tr>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(p.titolo)}</title>${baseStyle()}</head><body>
  ${appBar({ home:'/dashboard', right:`<a href="/dashboard/progetti" class="btn btn-neutral btn-sm">← Progetti</a><a href="/dashboard/committenti" class="btn btn-neutral btn-sm">Committenti</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:820px">
    <div style="margin-bottom:18px">
      <h1>${esc(p.titolo)}</h1>
      <p style="color:#aaa;font-size:13px">Committente: <strong style="color:var(--ink)">${esc(p.committente_nome)}</strong>${p.committente_email ? ` · ${esc(p.committente_email)}` : ''}</p>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span>
        <span class="badge" style="background:#eef1f5;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</span>
        <span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
        ${p.data_inizio ? `<span class="badge" style="background:#eef1f5;color:#7a8089">Inizio ${itDate(p.data_inizio)}</span>` : ''}
      </div>
    </div>

    ${(p.obiettivi || p.note) ? `<div class="card">
      ${p.obiettivi ? `<div style="margin-bottom:${p.note?'12px':'0'}"><div class="field-label">Obiettivi aziendali</div><div class="field-value" style="white-space:pre-wrap">${esc(p.obiettivi)}</div></div>` : ''}
      ${p.note ? `<div><div class="field-label">Note</div><div class="field-value" style="white-space:pre-wrap">${esc(p.note)}</div></div>` : ''}
    </div>` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px">
      <h2 style="margin:0">Coachee <span style="color:#aaa;font-weight:500;font-size:13px">(${coachee.length})</span></h2>
      <button onclick="openAdd()" class="btn btn-primary btn-sm">+ Aggiungi coachee</button>
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:12px">Le persone che fanno le sessioni in questo progetto. Le quote (chi paga quanto) arrivano nella prossima fase.</p>
    <div class="card" style="padding:0;overflow:hidden">
      <table><tbody>${coacheeRows}</tbody></table>
    </div>
  </div>

  <div id="modal-coachee" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px">Aggiungi coachee</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome</label><input id="k-nome" type="text"></div>
        <div class="form-group"><label>Cognome *</label><input id="k-cognome" type="text"></div>
      </div>
      <div class="form-group"><label>Email</label><input id="k-email" type="email"></div>
      <p style="color:var(--muted);font-size:12px;margin-bottom:12px">Nasce come cliente con il suo link alla piattaforma. La cartella Drive si crea dopo, dalla sua scheda.</p>
      <div style="display:flex;gap:8px">
        <button onclick="closeAdd()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveCoachee()" class="btn btn-primary" style="flex:1">Aggiungi</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#223B6E;color:#fff;padding:10px 18px;border-radius:22px;font-size:13px;z-index:200">Link copiato!</div>

  <script>
    const PID = ${JSON.stringify(p.id)};
    function openAdd() {
      ['k-nome','k-cognome','k-email'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('modal-coachee').style.display='flex';
    }
    function closeAdd() { document.getElementById('modal-coachee').style.display='none'; }
    async function saveCoachee() {
      const cognome = document.getElementById('k-cognome').value.trim();
      if (!cognome) { alert('Cognome obbligatorio'); return; }
      const payload = { nome:document.getElementById('k-nome').value, cognome, email:document.getElementById('k-email').value };
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    async function removeCoachee(partId) {
      if (!confirm('Togliere questo coachee dal progetto? Se non ha ancora dati, viene eliminato anche dall\\'anagrafica.')) return;
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee/'+partId, { method:'DELETE' });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      if (d.kept && d.message) alert(d.message);
      location.reload();
    }
    function copyLink(url) {
      navigator.clipboard.writeText(url).then(() => {
        const t=document.getElementById('toast'); t.style.display='block'; setTimeout(()=>t.style.display='none',2000);
      });
    }
    document.getElementById('modal-coachee').addEventListener('click', e => { if (e.target === document.getElementById('modal-coachee')) closeAdd(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// RENDER DATI STRUMENTI (sola lettura)
// ═══════════════════════════════════════════════════════

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
    case 'ruotavita': {
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
    case 'logica-cartesiana': {
      const quads = [
        { r:'I',   key:'accade_faccio',       q:'Cosa accade se lo faccio?' },
        { r:'II',  key:'accade_nonfaccio',    q:'Cosa accade se non lo faccio?' },
        { r:'III', key:'nonaccade_faccio',    q:'Cosa non accade se lo faccio?' },
        { r:'IV',  key:'nonaccade_nonfaccio', q:'Cosa non accade se non lo faccio?' }
      ];
      const chip = t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(t)}</span>`;
      const blocks = quads.map(qd => {
        const items = (d[qd.key] || []).map(c => c && c.text).filter(Boolean);
        return `<div style="margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#6B7280;display:inline-flex;align-items:center">
            <span style="display:inline-block;min-width:18px;height:16px;line-height:16px;text-align:center;padding:0 4px;border-radius:8px;background:#223B6E;color:#fff;font-size:10px;font-weight:700;margin-right:6px">${qd.r}</span>${qd.q}</span><br>
          ${items.length ? items.map(chip).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}
        </div>`;
      }).join('');
      return `${d.decisione ? `<div style="margin-bottom:10px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Decisione</span><br><span style="font-size:14px;font-weight:700;color:#223B6E">${esc(d.decisione)}</span></div>` : ''}${blocks}`;
    }
    default:
      return '<span style="color:#aaa;font-size:12px">Anteprima non disponibile</span>';
  }
}

// ═══════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════

function fmtDate(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 16).replace('T', ' ');
}

// Data 'AAAA-MM-GG' → 'GG/MM/AAAA' (formato italiano per la visualizzazione).
function itDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

// Data ISO (2026-07-11) → nome cartella Drive italiano con trattini (11-07-2026).
// Trattini e non "/" perché lo slash non è ammesso nei nomi di cartella su Drive.
function itFolderDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
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
  ${appBar({ home:'/dashboard', right:`<a href="/dashboard" class="btn btn-neutral btn-sm">← Clienti</a><a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container" style="max-width:980px">
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
