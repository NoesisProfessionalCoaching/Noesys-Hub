// Automazione report → scheda (sostituto di Cowork).
// Per ogni cliente che ha un drive_url nell'Hub: scorre le cartelle-percorso su
// Drive (Intake/Ongoing/Final), trova i report Word NUOVI, ne estrae il testo,
// chiede a Claude la scheda nel formato standard e crea una seduta in BOZZA.
// Le bozze NON contano le ore ICF finché il coach non le approva.
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const db = require('./db');
const drive = require('./google-drive');
const claude = require('./claude');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TIPI = ['Intake', 'Ongoing', 'Final'];
const MAX_PER_RUN = 20; // rete di sicurezza contro backfill accidentali

// Whitelist per i report di sessione: il file deve iniziare con "Report" (case-insensitive).
// Convenzione con Germano: ogni report va nominato "Report ..." (es. "Report Intake",
// "Report 12 giugno '26.docx"). Tutto il resto (agende, contratti, appunti, PNG, ecc.)
// viene ignorato automaticamente.
const IS_REPORT = /^report\b/i;

function isDocxReport(f) {
  const isDocx = f.mimeType === DOCX_MIME || /\.docx$/i.test(f.name || '');
  return isDocx && IS_REPORT.test(f.name || '');
}

// `folderName` è il nome della cartella diretta che contiene il file — serve a estrarre
// la data della seduta quando le cartelle-data sono nominate `YYYY-MM-DD`.
async function collectDocx(folderId, tipo, out, folderName) {
  const items = await drive.listChildren(folderId);
  for (const it of items) {
    if (drive.isFolder(it)) await collectDocx(it.id, tipo, out, it.name);
    else if (isDocxReport(it)) out.push({ id: it.id, name: it.name, tipo, modifiedTime: it.modifiedTime, folderName });
  }
}

// Report dentro una cartella-percorso: tipo = nome della sottocartella Intake/Ongoing/Final.
async function findReportsInPercorso(percorsoFolderId, out) {
  const subs = await drive.listChildren(percorsoFolderId);
  for (const s of subs) {
    if (!drive.isFolder(s)) continue;
    const tipo = TIPI.find(t => t.toLowerCase() === s.name.toLowerCase());
    if (tipo) await collectDocx(s.id, tipo, out, s.name);
  }
}

async function reportsForClient(folderId) {
  const out = [];
  const top = await drive.listChildren(folderId);
  const percorsiFolder = top.find(f => drive.isFolder(f) && f.name.toLowerCase() === 'percorsi');
  if (percorsiFolder) {
    const percorsi = await drive.listChildren(percorsiFolder.id);
    for (const p of percorsi) if (drive.isFolder(p)) await findReportsInPercorso(p.id, out);
  } else {
    // struttura semplificata: Intake/Ongoing/Final direttamente sotto la cartella cliente
    await findReportsInPercorso(folderId, out);
  }
  return out;
}

function oreDefault(tipo) { return tipo === 'Intake' ? 2 : tipo === 'Ongoing' ? 1 : 0; }

// Data della seduta con questa priorità:
// 1. Data italiana estratta dal nome del file (es. "Report 12 giugno '26.docx" → 2026-06-12)
// 2. Nome della cartella diretta se è già in ISO (es. Ongoing/2026-05-04/Report.docx → 2026-05-04)
// 3. Fallback: modifiedTime del file (data ultima modifica su Drive)
// Fix del 2026-07-10: la vecchia versione usava sempre modifiedTime, sballando
// le date perché il coach rivede i report giorni dopo la sessione reale.
const MESI_IT = { gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6, luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12 };
function dataDalNome(name) {
  if (!name) return null;
  // "12 giugno '26" · "12 giugno 2026" · "6 luglio '26"
  const m = name.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+['’]?(\d{4}|\d{2})/i);
  if (!m) return null;
  const giorno = parseInt(m[1], 10);
  const mese = MESI_IT[m[2].toLowerCase()];
  let anno = parseInt(m[3], 10);
  if (anno < 100) anno += 2000;
  if (!giorno || !mese || !anno || giorno < 1 || giorno > 31) return null;
  return `${anno}-${String(mese).padStart(2,'0')}-${String(giorno).padStart(2,'0')}`;
}
function dataDaReport(rep) {
  const dNome = dataDalNome(rep.name);
  if (dNome) return dNome;
  if (rep.folderName && /^\d{4}-\d{2}-\d{2}$/.test(rep.folderName)) return rep.folderName;
  if (rep.modifiedTime) return String(rep.modifiedTime).slice(0, 10);
  return null;
}

// Contesto: gli strumenti compilati dal cliente, in formato dati (Claude legge il JSON).
async function buildStrumentiText(clientId) {
  const r = await db.query(
    'SELECT tool, data, created_at FROM sessions WHERE client_id=$1 ORDER BY tool, created_at DESC', [clientId]);
  if (!r.rows.length) return '';
  return r.rows.slice(0, 20).map(s => {
    let d = s.data || '';
    if (d.length > 1500) d = d.slice(0, 1500) + '…(troncato)';
    const when = s.created_at ? new Date(s.created_at).toISOString().slice(0, 10) : '';
    return `### ${s.tool}${when ? ` (${when})` : ''}\n${d}`;
  }).join('\n\n');
}

// Esegue una passata. `onlyClientId` limita a un cliente (utile per i test).
async function scanClientReports({ onlyClientId } = {}) {
  const result = { clients: 0, processed: [], skipped: 0, errors: [] };

  const missing = drive.missingEnv();
  if (missing.length) throw new Error('Chiavi Google mancanti: ' + missing.join(', '));
  if (!claude.hasApiKey()) throw new Error('ANTHROPIC_API_KEY mancante su Railway');

  const cq = onlyClientId
    ? await db.query("SELECT * FROM clients WHERE id=$1 AND COALESCE(drive_url,'')<>''", [onlyClientId])
    : await db.query("SELECT * FROM clients WHERE COALESCE(drive_url,'')<>''");

  // impronte già lavorate (idempotenza)
  const doneq = await db.query('SELECT source_file_id FROM sedute WHERE source_file_id IS NOT NULL');
  const done = new Set(doneq.rows.map(r => r.source_file_id));
  let budget = MAX_PER_RUN;

  for (const cliente of cq.rows) {
    result.clients++;
    const folderId = drive.folderIdFromUrl(cliente.drive_url);
    if (!folderId) { result.errors.push({ cliente: cliente.name, err: 'link Drive non valido' }); continue; }

    const pq = await db.query(
      "SELECT * FROM percorsi WHERE client_id=$1 ORDER BY (stato='attivo') DESC, created_at DESC LIMIT 1",
      [cliente.id]);
    const percorso = pq.rows[0];
    if (!percorso) { result.errors.push({ cliente: cliente.name, err: 'nessun percorso nell\'Hub' }); continue; }

    let reports;
    try { reports = await reportsForClient(folderId); }
    catch (e) { result.errors.push({ cliente: cliente.name, err: 'lettura Drive: ' + e.message }); continue; }

    const nuovi = reports.filter(r => !done.has(r.id));
    if (!nuovi.length) { result.skipped += reports.length; continue; }

    const strumentiText = await buildStrumentiText(cliente.id);

    for (const rep of nuovi) {
      if (budget <= 0) { result.errors.push({ cliente: cliente.name, file: rep.name, err: 'limite per passata raggiunto' }); break; }
      budget--;
      try {
        const buf = await drive.downloadFileBuffer(rep.id);
        const { value: reportText } = await mammoth.extractRawText({ buffer: buf });
        if (!reportText || !reportText.trim()) throw new Error('Word vuoto o illeggibile');
        const riga = await claude.generaRiga({ tipo: rep.tipo, cliente, reportText, strumentiText });
        const sid = uuidv4();
        await db.query(
          `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, obiettivo, argomenti, attivita, scadenza, eseguita, note, stato, origine, source_file_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'bozza','auto',$13)`,
          [sid, percorso.id, cliente.id, rep.tipo, dataDaReport(rep), oreDefault(rep.tipo),
           riga.obiettivo, riga.argomenti, riga.attivita, riga.scadenza, riga.eseguita, riga.note, rep.id]);
        done.add(rep.id);
        result.processed.push({ cliente: cliente.name, tipo: rep.tipo, file: rep.name, sid });
      } catch (e) {
        result.errors.push({ cliente: cliente.name, file: rep.name, err: e.message });
      }
    }
  }
  return result;
}

module.exports = { scanClientReports };
