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
      SELECT c.*, (SELECT COUNT(*) FROM sessions s WHERE s.client_id = c.id) as tool_count
      FROM clients c ORDER BY c.created_at DESC
    `);
    res.send(dashboardPage(result.rows, req));
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore nel caricamento dashboard');
  }
});

router.post('/dashboard/clients', requireCoach, express.json(), async (req, res) => {
  const { name, email, telefono, tipo_percorso, note_preliminari } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obbligatorio' });
  const id    = uuidv4();
  const token = uuidv4().replace(/-/g, '');
  try {
    await db.query(
      'INSERT INTO clients (id, name, email, telefono, tipo_percorso, note_preliminari, token) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, name.trim(), (email||'').trim(), (telefono||'').trim(), tipo_percorso||'Individuale', (note_preliminari||'').trim(), token]
    );
    res.json({ id, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore creazione cliente' });
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
    await db.query(
      'INSERT INTO clients (id,name,email,telefono,token) VALUES ($1,$2,$3,$4,$5)',
      [clientId, nome, lead.email||'', lead.telefono||'', token]
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
      input, select { width: 100%; padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 9px; font-size: 13px; font-family: inherit; color: var(--ink); outline: none; transition: border-color 0.15s, box-shadow 0.15s; background: #fff; }
      input:focus, select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(26,82,128,0.12); }
      label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 5px; }
      .form-group { margin-bottom: 14px; }
      h1 { font-size: 23px; font-weight: 800; color: var(--blue); letter-spacing: -0.01em; margin-bottom: 4px; }
      h2 { font-size: 16px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
      a { color: var(--blue); }
      .badge { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; }
      .badge-active   { background: #e7f1ec; color: #2e6b52; }
      .badge-inactive { background: #eef1f5; color: #7a8089; }
      .appbar { position: sticky; top: 0; z-index: 50; background: #fff; border-bottom: 1px solid var(--line); }
      .appbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 14px; max-width: 980px; margin: 0 auto; padding: 8px 18px; }
      .appbar-brand { display: flex; align-items: center; text-decoration: none; line-height: 0; }
      .appbar-actions { display: flex; align-items: center; gap: 10px; }
      .appbar-accent { height: 3px; background: var(--grad); }
      .appbar-link { color: var(--blue); text-decoration: none; font-size: 13px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); }
      td { padding: 13px 14px; border-bottom: 1px solid #f1f3f6; font-size: 13px; vertical-align: middle; }
      tr:last-child td { border-bottom: none; }
      .empty { text-align: center; color: var(--hint); font-style: italic; padding: 34px; font-size: 14px; }
      .flash-error { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; border-radius: 9px; padding: 11px 14px; margin-bottom: 16px; font-size: 13px; }
    </style>
  `;
}

function appBar({ home = '#', right = '' } = {}) {
  return `<header class="appbar"><div class="appbar-inner">
    <a class="appbar-brand" href="${home}" aria-label="Noesys">${logoCompact(52)}</a>
    <div class="appbar-actions">${right}</div>
  </div><div class="appbar-accent"></div></header>`;
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
    ? `<tr><td colspan="5" class="empty">Nessun cliente. Crea il primo con il pulsante qui sopra.</td></tr>`
    : clients.map(c => `
      <tr>
        <td><strong>${esc(c.name)}</strong>${c.email ? `<br><span style="color:#aaa;font-size:11px">${esc(c.email)}</span>` : ''}</td>
        <td><span class="badge ${c.active ? 'badge-active' : 'badge-inactive'}">${c.active ? 'Attivo' : 'Disattivato'}</span></td>
        <td style="color:#aaa;font-size:12px">${fmtDate(c.last_seen)}</td>
        <td style="font-size:12px">${c.tool_count} sessioni</td>
        <td style="white-space:nowrap">
          <button onclick="toggleClient('${c.id}')" class="btn btn-sm ${c.active ? 'btn-gold' : 'btn-primary'}" style="margin-right:4px">${c.active ? 'Disattiva' : 'Riattiva'}</button>
          <button onclick="copyLink('${PLATFORM_URL}/c/${c.token}')" class="btn btn-neutral btn-sm">🔗 Link strumenti</button>
        </td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Clienti</title>${baseStyle()}</head><body>
  ${appBar({ home: '/dashboard', right: `<a href="/dashboard/leads" class="btn btn-neutral btn-sm">Lead</a><a href="/logout" class="btn btn-neutral btn-sm">Esci</a>` })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>Clienti</h1><p style="color:#aaa;font-size:13px">${clients.length} clienti registrati</p></div>
      <button onclick="openNewClient()" class="btn btn-primary">+ Nuovo cliente</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Cliente</th><th>Stato</th><th>Ultimo accesso</th><th>Dati</th><th>Azioni</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>

  <div id="modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:100;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:28px;width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-height:90vh;overflow-y:auto">
      <h2 style="margin-bottom:16px">Nuovo cliente</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome *</label><input id="new-name" type="text" placeholder="es. Mario Rossi"></div>
        <div class="form-group"><label>Telefono</label><input id="new-tel" type="tel" placeholder="+39…"></div>
      </div>
      <div class="form-group"><label>Email</label><input id="new-email" type="email" placeholder="mario@esempio.it"></div>
      <div class="form-group"><label>Tipo percorso</label>
        <select id="new-tipo"><option>Individuale</option><option>Business</option><option>Young</option><option>Team</option><option>Group</option></select></div>
      <div class="form-group"><label>Note preliminari</label><input id="new-note" type="text" placeholder="opzionale"></div>
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
    function openNewClient() {
      document.getElementById('modal-overlay').style.display = 'flex';
      document.getElementById('new-result').style.display = 'none';
      document.getElementById('new-error').style.display = 'none';
      ['new-name','new-email','new-tel','new-note'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('btn-create').style.display = '';
      document.getElementById('new-name').focus();
    }
    function closeModal() {
      document.getElementById('modal-overlay').style.display = 'none';
      if (document.getElementById('new-result').style.display !== 'none') location.reload();
    }
    async function createClient() {
      const name  = document.getElementById('new-name').value.trim();
      const email = document.getElementById('new-email').value.trim();
      const errEl = document.getElementById('new-error');
      if (!name) { errEl.textContent = 'Il nome è obbligatorio'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';
      const res = await fetch('/dashboard/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        name, email,
        telefono: document.getElementById('new-tel').value.trim(),
        tipo_percorso: document.getElementById('new-tipo').value,
        note_preliminari: document.getElementById('new-note').value.trim(),
      }) });
      const data = await res.json();
      if (data.error) { errEl.textContent = data.error; errEl.style.display='block'; return; }
      const link = PLATFORM_URL + '/c/' + data.token;
      document.getElementById('new-link').href = link;
      document.getElementById('new-link').textContent = link;
      document.getElementById('new-result').style.display = 'block';
      document.getElementById('btn-create').style.display = 'none';
    }
    async function toggleClient(id) {
      await fetch('/dashboard/clients/'+id+'/toggle', {method:'POST'});
      location.reload();
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

function leadsPage(leads, req) {
  const STATO_CFG = {
    nuovo:       { label:'Nuovo',        bg:'#e8f4fd', color:'#1A5280' },
    contattato:  { label:'Contattato',   bg:'#fff8dc', color:'#7a5c00' },
    call_fissata:{ label:'Call fissata', bg:'#e7f1ec', color:'#2e6b52' },
    convertito:  { label:'Convertito',   bg:'#d1fae5', color:'#065f46' },
    perso:       { label:'Perso',        bg:'#fdf0ef', color:'#c0392b' },
  };
  const FONTE_CFG = {
    sito:'Sito', social:'Social', passaparola:'Passaparola', ebook:'E-book', calendly:'Calendly', altro:'Altro'
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
      <td style="font-size:12px;color:#aaa">${FONTE_CFG[l.fonte]||l.fonte}</td>
      <td style="font-size:12px;color:#aaa">${l.data_prossimo_contatto ? String(l.data_prossimo_contatto).slice(0,10) : '—'}</td>
      <td style="font-size:12px;color:#4a5568;max-width:180px">${esc(l.note||'')}</td>
      <td style="white-space:nowrap">
        <button onclick="editLead('${l.id}','${esc(l.nome)}','${esc(l.cognome||'')}','${esc(l.email||'')}','${esc(l.telefono||'')}','${l.fonte}','${l.stato}','${esc(l.note||'')}','${l.data_prossimo_contatto?String(l.data_prossimo_contatto).slice(0,10):''}')" class="btn btn-neutral btn-sm">Modifica</button>
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

  <div id="modal-lead" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:100;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:26px;width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-height:90vh;overflow-y:auto">
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
          <select id="l-fonte"><option value="sito">Sito</option><option value="social">Social</option><option value="passaparola">Passaparola</option><option value="ebook">E-book</option><option value="calendly">Calendly</option><option value="altro">Altro</option></select></div>
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
      if (d.ok) location.href='/dashboard';
    }
    async function deleteLead(id) {
      if(!confirm('Eliminare questo lead?')) return;
      await fetch('/dashboard/leads/'+id,{method:'DELETE'}); location.reload();
    }
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════

function fmtDate(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 16).replace('T', ' ');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
