// Invio email dall'Hub (Fetta 1c — Mail 1 di benvenuto al nuovo cliente).
// Usa Gmail via nodemailer con una "password per app" (GMAIL_USER/GMAIL_PASS,
// già impostate su Railway). Stessa tecnica dell'app strumenti, che funziona.
// L'Hub NON invia da solo: la rotta di invio è azionata dal coach dal pannello
// "Rivedi e invia" nella scheda cliente.

const nodemailer = require('nodemailer');

function mailerReady() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
}

function getTransport() {
  if (!mailerReady()) {
    throw new Error('Invio email non configurato (GMAIL_USER / GMAIL_PASS mancanti su Railway).');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}

// Invia una mail. `attachments` = [{ filename, content(Buffer), contentType }].
// Restituisce l'info di nodemailer (messageId, ecc.).
async function sendMail({ to, subject, text, attachments }) {
  const from = '"Noesys Professional Coaching" <' + process.env.GMAIL_USER + '>';
  return getTransport().sendMail({ from, to, subject, text, attachments: attachments || [] });
}

module.exports = { sendMail, mailerReady };
