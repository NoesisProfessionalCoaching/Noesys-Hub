// Accesso in LETTURA al Google Drive di Noesys (account consumer, OAuth).
// Le tre credenziali arrivano dalle variabili d'ambiente (impostate su Railway):
//   GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN
// Il refresh_token (a lunga vita) viene scambiato al volo con un access_token
// (a breve vita), tenuto in memoria e rinnovato solo quando scade. Nessuna
// credenziale è scritta nel codice o restituita al chiamante.
//
// Questo modulo è la base che poi userà l'automazione report → scheda:
// per ora espone solo funzioni di LETTURA (trova cartella, elenca file, scarica).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const NOESYS_ROOT_ID = '1zNO4d1FyUeLBq-Z2KXA9RFojeeDas5IT'; // radice "Noesys" (dal collegamento del 2026-07-09)

// Cache in memoria dell'access_token, con un margine di sicurezza prima della scadenza.
let cachedToken = null;
let cachedExpiry = 0;

function missingEnv() {
  return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']
    .filter(k => !process.env[k]);
}

async function getAccessToken() {
  const missing = missingEnv();
  if (missing.length) {
    throw new Error('Variabili Google mancanti: ' + missing.join(', '));
  }
  const now = Date.now();
  if (cachedToken && now < cachedExpiry) return cachedToken;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // data.error tipico: 'invalid_grant' (refresh_token errato/revocato) o
    // 'invalid_client' (client_id/secret incollati male). Utile in diagnosi.
    throw new Error('Rinnovo token fallito: ' + (data.error_description || data.error || res.status));
  }
  cachedToken = data.access_token;
  cachedExpiry = now + (data.expires_in - 60) * 1000; // rinnova 60s prima della scadenza reale
  return cachedToken;
}

// Chiamata autenticata all'API Drive. `endpoint` è il pezzo dopo /drive/v3 (es. '/files?...').
async function driveFetch(endpoint) {
  const token = await getAccessToken();
  const res = await fetch(DRIVE_API + endpoint, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error('Drive API ' + res.status + ': ' + (data.error?.message || 'errore'));
  }
  return data;
}

// Elenca i file/cartelle DENTRO una cartella (per id). Ordinati: prima le cartelle.
async function listChildren(folderId) {
  const q = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,modifiedTime)',
    orderBy: 'folder,name',
    pageSize: '100',
  });
  const data = await driveFetch('/files?' + params.toString());
  return data.files || [];
}

// Verifica di raggiungibilità della radice "Noesys" (usata dalla pagina di diagnosi).
async function findNoesysRoot() {
  const params = new URLSearchParams({
    q: "name = 'Noesys' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name)',
    pageSize: '5',
  });
  const data = await driveFetch('/files?' + params.toString());
  return (data.files || [])[0] || null;
}

const isFolder = f => f.mimeType === 'application/vnd.google-apps.folder';

module.exports = {
  NOESYS_ROOT_ID,
  missingEnv,
  getAccessToken,
  driveFetch,
  listChildren,
  findNoesysRoot,
  isFolder,
};
