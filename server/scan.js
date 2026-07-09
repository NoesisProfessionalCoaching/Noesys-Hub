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

// Nomi che NON sono report di sessione (stanno nelle stesse cartelle su Drive).
const NON_REPORT = /agenda|contratt|lettera|benvenut|consenso|privacy|anagrafica|profilo cliente|obiettivo|\bcard\b/i;

function isDocxReport(f) {
  const isDocx = f.mimeType === DOCX_MIME || /\.docx$/i.test(f.name || '');
  return isDocx && !NON_REPORT.test(f.name || '');
}

async function collectDocx(folderId, tipo, out) {
  const items = await drive.listChildren(folderId);
  for (const it of items) {
    if (drive.isFolder(it)) await collectDocx(it.id, tipo, out);
    else if (isDocxReport(it)) out.push({ id: it.id, name: it.name, tipo, modifiedTime: it.modifiedTime });
  }
}

// Report dentro una cartella-percorso: tipo = nome della sottocartella Intake/Ongoing/Final.
async function findReportsInPercorso(percorsoFolderId, out) {
  const subs = await drive.listChildren(percorsoFolderId);
  for (const s of subs) {
    if (!drive.isFolder(s)) continue;
    const tipo = TIPI.find(t => t.toLowerCase() === s.name.toLowerCase());
    if (tipo) await collectDocx(s.id, tipo, out);
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
function dataDaReport(rep) {
  if (!rep.modifiedTime) return null;
  return String(rep.modifiedTime).slice(0, 10); // YYYY-MM-DD
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
