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

// Crea (idempotente) l'albero cartelle di un PROGETTO e restituisce la sua cartella {id,url}.
// Struttura: Noesys/Progetti/{Committente – Titolo}/ con dentro una sottocartella per fase
// (Pre-Intake/Intake/Kick-Off/Final Open/Final). È dove il coach salva i report Zoom delle
// fasi; l'automazione li leggerà da qui (come Intake/Ongoing/Final per il cliente).
async function createProjectFolders({ committente, titolo }) {
  const label = [committente, titolo].map(s => (s || '').trim()).filter(Boolean).join(' – ');
  if (!label) throw new Error('Mancano committente/titolo: impossibile nominare la cartella del progetto');
  const progetti = await findOrCreateFolder(NOESYS_ROOT_ID, 'Progetti');
  const projF    = await findOrCreateFolder(progetti.id, label);
  for (const sub of ['Pre-Intake', 'Intake', 'Kick-Off', 'Final Open', 'Final']) {
    await findOrCreateFolder(projF.id, sub);
  }
  return { id: projF.id, url: folderUrl(projF.id) };
}

// Fetta B — crea (idempotente) la cartella del PERCORSO CONDIVISO (team/group) dentro
// la cartella del progetto: {Progetto}/Percorso {Team|Group}/{Intake,Ongoing,Final}.
// `projectFolderId` = id cartella progetto (dal suo drive_url). `tipoLabel` = 'Team'|'Group'
// (= percorsi.tipo del condiviso). È dove il coach salva i report Zoom delle sessioni di
// gruppo; l'automazione li leggerà da qui. Distinta dalle sottocartelle di FASE sponsor.
async function createPercorsoCondivisoFolders(projectFolderId, tipoLabel) {
  const label = 'Percorso ' + (String(tipoLabel || '').trim() || 'Gruppo');
  const percF = await findOrCreateFolder(projectFolderId, label);
  await findOrCreateFolder(percF.id, 'Intake');
  await findOrCreateFolder(percF.id, 'Ongoing');
  await findOrCreateFolder(percF.id, 'Final');
  return { id: percF.id, url: folderUrl(percF.id) };
}

// ── Modelli → Documentazione del cliente (creazione documentazione nuovo cliente) ──
// Nomi ESATTI dei documenti "uguali per tutti" da copiare nella Documentazione del
// nuovo cliente. DEVONO coincidere col nome reale del file dentro Noesys/Modelli
// (estensione compresa). Se un nome non combacia, il file viene segnalato come
// "mancante" e la copia NON fallisce (gli altri vengono copiati lo stesso).
const MODELLI_BASE = ['Scheda Anagrafica OK.pdf', 'Codice Etico ICF 2025.pdf'];

// Trova la cartella "Modelli" sotto la radice Noesys. null se non esiste.
async function findModelliFolder() {
  return findFolderByName(NOESYS_ROOT_ID, 'Modelli');
}

// Elenca i file dentro Modelli (diagnostica: verificare nomi esatti + raggiungibilità).
// null se la cartella Modelli non è raggiungibile.
async function listModelli() {
  const m = await findModelliFolder();
  if (!m) return null;
  return listChildren(m.id);
}

// Cerca UN file (non cartella) con nome esatto dentro `parentId`. null se non c'è.
async function findFileByName(parentId, name) {
  const q = `'${parentId}' in parents and name = '${escapeQ(name)}' `
          + `and mimeType != '${FOLDER_MIME}' and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name,mimeType)', pageSize: '5' });
  const data = await driveFetch('/files?' + params.toString());
  return (data.files || [])[0] || null;
}

// Copia un file dentro una cartella di destinazione, col suo stesso nome.
// IDEMPOTENTE: se in destinazione c'è già un file con quel nome, NON ricopia
// (così un secondo percorso dello stesso cliente non duplica i documenti).
// Restituisce { id, name, skipped }.
async function copyFileToFolder(fileId, targetFolderId, name) {
  const existing = await findFileByName(targetFolderId, name);
  if (existing) return { id: existing.id, name, skipped: true };
  const data = await driveFetchPost('/files/' + fileId + '/copy?fields=id,name',
    { name, parents: [targetFolderId] });
  return { id: data.id, name: data.name, skipped: false };
}

// Copia i documenti-modello "uguali per tutti" (MODELLI_BASE) da Noesys/Modelli alla
// cartella Documentazione del cliente. `clientFolderId` = id cartella cliente (da drive_url).
// Non fallisce se un modello non c'è: lo elenca in `mancanti`. Restituisce
// { copiati:[nomi], saltati:[nomi già presenti], mancanti:[nomi non trovati in Modelli] }.
async function copiaModelliBase(clientFolderId) {
  const out = { copiati: [], saltati: [], mancanti: [] };
  const modelli = await findModelliFolder();
  if (!modelli) throw new Error('Cartella "Modelli" non trovata sotto la radice Noesys');
  const docFolder = await findOrCreateFolder(clientFolderId, 'Documentazione');
  for (const nome of MODELLI_BASE) {
    const src = await findFileByName(modelli.id, nome);
    if (!src) { out.mancanti.push(nome); continue; }
    const r = await copyFileToFolder(src.id, docFolder.id, nome);
    (r.skipped ? out.saltati : out.copiati).push(nome);
  }
  return out;
}

// Carica un file (byte grezzi) DENTRO una cartella di destinazione, via upload multipart.
// IDEMPOTENTE sul nome: se in destinazione c'è già un file con quel nome, NON ricarica
// (restituisce quello esistente con skipped:true). Usato per la lettera generata.
async function uploadFileToFolder(name, mimeType, buffer, targetFolderId) {
  const existing = await findFileByName(targetFolderId, name);
  if (existing) return { id: existing.id, name, skipped: true };
  const token = await getAccessToken();
  const boundary = 'noesys' + Date.now();
  const meta = JSON.stringify({ name, parents: [targetFolderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.from(buffer),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Upload Drive ' + res.status + ': ' + (data.error?.message || 'errore'));
  return { id: data.id, name: data.name, skipped: false };
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
  createProjectFolders,
  createPercorsoCondivisoFolders,
  MODELLI_BASE,
  findModelliFolder,
  listModelli,
  findFileByName,
  copyFileToFolder,
  copiaModelliBase,
  uploadFileToFolder,
};
