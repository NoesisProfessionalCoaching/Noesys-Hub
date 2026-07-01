const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('./db');
const { signToken, requireCoach, COOKIE_NAME } = require('./auth');

const router = express.Router();

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
// DASHBOARD (placeholder — lead/percorsi/pagamenti arrivano nelle fasi successive)
// ═══════════════════════════════════════════════════════

router.get('/dashboard', requireCoach, (req, res) => {
  res.send(dashboardPage(req));
});

router.get('/', (req, res) => res.redirect('/dashboard'));

module.exports = router;

// ═══════════════════════════════════════════════════════
// PAGINE (stile Noesys: Manrope + Fraunces, blu #1A5280)
// ═══════════════════════════════════════════════════════

function baseStyle() {
  return `<style>
    * { box-sizing: border-box; }
    body { font-family: 'Manrope', system-ui, -apple-system, sans-serif; background: #F4F6F8; color: #223B6E; margin: 0; }
    h1, h2 { font-family: 'Fraunces', Georgia, serif; color: #1A5280; }
    a { color: #1A5280; }
    .btn { display: inline-block; padding: 10px 18px; border-radius: 8px; border: none; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 14px; }
    .btn-primary { background: #1A5280; color: #fff; }
    .btn-neutral { background: #e8ecf1; color: #223B6E; }
    input { font-family: inherit; padding: 10px; border-radius: 6px; border: 1px solid #ccd3db; width: 100%; }
    .flash-error { background: #fde8e8; color: #a33; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 14px; }
  </style>`;
}

function appBar() {
  return `<div style="background:#1A5280;color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between">
    <strong style="font-family:'Fraunces',serif;font-size:18px">Noesys Hub</strong>
    <a href="/logout" class="btn btn-neutral btn-sm" style="padding:6px 14px">Esci</a>
  </div>`;
}

function loginPage(error) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">${baseStyle()}</head>
  <body>
    <div style="max-width:360px;margin:80px auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.08)">
      <h1 style="margin-top:0">Noesys Hub</h1>
      <p style="color:#6B7280;font-size:14px;margin-top:-8px">Accesso coach</p>
      ${error ? `<div class="flash-error">${error}</div>` : ''}
      <form method="POST" action="/login">
        <div style="margin-bottom:14px"><label>Username</label><input name="username" required></div>
        <div style="margin-bottom:18px"><label>Password</label><input name="password" type="password" required></div>
        <button class="btn btn-primary" style="width:100%" type="submit">Entra</button>
      </form>
    </div>
  </body></html>`;
}

function dashboardPage(req) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">${baseStyle()}</head>
  <body>
    ${appBar()}
    <div style="max-width:720px;margin:48px auto;padding:0 20px">
      <h1>Ciao, ${esc(req.coach.username)}</h1>
      <p style="color:#6B7280">Hub CRM in costruzione: lead, percorsi e pagamenti arrivano nelle prossime fasi.</p>
    </div>
  </body></html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
