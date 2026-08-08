// Automazione MODULI → anagrafica (07/08/2026).
// -----------------------------------------------------------------------------
// Il coach manda al cliente la scheda anagrafica (Mail 1) e il contratto (Mail 2);
// il cliente li rimanda compilati e il coach li salva nella cartella Drive del
// cliente, sotto "Documentazione". Da lì questa automazione:
//   1. dà ogni modulo a Claude, che lo GUARDA come lo guarderebbe una persona
//   2. ne scrive i dati in anagrafica — il modulo VINCE su quello che c'è
//      (Germano 07/08: «a breve l'obiettivo sarà usare solo le automazioni»)
//   3. dal contratto ricava se il cliente ha sottoscritto il CONSENSO al
//      trattamento dei dati, e con che DATA
//   4. elimina il modulo rimasto in bianco (quello inviato con la mail)
//
// ⚠️ Rifatto l'08/08 dopo il caso Giulio Sudano: il primo disegno leggeva le
// annotazioni del PDF e vedeva ZERO su documenti compilati in un altro modo,
// dichiarandoli vuoti — e dava per non consenziente un cliente che il consenso
// l'aveva dato. Un modulo PARZIALMENTE compilato non è un modulo vuoto.
// Perciò "compilato" non si decide più da come è fatto il file, ma da quello che
// se ne ricava. Vedi claude.leggiModuloPdf.
//
// Gira insieme all'automazione dei report, alle 07:00 / 15:00 / 23:00.
// Ogni modulo si elabora UNA volta sola (tabella `moduli_letti`), i moduli in
// bianco compresi: senza, ogni otto ore si riscriverebbe tutto daccapo e si
// richiederebbe a Claude di rileggere gli stessi documenti.
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const drive = require('./google-drive');
const claude = require('./claude');
const moduli = require('./moduli');

const PDF_MIME = 'application/pdf';
const MAX_PER_RUN = 10;   // rete di sicurezza, come per i report

const isPdf = f => f.mimeType === PDF_MIME || /\.pdf$/i.test(f.name || '');

// I campi che l'anagrafica accetta dai moduli, con la colonna corrispondente.
// `luogo_nascita` e i tre dati di fatturazione sono colonne nuove (vedi db.js).
const MAPPA = {
  data_nascita:   'data_nascita',
  luogo_nascita:  'luogo_nascita',
  via:            'via',
  citta:          'citta',
  provincia:      'provincia',
  cap:            'cap',
  telefono:       'telefono',
  email:          'email',
  professione:    'professione',
  societa:        'societa',
  codice_fiscale: 'codice_fiscale',
  pec:            'pec',
  codice_sdi:     'codice_sdi',
};

// I moduli di UN cliente, dalla sua cartella "Documentazione".
async function moduliDelCliente(clientFolderId) {
  const top = await drive.listChildren(clientFolderId);
  const docF = top.find(f => drive.isFolder(f) && /document/i.test(f.name));
  if (!docF) return [];
  const files = await drive.listChildren(docF.id);
  return files.filter(f => isPdf(f) && moduli.tipoDalNome(f.name))
              .map(f => ({ id: f.id, name: f.name, tipo: moduli.tipoDalNome(f.name), modifiedTime: f.modifiedTime }));
}

// Unione dei dati letti dai due moduli. Se un campo arriva da tutti e due vince
// la SCHEDA: è il modulo anagrafico, il cliente lo compila per esteso. Dal
// contratto arrivano soprattutto i dati di fatturazione, che sulla scheda non ci
// sono. (Curiosità utile: dal codice fiscale si ricava la data di nascita, e
// nella prova sui documenti di Giuliano le due fonti coincidevano.)
function unisci(daScheda, daContratto) {
  const out = {};
  for (const k of Object.keys(MAPPA)) {
    const v = (daScheda && daScheda[k]) || (daContratto && daContratto[k]) || null;
    if (v) out[k] = k === 'telefono' ? moduli.normalizzaTelefono(v) : v;
  }
  return out;
}

async function scanModuliClienti({ onlyClientId } = {}) {
  const out = { aggiornati: [], letti: 0, saltati: 0, eliminati: 0, clients: 0, errors: [] };
  if (drive.missingEnv().length || !claude.hasApiKey()) {
    out.errors.push({ dove: 'configurazione', errore: 'Google Drive o Claude non configurati' });
    return out;
  }

  const params = [];
  let sql = `SELECT id, name, nome, cognome, drive_url FROM clients WHERE drive_url IS NOT NULL AND drive_url <> ''`;
  if (onlyClientId) { sql += ` AND id = $1`; params.push(onlyClientId); }
  const clienti = (await db.query(sql, params)).rows;
  out.clients = clienti.length;

  for (const cl of clienti) {
    const folderId = drive.folderIdFromUrl(cl.drive_url);
    if (!folderId) continue;
    try {
      const trovati = await moduliDelCliente(folderId);
      if (!trovati.length) continue;

      // Chi è già stato letto non si rilegge.
      const giaLetti = new Set((await db.query(
        'SELECT file_id FROM moduli_letti WHERE client_id = $1', [cl.id])).rows.map(r => r.file_id));

      // Ogni modulo si legge dando il PDF a Claude: è l'unico modo che regge
      // TUTTI i modi di compilare (vedi claude.leggiModuloPdf). "Vuoto" non si
      // decide più guardando come è fatto il file, ma da quello che ne esce:
      // se non c'è dentro niente e nessuna firma, allora è il modulo in bianco.
      const compilati = [];
      const vuoti = [];
      let consenso = false, dataConsenso = null, comeRisulta = '';
      for (const f of trovati) {
        if (giaLetti.has(f.id)) { out.saltati++; continue; }
        if (out.letti >= MAX_PER_RUN) break;
        let letto;
        try {
          const buf = await drive.downloadFileBuffer(f.id);
          letto = await claude.leggiModuloPdf({ pdfBuffer: buf, tipoModulo: f.tipo, nomeCliente: cl.name });
          out.letti++;
        } catch (e) {
          out.errors.push({ cliente: cl.name, file: f.name, errore: 'lettura: ' + e.message });
          continue;
        }
        if (!letto.compilato && !letto.firmato) { vuoti.push({ ...f, letto }); continue; }
        compilati.push({ ...f, letto });
        if (f.tipo === 'contratto' && letto.consenso) {
          consenso = true;
          // La data del consenso è quella con cui il cliente ha sottoscritto la
          // clausola (Germano 08/08). Se sul documento non è scritta, si ripiega
          // sulla data in cui il file è stato messo su Drive: è comunque più
          // vicina al vero della data di oggi.
          dataConsenso = letto.dataConsenso || (f.modifiedTime ? String(f.modifiedTime).slice(0, 10) : null);
          comeRisulta = letto.comeRisulta;
        }
      }
      // I moduli in bianco si segnano SEMPRE, anche quando poi vengono
      // eliminati: se l'eliminazione non riuscisse, senza questa riga si
      // richiederebbe a Claude di rileggere lo stesso documento vuoto ogni
      // otto ore, per sempre.
      for (const v of vuoti) {
        await db.query(
          `INSERT INTO moduli_letti (id, client_id, file_id, nome_file, tipo, esito)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (file_id) DO NOTHING`,
          [uuidv4(), cl.id, v.id, v.name, v.tipo, 'in bianco']);
      }
      if (!compilati.length) continue;

      const daScheda = (compilati.find(m => m.tipo === 'scheda') || {}).letto?.campi || null;
      const daContratto = (compilati.find(m => m.tipo === 'contratto') || {}).letto?.campi || null;

      const campi = unisci(daScheda, daContratto);
      if (!Object.keys(campi).length && !consenso) continue;

      // Scrittura in anagrafica. Il modulo vince su quello che c'è già.
      const set = [], vals = [];
      for (const [k, col] of Object.entries(MAPPA)) {
        if (campi[k] == null) continue;
        vals.push(campi[k]); set.push(`${col} = $${vals.length}`);
      }
      if (consenso) {
        set.push('consenso_privacy = TRUE');
        if (dataConsenso) { vals.push(dataConsenso); set.push(`consenso_data = $${vals.length}`); }
        else set.push('consenso_data = COALESCE(consenso_data, CURRENT_DATE)');
      }
      if (set.length) {
        vals.push(cl.id);
        await db.query(`UPDATE clients SET ${set.join(', ')} WHERE id = $${vals.length}`, vals);
      }

      // Traccia: questi moduli sono stati elaborati.
      for (const m of compilati) {
        await db.query(
          `INSERT INTO moduli_letti (id, client_id, file_id, nome_file, tipo, esito)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (file_id) DO NOTHING`,
          [uuidv4(), cl.id, m.id, m.name, m.tipo, m.letto.consenso ? ('consenso: ' + (m.letto.comeRisulta || 'si')).slice(0, 300) : 'ok']);
      }

      // ⚠️ SOLO ORA il modulo vuoto si può eliminare: i dati sono già al sicuro
      // nel database. Si elimina il vuoto dello STESSO tipo che è stato compilato
      // (arrivata la scheda compilata, via la scheda vuota), mai altro.
      for (const v of vuoti) {
        if (!compilati.some(c => c.tipo === v.tipo)) continue;
        try {
          await drive.deleteFileForever(v.id);
          out.eliminati++;
        } catch (e) {
          out.errors.push({ cliente: cl.name, file: v.name, errore: 'eliminazione: ' + e.message });
        }
      }

      out.aggiornati.push({ cliente: cl.name, campi: Object.keys(campi), consenso, dataConsenso, comeRisulta });
    } catch (e) {
      out.errors.push({ cliente: cl.name, errore: e.message });
    }
  }
  return out;
}

module.exports = { scanModuliClienti, moduliDelCliente, unisci, MAPPA };
