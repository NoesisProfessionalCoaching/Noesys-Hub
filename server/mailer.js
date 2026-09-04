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

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function mailerReady() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SEND_REFRESH_TOKEN);
}

// ⭐ 4.3: lo scambio del token sta in google-token.js, in comune con Drive.
//    Il refresh token di Gmail è un altro (GMAIL_SEND_REFRESH_TOKEN): la cache è
//    per refresh token, quindi i due non si mescolano.
const { tokenGoogle } = require('./google-token');
async function getAccessToken() {
  if (!mailerReady()) {
    throw new Error('Invio email non configurato: manca il collegamento Gmail (GMAIL_SEND_REFRESH_TOKEN).');
  }
  return tokenGoogle({
    clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_SEND_REFRESH_TOKEN, etichetta: 'Gmail',
  });
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
  // ⏱ Fetta 2.3: un limite di tempo. Niente ritentativo: una mail ripetuta
  //    arriverebbe due volte, e non si annulla una mail.
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30000),
  });
  const d = await res.json();
  if (!res.ok) {
    throw new Error('Gmail API ' + res.status + ': ' + ((d.error && d.error.message) || JSON.stringify(d)));
  }
  return { id: d.id, threadId: d.threadId, accepted: [to] };
}

module.exports = { sendMail, mailerReady };
