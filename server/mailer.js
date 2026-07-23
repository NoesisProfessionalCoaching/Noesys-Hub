// Invio email dall'Hub (Fetta 1c — Mail 1 di benvenuto al nuovo cliente).
//
// ⚠️ Railway BLOCCA l'SMTP in uscita su tutte le porte (465/587/2525 → timeout;
// verificato dal container il 23/07). Quindi NON si usa nodemailer/SMTP: si manda
// via **Gmail API su HTTPS** (porta 443, che Railway lascia passare).
//
// Autenticazione: OAuth dell'account mittente noesys.professionalcoaching@gmail.com
// (lo stesso che possiede il Drive Noesys). Env su Railway:
//   GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET  (riusati dal client OAuth di Drive)
//   GMAIL_SEND_REFRESH_TOKEN                 (scope gmail.send, ottenuto con scripts/gmail-auth.js)
//   GMAIL_USER                               (indirizzo mittente, già presente)
// Il messaggio MIME (con allegati) è costruito con MailComposer di nodemailer e
// inviato come raw base64url all'endpoint messages/send.

const MailComposer = require('nodemailer/lib/mail-composer');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function mailerReady() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SEND_REFRESH_TOKEN);
}

let cachedToken = null;
let cachedExpiry = 0;

async function getAccessToken() {
  if (!mailerReady()) {
    throw new Error('Invio email non configurato: manca il collegamento Gmail (GMAIL_SEND_REFRESH_TOKEN).');
  }
  const now = Date.now();
  if (cachedToken && now < cachedExpiry) return cachedToken;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_SEND_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await res.json();
  if (!res.ok || !d.access_token) {
    throw new Error('Rinnovo token Gmail fallito: ' + (d.error_description || d.error || res.status));
  }
  cachedToken = d.access_token;
  cachedExpiry = now + (d.expires_in - 60) * 1000;
  return cachedToken;
}

// Costruisce il messaggio MIME completo (RFC822) con eventuali allegati.
function buildRaw({ from, to, subject, text, attachments }) {
  return new Promise((resolve, reject) => {
    new MailComposer({ from, to, subject, text, attachments: attachments || [] })
      .compile().build((err, msg) => (err ? reject(err) : resolve(msg)));
  });
}

// Invia una mail via Gmail API. `attachments` = [{ filename, content(Buffer), contentType }].
async function sendMail({ to, subject, text, attachments }) {
  const mittente = process.env.GMAIL_USER || 'noesys.professionalcoaching@gmail.com';
  const from = '"Noesys Professional Coaching" <' + mittente + '>';
  const rawBuf = await buildRaw({ from, to, subject, text, attachments });
  const raw = rawBuf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = await getAccessToken();
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const d = await res.json();
  if (!res.ok) {
    throw new Error('Gmail API ' + res.status + ': ' + ((d.error && d.error.message) || JSON.stringify(d)));
  }
  return { id: d.id, threadId: d.threadId, accepted: [to] };
}

module.exports = { sendMail, mailerReady };
