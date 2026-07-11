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

// Come driveFetch ma in POST con corpo JSON (per creare cartelle: SCRITTURA).
async function driveFetchPost(endpoint, body) {
  const token = await getAccessToken();
  const res = await fetch(DRIVE_API + endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Escapa apici e backslash per infilare un nome dentro una query Drive (q=...).
function escapeQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Cerca UNA cartella con nome esatto dentro `parentId`. null se non c'è.
async function findFolderByName(parentId, name) {
  const q = `'${parentId}' in parents and name = '${escapeQ(name)}' `
          + `and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5' });
  const data = await driveFetch('/files?' + params.toString());
  return (data.files || [])[0] || null;
}

// Crea una cartella `name` dentro `parentId` e ne restituisce {id,name}. SCRITTURA.
async function createFolder(parentId, name) {
  return driveFetchPost('/files?fields=id,name', {
    name,
    mimeType: FOLDER_MIME,
    parents: [parentId],
  });
}

// Idempotente: se la cartella esiste già la riusa, altrimenti la crea.
// Evita i doppioni (Drive permette due cartelle con lo stesso nome nello stesso posto).
async function findOrCreateFolder(parentId, name) {
  const found = await findFolderByName(parentId, name);
  if (found) return found;
  return createFolder(parentId, name);
}

// Link web di una cartella, dal suo id (da salvare nel campo drive_url).
function folderUrl(id) {
  return 'https://drive.google.com/drive/folders/' + id;
}

const AREE_VALIDE = ['Personal', 'Business', 'Young'];

// Crea (idempotente) l'albero cartelle di un cliente e restituisce la SUA cartella {id,url}.
// Struttura: Noesys/Clienti/{Area}/{Cognome Nome}/ con dentro Documentazione/ e Percorsi/.
// Se le cartelle esistono già le riusa (nessun doppione).
async function createClientFolders({ area, cognome, nome }) {
  const areaSafe = AREE_VALIDE.includes(area) ? area : 'Personal';
  const label = [cognome, nome].map(s => (s || '').trim()).filter(Boolean).join(' ');
  if (!label) throw new Error('Manca il cognome del cliente: impossibile nominare la cartella');
  const clienti = await findOrCreateFolder(NOESYS_ROOT_ID, 'Clienti');
  const areaF   = await findOrCreateFolder(clienti.id, areaSafe);
  const clientF = await findOrCreateFolder(areaF.id, label);
  await findOrCreateFolder(clientF.id, 'Documentazione');
  await findOrCreateFolder(clientF.id, 'Percorsi');
  return { id: clientF.id, url: folderUrl(clientF.id) };
}

// Crea (idempotente) le cartelle di UN percorso dentro la cartella del cliente:
// Percorsi/{folderName}/{Intake,Ongoing,Final}. `clientFolderId` = id della cartella cliente
// (dal suo drive_url). `folderName` = data inizio già formattata (es. "11-07-2026").
async function createPercorsoFolders(clientFolderId, folderName) {
  if (!folderName) throw new Error('Manca la data d\'inizio del percorso: impossibile nominare la cartella');
  const percorsi = await findOrCreateFolder(clientFolderId, 'Percorsi');
  const percF    = await findOrCreateFolder(percorsi.id, folderName);
  await findOrCreateFolder(percF.id, 'Intake');
  await findOrCreateFolder(percF.id, 'Ongoing');
  await findOrCreateFolder(percF.id, 'Final');
  return { id: percF.id, url: folderUrl(percF.id) };
}

// Scarica i BYTE grezzi di un file (es. un .docx) per estrarne poi il testo.
async function downloadFileBuffer(fileId) {
  const token = await getAccessToken();
  const res = await fetch(DRIVE_API + '/files/' + fileId + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Download Drive ' + res.status + ': ' + t.slice(0, 200));
  }
  return Buffer.from(await res.arrayBuffer());
}

// Estrae l'id-cartella da un link Drive incollato nell'Hub (campo drive_url).
// Accetta ".../folders/<id>", "?id=<id>" o direttamente un id nudo.
function folderIdFromUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  let m = s.match(/\/folders\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s; // id nudo
  return null;
}

module.exports = {
  NOESYS_ROOT_ID,
  missingEnv,
  getAccessToken,
  driveFetch,
  listChildren,
  findNoesysRoot,
  isFolder,
  downloadFileBuffer,
  folderIdFromUrl,
  findFolderByName,
  createFolder,
  findOrCreateFolder,
  folderUrl,
  createClientFolders,
  createPercorsoFolders,
};
