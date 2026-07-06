const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('./db');
const { signToken, requireCoach, COOKIE_NAME } = require('./auth');
const { logoCompact } = require('./logo');

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

router.post('/dashboard/clients', requireCoach, express.json(), async (req, res) => {
  const { name, email, telefono, area, fonte, obiettivo } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obbligatorio' });
  const id    = uuidv4();
  const token = uuidv4().replace(/-/g, '');
  try {
    await db.query(
      `INSERT INTO clients (id, name, email, telefono, area, fonte, obiettivo, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name.trim(), (email||'').trim(), (telefono||'').trim(),
       area||'Personal', fonte||'altro', (obiettivo||'').trim(), token]
    );
    res.json({ id, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore creazione cliente' });
  }
});

router.get('/dashboard/clients/:id', requireCoach, async (req, res) => {
  try {
    const cr = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = cr.rows[0];
    if (!client) return res.redirect('/dashboard');
    const [sr, pr, payr] = await Promise.all([
      db.query('SELECT * FROM sessions WHERE client_id=$1 ORDER BY tool, created_at DESC', [req.params.id]),
      db.query('SELECT * FROM percorsi WHERE client_id=$1 ORDER BY created_at ASC', [req.params.id]),
      db.query('SELECT * FROM payments WHERE client_id=$1 ORDER BY created_at DESC', [req.params.id]),
    ]);
    res.send(clientDetailPage(client, sr.rows, pr.rows, payr.rows, req));
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

// Aggiornamento dati anagrafici cliente
router.post('/dashboard/clients/:id', requireCoach, express.json(), async (req, res) => {
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Nome obbligatorio' });
  try {
    // Se il consenso è appena stato dato e non c'era una data, la impostiamo a oggi.
    const consenso = !!b.consenso_privacy;
    await db.query(
      `UPDATE clients SET
        name=$1, email=$2, telefono=$3, altro_recapito=$4, social_tipo=$5,
        via=$6, cap=$7, citta=$8, provincia=$9, data_nascita=$10,
        professione=$11, area=$12, fonte=$13, obiettivo=$14, stato_cliente=$15,
        prossima_azione=$16, prossima_azione_data=$17, drive_url=$18, note_preliminari=$19,
        consenso_privacy=$20,
        consenso_data = CASE WHEN $20 AND consenso_data IS NULL THEN CURRENT_DATE
                             WHEN $20 THEN consenso_data ELSE NULL END
       WHERE id=$21`,
      [b.name.trim(), (b.email||'').trim(), (b.telefono||'').trim(), (b.altro_recapito||'').trim(),
       (b.social_tipo||'').trim(), (b.via||'').trim(), (b.cap||'').trim(), (b.citta||'').trim(),
       (b.provincia||'').trim(), b.data_nascita||null, (b.professione||'').trim(),
       b.area||'Personal', b.fonte||'altro', (b.obiettivo||'').trim(), b.stato_cliente||'attivo',
       (b.prossima_azione||'').trim(), b.prossima_azione_data||null, (b.drive_url||'').trim(),
       (b.note_preliminari||'').trim(), consenso, req.params.id]
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
    res.json({ ok: true, id: pid });
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
    const clientId = uuidv4();
    const token    = uuidv4().replace(/-/g, '');
    const nome     = [lead.nome, lead.cognome].filter(Boolean).join(' ');
    // Portiamo con noi fonte e note del lead nel nuovo cliente.
    await db.query(
      `INSERT INTO clients (id,name,email,telefono,fonte,note_preliminari,token)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, nome, lead.email||'', lead.telefono||'', lead.fonte||'altro', lead.note||'', token]
    );
    await db.query("UPDATE leads SET stato='convertito',updated_at=NOW() WHERE id=$1", [lead.id]);
    res.json({ ok: true, clientId, token });
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
  ${appBar({ home: '/dashboard', right: `<a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/dashboard/icf" class="btn btn-neutral btn-sm">Estratto ICF</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
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
      <div class="form-group"><label>Nome e cognome *</label><input id="new-name" type="text" placeholder="es. Mario Rossi"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="new-email" type="email" placeholder="mario@esempio.it"></div>
        <div class="form-group"><label>Telefono</label><input id="new-tel" type="tel" placeholder="+39…"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label><select id="new-area">${areaOptions('Personal')}</select></div>
        <div class="form-group"><label>Come ti ha conosciuto</label><select id="new-fonte">${fonteOptions('altro')}</select></div>
      </div>
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
      ['new-name','new-email','new-tel','new-obiettivo'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('btn-create').style.display = '';
      document.getElementById('new-name').focus();
    }
    function closeModal() {
      document.getElementById('modal-overlay').style.display = 'none';
      if (document.getElementById('new-result').style.display !== 'none') location.reload();
    }
    async function createClient() {
      const name  = document.getElementById('new-name').value.trim();
      const errEl = document.getElementById('new-error');
      if (!name) { errEl.textContent = 'Il nome è obbligatorio'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';
      const res = await fetch('/dashboard/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        name, email: document.getElementById('new-email').value.trim(),
        telefono: document.getElementById('new-tel').value.trim(),
        area: document.getElementById('new-area').value,
        fonte: document.getElementById('new-fonte').value,
        obiettivo: document.getElementById('new-obiettivo').value.trim(),
      }) });
      const data = await res.json();
      if (data.error) { errEl.textContent = data.error; errEl.style.display='block'; return; }
      const link = PLATFORM_URL + '/c/' + data.token;
      document.getElementById('new-link').href = link;
      document.getElementById('new-link').textContent = link;
      document.getElementById('new-result').style.display = 'block';
      document.getElementById('btn-create').style.display = 'none';
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

function clientDetailPage(client, sessions, percorsi, payments, req) {
  const link = PLATFORM_URL + '/c/' + client.token;
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

  // ── Pagamenti ────────────────────────────────────────
  const totRicevuto = payments.filter(p=>p.stato==='ricevuto').reduce((s,p)=>s+Number(p.importo),0);
  const totAtteso   = payments.filter(p=>p.stato==='atteso').reduce((s,p)=>s+Number(p.importo),0);
  const paymentsHtml = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0">Pagamenti
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

  // ── Strumenti ────────────────────────────────────────
  const TOOL_LABEL = {valori:'💎 Valori',abilita:'⭐ Abilità',lineavita:'📈 Linea della Vita',genogramma:'🔗 Genogramma',ruotavita:'🎯 Ruota della Vita',brainstorming:'💡 Brainstorming','logica-cartesiana':'🧭 Logica Cartesiana'};
  const sessionCards = sessions.length === 0
    ? `<div class="empty">Nessuno strumento compilato dal cliente.</div>`
    : sessions.map(s => `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:15px;font-weight:700;color:var(--ink)">${TOOL_LABEL[s.tool] || esc(s.tool)} <span style="font-size:12px;font-weight:600;color:#aaa">· ${itDate(s.created_at)}</span></div>
          <span style="font-size:11px;color:#aaa">Aggiornato: ${fmtDate(s.updated_at)}</span>
        </div>
        <div style="font-size:13px;line-height:1.7">${renderSessionData(s.tool, s.data)}</div>
      </div>`).join('');

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
            <div><div class="field-label">Come ci ha conosciuto</div><div class="field-value">${FONTE_LABEL[client.fonte]||val(client.fonte)}</div></div>
            <div><div class="field-label">Consenso privacy</div><div class="field-value">${client.consenso_privacy ? `Sì${client.consenso_data ? ` (${itDate(client.consenso_data)})` : ''}` : '<span style="color:#ccc">No</span>'}</div></div>
          </div>
          ${client.obiettivo ? `<div style="margin-top:14px"><div class="field-label">Obiettivo / motivo</div><div style="font-size:13px;background:#f8f9fb;padding:10px 12px;border-radius:8px;border-left:3px solid var(--blue)">${esc(client.obiettivo)}</div></div>` : ''}
          ${client.note_preliminari ? `<div style="margin-top:10px"><div class="field-label">Note CRM</div><div style="font-size:13px;color:#6B7280">${esc(client.note_preliminari)}</div></div>` : ''}
          ${client.drive_url ? `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><a href="${esc(client.drive_url)}" target="_blank" style="font-size:13px;word-break:break-all">${esc(client.drive_url)}</a></div>` : ''}
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

    <h2 style="margin:20px 0 12px">Strumenti compilati dal cliente <span style="font-weight:400;font-size:13px;color:#aaa">(${sessions.length})</span></h2>
    ${sessionCards}
  </div>

  <!-- MODAL MODIFICA CLIENTE -->
  <div id="modal-edit" class="modal-overlay">
    <div class="modal-box">
      <h2 style="margin-bottom:16px">Modifica dati cliente</h2>
      <div class="form-group"><label>Nome e cognome *</label><input id="e-name" type="text" value="${attr(client.name)}"></div>
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
    function copyLink(url) { navigator.clipboard.writeText(url).then(() => { const t=document.getElementById('toast'); t.textContent='Link copiato!'; t.style.display='block'; setTimeout(()=>t.style.display='none',2000); }); }
    function openEdit() { document.getElementById('modal-edit').style.display='flex'; }
    async function saveClient() {
      const name = document.getElementById('e-name').value.trim();
      const err = document.getElementById('edit-error');
      if (!name) { err.textContent='Il nome è obbligatorio'; err.style.display='block'; return; }
      const payload = {
        name, email:document.getElementById('e-email').value, telefono:document.getElementById('e-tel').value,
        altro_recapito:document.getElementById('e-altro').value, social_tipo:document.getElementById('e-social-tipo').value,
        via:document.getElementById('e-via').value, cap:document.getElementById('e-cap').value,
        citta:document.getElementById('e-citta').value, provincia:document.getElementById('e-provincia').value,
        professione:document.getElementById('e-prof').value, data_nascita:document.getElementById('e-nascita').value||null,
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
      await fetch('/dashboard/clients/'+CID+'/percorsi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        tipo: document.getElementById('p-tipo').value,
        modalita: document.getElementById('p-modalita').value,
        ore_fatte: document.getElementById('p-ore').value || 0,
        prezzo: document.getElementById('p-prezzo').value || null,
        promo: document.getElementById('p-promo').checked,
        sconto_note: document.getElementById('p-sconto').value,
        data_inizio: document.getElementById('p-data').value || null,
      })});
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
    [document.getElementById('modal-edit'),document.getElementById('modal-percorso'),document.getElementById('modal-payment')].forEach(m=>{
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
          <select id="l-stato"><option value="nuovo">Nuovo</option><option value="contattato">Contattato</option><option value="call_fissata">Call fissata</option><option value="perso">Perso</option></select></div>
      </div>
      <div class="form-group"><label>Prossimo contatto</label><input id="l-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="l-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeLeadModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveLead()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
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
    async function convertLead(id) {
      if(!confirm('Convertire questo lead in cliente?')) return;
      const r = await fetch('/dashboard/leads/'+id+'/convert',{method:'POST',headers:{'Content-Type':'application/json'}});
      const d = await r.json();
      if (d.ok) location.href='/dashboard/clients/'+d.clientId;
    }
    async function deleteLead(id) {
      if(!confirm('Eliminare questo lead?')) return;
      await fetch('/dashboard/leads/'+id,{method:'DELETE'}); location.reload();
    }
    document.getElementById('modal-lead').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-lead')) closeLeadModal(); });
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
        { n:1, key:'accade_faccio',       q:'Cosa accade se lo faccio?' },
        { n:2, key:'accade_nonfaccio',    q:'Cosa accade se non lo faccio?' },
        { n:3, key:'nonaccade_faccio',    q:'Cosa non accade se lo faccio?' },
        { n:4, key:'nonaccade_nonfaccio', q:'Cosa non accade se non lo faccio?' }
      ];
      const chip = t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(t)}</span>`;
      const blocks = quads.map(qd => {
        const items = (d[qd.key] || []).map(c => c && c.text).filter(Boolean);
        return `<div style="margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#6B7280;display:inline-flex;align-items:center">
            <span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;background:#223B6E;color:#fff;font-size:10px;font-weight:700;margin-right:6px">${qd.n}</span>${qd.q}</span><br>
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
