// Collegamento OAuth a Google Drive (una tantum, per un account consumer).
// Legge .google-oauth.json (credenziali Desktop), fa consentire l'utente via
// loopback su 127.0.0.1, salva il refresh_token in .google-token.json e testa
// subito l'accesso al Drive. Nessuna credenziale è scritta nel codice.
const http = require('http');
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const cred = JSON.parse(readFileSync(path.join(__dirname, '..', '.google-oauth.json'), 'utf8'));
const c = cred.installed || cred.web;
if (!c || !c.client_id || !c.client_secret) { console.error('Credenziali non valide'); process.exit(1); }

const PORT = 4179;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: c.client_id,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
}).toString();

console.log('AUTH_URL::' + authUrl);
console.log('In attesa del consenso nel browser...');

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
    writeFileSync(path.join(__dirname, '..', '.google-token.json'),
      JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: tok.refresh_token }, null, 2));
    const q = "name = 'Noesys' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const list = await (await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q, fields: 'files(id,name)', pageSize: '5',
    }), { headers: { Authorization: 'Bearer ' + tok.access_token } })).json();
    res.end('Fatto! Puoi chiudere questa scheda e tornare alla chat.');
    console.log('RESULT::OK refresh_token salvato in .google-token.json');
    console.log('DRIVE_TEST::' + JSON.stringify(list.files || list));
    server.close(); setTimeout(() => process.exit(0), 200);
  } catch (e) {
    res.end('Errore nello scambio del token (vedi terminale).');
    console.error('RESULT::ERRORE ' + e.message); server.close(); process.exit(1);
  }
});
server.listen(PORT, '127.0.0.1');
