// Collegamento OAuth per l'INVIO email via Gmail API (una tantum).
// Serve perché Railway blocca l'SMTP: si manda via HTTPS con la Gmail API, che
// richiede un refresh token con scope gmail.send dell'account MITTENTE
// (noesys.professionalcoaching@gmail.com, lo stesso del Drive Noesys).
//
// Cosa fa: legge le credenziali Desktop da .google-oauth.json, fa consentire
// l'utente via loopback su 127.0.0.1, ottiene il refresh_token, lo salva in
// .gmail-token.json E lo imposta su Railway (GMAIL_SEND_REFRESH_TOKEN) via stdin
// (il segreto non viene mai stampato). Poi basta ridistribuire l'Hub.
const http = require('http');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const cred = JSON.parse(readFileSync(path.join(__dirname, '..', '.google-oauth.json'), 'utf8'));
const c = cred.installed || cred.web;
if (!c || !c.client_id || !c.client_secret) { console.error('Credenziali non valide'); process.exit(1); }

const PORT = 4180;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: c.client_id,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  login_hint: 'noesys.professionalcoaching@gmail.com',
}).toString();

console.log('AUTH_URL::' + authUrl);
console.log('In attesa del consenso nel browser...');

// Imposta la variabile su Railway passando il valore via stdin (non compare mai
// negli argomenti né a video). Richiede la CLI railway loggata e il progetto linkato.
function setRailwayVar(name, value) {
  return new Promise((resolve, reject) => {
    const p = spawn('railway', ['variable', 'set', name, '--stdin', '-s', 'Noesys-Hub', '--skip-deploys'],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error('railway uscito con codice ' + code)));
    p.stdin.write(value);
    p.stdin.end();
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err) { res.end('Errore: ' + err); console.error('RESULT::ERRORE consenso negato: ' + err); server.close(); process.exit(1); }
  if (!code) { res.end('In attesa...'); return; }
  try {
    const tok = await (await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: c.client_id, client_secret: c.client_secret,
        redirect_uri: REDIRECT, grant_type: 'authorization_code',
      }),
    })).json();
    if (!tok.refresh_token) throw new Error('Nessun refresh_token: ' + JSON.stringify(tok));
    writeFileSync(path.join(__dirname, '..', '.gmail-token.json'),
      JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: tok.refresh_token }, null, 2));
    res.end('Fatto! Puoi chiudere questa scheda e tornare alla chat.');
    console.log('RESULT::OK refresh_token gmail.send salvato in .gmail-token.json');
    // Prova a impostarlo direttamente su Railway (se la CLI è pronta).
    try {
      await setRailwayVar('GMAIL_SEND_REFRESH_TOKEN', tok.refresh_token);
      console.log('RAILWAY::OK GMAIL_SEND_REFRESH_TOKEN impostata su Noesys-Hub');
    } catch (e) {
      console.log('RAILWAY::FALLITO (' + e.message + ') — imposta la var a mano da .gmail-token.json');
    }
    server.close(); setTimeout(() => process.exit(0), 200);
  } catch (e) {
    res.end('Errore nello scambio del token (vedi terminale).');
    console.error('RESULT::ERRORE ' + e.message); server.close(); process.exit(1);
  }
});
server.listen(PORT, '127.0.0.1');
