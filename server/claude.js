// Estrazione di UNA riga della "Scheda Cliente" dal report di sessione (+ strumenti).
// La Scheda Cliente è una tabella con una riga per sessione (modello storico Cowork):
// data · sessione · OBIETTIVO · ARGOMENTI · ATTIVITÀ · SCADENZA · ESEGUITA · NOTE.
// Qui estraiamo i campi di contenuto (piu' l'ora del prossimo appuntamento, che serve
// al promemoria in home); data e tipo li mette lo scanner.
//
// Modello: Opus 4.8, output strutturato (JSON), niente thinking (estrazione: veloce ed economica).
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

function hasApiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = `Sei l'assistente di un coach professionista (Noesys). Dal report di UNA sessione di coaching (riassunto Zoom, già rivisto dal coach) e, se presenti, dagli output degli strumenti, ESTRAI i campi di UNA riga della "Scheda Cliente". Solo i campi, nessuna prosa introduttiva.

Regole ferme (rispettale alla lettera):
- Attieniti ai fatti del materiale. NON inventare. Campo assente → "—".
- ⛔ Riporta solo ciò che il report dichiara. NON dedurre, NON descrivere e NON valutare lo stato emotivo o psicologico della persona, né le sue caratteristiche: nessuno strumento di questo coach analizza o deduce come sta una persona. Se il coach ha scritto un tema, riporta il tema con le sue parole; non aggiungere letture tue su come la persona lo vive.
- obiettivo: UNA frase (massimo due), sintetica. Niente descrizioni, elenchi di valori o considerazioni in più.
    · INTAKE → l'obiettivo di PERCORSO definito in sessione (in forma SMART se emerge).
    · ONGOING → l'obiettivo di QUELLA sessione (comunicato con l'agenda, reso SMART a inizio seduta).
    · FINAL → l'obiettivo o il bilancio di chiusura.
- argomenti: ELENCO PUNTATO. Un punto per riga, ogni riga inizia con "- ". Punti brevi.
- attivita: ELENCO PUNTATO, un punto per riga con "- ". Se un'attività è di una persona precisa, inizia col nome in grassetto: "- **Nome:** ...".
- scadenza: una DATA in formato AAAA-MM-GG. Di norma è la data della sessione SUCCESSIVA, che il report indica in chiusura (es. "prossimo appuntamento 21 luglio" → 2026-07-21). Se il report indica una scadenza diversa per le attività, usa quella. Se nel report non c'è nessuna data, "—".
- ora: l'ORARIO di inizio del prossimo appuntamento, formato HH:MM (24 ore). Sta nella stessa frase di chiusura della scadenza, ma non sempre con le stesse parole: "prossimo appuntamento giovedì 30 luglio ore 15:00" → "15:00"; "prima sessione ongoing fissata per lunedì 10 agosto, dalle 11:00 alle 12:00" → "11:00" (l'INIZIO); "martedì 11 ore 17:00-18:00, poi cadenza bisettimanale il lunedì 14:00" → "17:00" (il PRIMO appuntamento, non la cadenza futura). Se il report non dà l'orario del prossimo appuntamento, "—". Non dedurlo dall'orario di QUESTA sessione.
- eseguita: "✓" se il report dice che le attività assegnate in precedenza sono state svolte, "✗" se non svolte, "—" se non applicabile (tipicamente una sessione nuova).
- note: le conclusioni/considerazioni del COACH, riportando FEDELMENTE eventuali "Note conclusive del coach" (tra virgolette come nel report); più eventuali dati utili (prossimo appuntamento, spunti). Testo scorrevole e conciso.

Esempio di STILE (imita il formato, non il contenuto):
  obiettivo: "Individuare due modi concreti per chiedere aiuto ai genitori con serenità."
  argomenti: "- Difficoltà a chiedere aiuto\n- Cosa rende difficile chiederlo: autonomia, non disturbare\n- Differenze di abitudini con i genitori"
  attivita: "- **Cliente:** individuare un supporto specifico da chiedere\n- Allenarsi a rispondere con calma agli aiuti non richiesti"
  scadenza: "2026-07-21"
  ora: "15:00"
  eseguita: "—"
  note: "Note conclusive del coach: \"...\". Prossimo appuntamento 21/07 ore 15:00."

Italiano. Rispondi SOLO con l'oggetto JSON richiesto.`;

const SCHEMA = {
  type: 'object',
  properties: {
    obiettivo: { type: 'string' },
    argomenti: { type: 'string' },
    attivita:  { type: 'string' },
    scadenza:  { type: 'string' },
    ora:       { type: 'string' },
    eseguita:  { type: 'string' },
    note:      { type: 'string' },
  },
  required: ['obiettivo', 'argomenti', 'attivita', 'scadenza', 'ora', 'eseguita', 'note'],
  additionalProperties: false,
};

function parseJsonLoose(txt) {
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(txt.slice(s, e + 1)); } catch (_) {} }
  return null;
}

async function generaRiga({ tipo, cliente, reportText, strumentiText }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata su Railway');
  const client = new Anthropic();

  const c = cliente || {};
  const intestazione = [
    `Cliente: ${c.name || '(sconosciuto)'}`,
    c.area ? `Area: ${c.area}` : null,
    c.obiettivo ? `Obiettivo dichiarato a CRM: ${c.obiettivo}` : null,
    `Tipo di sessione: ${tipo}`,
  ].filter(Boolean).join('\n');

  const user =
`${intestazione}

=== REPORT DELLA SESSIONE (fonte principale) ===
${(reportText || '').trim() || '(report vuoto)'}

=== OUTPUT DEGLI STRUMENTI (contesto, in formato dati) ===
${(strumentiText || '').trim() || '(nessuno strumento disponibile)'}

Estrai i 7 campi della riga (obiettivo, argomenti, attivita, scadenza, ora, eseguita, note) secondo le regole. Rispondi SOLO con l'oggetto JSON.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (riga non generata)');
  }
  const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const data = parseJsonLoose(txt);
  if (!data) throw new Error('Risposta non in formato atteso (stop_reason: ' + resp.stop_reason + '): ' + txt.slice(0, 160));

  // Normalizza: stringhe, default "—".
  const pick = k => { const v = data[k]; return (v == null || String(v).trim() === '') ? '—' : String(v).trim(); };
  return {
    obiettivo: pick('obiettivo'),
    argomenti: pick('argomenti'),
    attivita:  pick('attivita'),
    scadenza:  pick('scadenza'),
    ora:       pick('ora'),
    eseguita:  pick('eseguita'),
    note:      pick('note'),
  };
}

// ═══════════════════════════════════════════════════════
// Fetta B (sessioni COLLETTIVE team/group): stessa Scheda Cliente (stessi campi e stesse
// regole), ma la sessione è di GRUPPO. Obiettivo e attività sono COMUNI; i contributi dei
// singoli vanno citati per NOME. Passiamo l'elenco partecipanti così l'estrazione attribuisce.
// ═══════════════════════════════════════════════════════
async function generaRigaCollettiva({ tipo, percorsoTipo, partecipanti, reportText }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata su Railway');
  const client = new Anthropic();

  const nomi = (partecipanti || []).filter(Boolean);
  const intestazione = [
    `Sessione di coaching COLLETTIVA (${percorsoTipo || 'gruppo'}): più partecipanti nella stessa stanza.`,
    nomi.length ? `Partecipanti: ${nomi.join(', ')}.` : null,
    `Tipo di sessione: ${tipo}`,
  ].filter(Boolean).join('\n');

  const user =
`${intestazione}

=== REPORT DELLA SESSIONE (fonte principale) ===
${(reportText || '').trim() || '(report vuoto)'}

Questa è una sessione COLLETTIVA: l'obiettivo e le attività sono COMUNI al gruppo. Quando un intervento, un contributo o un'attività riguarda una persona PRECISA tra i partecipanti, CITALA per nome (in argomenti/attivita/note usa "**Nome:** ..." oppure "(Nome)"). Non attribuire a nessuno ciò che è del gruppo. Estrai i 7 campi (obiettivo, argomenti, attivita, scadenza, ora, eseguita, note) secondo le regole. Rispondi SOLO con l'oggetto JSON.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (riga non generata)');
  }
  const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const data = parseJsonLoose(txt);
  if (!data) throw new Error('Risposta non in formato atteso (stop_reason: ' + resp.stop_reason + '): ' + txt.slice(0, 160));

  const pick = k => { const v = data[k]; return (v == null || String(v).trim() === '') ? '—' : String(v).trim(); };
  return {
    obiettivo: pick('obiettivo'),
    argomenti: pick('argomenti'),
    attivita:  pick('attivita'),
    scadenza:  pick('scadenza'),
    ora:       pick('ora'),
    eseguita:  pick('eseguita'),
    note:      pick('note'),
  };
}

// ═══════════════════════════════════════════════════════
// Scheda PROGETTO (mattone 3): estrazione delle voci di UNA fase dal report dell'incontro
// con committente/sponsor. Stesso meccanismo di generaRiga, ma le voci cambiano col tipo.
// FASE_SPEC deve restare allineato con VOCI_FASE in routes.js (stesse chiavi, per il render).
// proj:true = voce che è verità di PROGETTO (Intake): lo scanner la scrive su `progetti`.
// ═══════════════════════════════════════════════════════
const FASE_SPEC = {
  'pre-intake': [
    { key:'partecipanti', label:"Partecipanti all'incontro" },
    { key:'argomenti', label:'Argomenti discussi' },
    { key:'obiettivo_grezzo', label:'Obiettivo di progetto grezzo (provvisorio, pre-SMARTER)' },
    { key:'ipotesi_partecipanti', label:'Ipotesi sul numero di partecipanti e le loro caratteristiche' },
    { key:'richieste', label:'Eventuali richieste specifiche del committente' },
    { key:'next_steps', label:'Next steps / prossimi passi concordati' },
    { key:'note', label:'Note del coach' },
  ],
  'intake-sponsor': [
    { key:'partecipanti', label:"Partecipanti all'incontro" },
    { key:'argomenti', label:'Argomenti discussi' },
    { key:'obiettivo_smarter', label:'Obiettivo di progetto in forma SMARTER (definitivo)', proj:true },
    { key:'parametri', label:'Parametri di verifica del successo del progetto', proj:true },
    { key:'next_steps', label:'Next steps / prossimi passi concordati' },
    { key:'note', label:'Note del coach' },
  ],
  'kick-off': [
    { key:'partecipanti', label:"Partecipanti all'incontro" },
    { key:'argomenti', label:'Argomenti presentati da Sponsor/Coach' },
    { key:'interventi', label:'Interventi importanti dei partecipanti (se presenti)' },
    { key:'next_steps', label:'Next steps / prossimi passi concordati' },
    { key:'note', label:'Note del coach' },
  ],
  'chiusura-open': [
    { key:'partecipanti', label:"Partecipanti all'incontro" },
    { key:'argomenti', label:'Argomenti trattati' },
    { key:'traguardi', label:'Traguardi celebrati' },
    { key:'note', label:'Note del coach' },
  ],
  'chiusura-sponsor': [
    { key:'partecipanti', label:"Partecipanti all'incontro" },
    { key:'argomenti', label:'Argomenti trattati' },
    { key:'feedback_sponsor', label:'Feedback dello Sponsor' },
    { key:'note', label:'Note del coach' },
  ],
};
const FASE_LABEL_UMANO = {
  'pre-intake':'Pre-Intake', 'intake-sponsor':'Intake con lo Sponsor', 'kick-off':'Kick-Off',
  'chiusura-open':'Sessione di chiusura aperta (Final Open)', 'chiusura-sponsor':'Sessione di chiusura con lo Sponsor (Final)',
};

async function generaRigaFase({ tipo, progetto, reportText }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata su Railway');
  const voci = FASE_SPEC[tipo];
  if (!voci) throw new Error('Tipo fase non gestito: ' + tipo);
  const client = new Anthropic();

  const props = {}, required = [];
  voci.forEach(v => { props[v.key] = { type: 'string' }; required.push(v.key); });
  const schema = { type: 'object', properties: props, required, additionalProperties: false };
  const elenco = voci.map(v => `- ${v.key}: ${v.label}`).join('\n');

  const p = progetto || {};
  const intestazione = [
    `Progetto: ${p.titolo || '(senza titolo)'}`,
    p.committente_nome ? `Committente: ${p.committente_nome}` : null,
    `Fase: ${FASE_LABEL_UMANO[tipo] || tipo}`,
  ].filter(Boolean).join('\n');

  const system = `Sei l'assistente di un coach professionista (Noesys). Dal report di UN incontro di PROGETTO con il committente/sponsor (riassunto Zoom, già rivisto dal coach) ESTRAI le voci della "Scheda Progetto" per questa fase. Solo i campi, nessuna prosa introduttiva.

Regole ferme (rispettale alla lettera):
- Attieniti ai fatti del report. NON inventare. Campo assente nel report → "—".
- Voci a elenco (partecipanti, argomenti, next_steps, parametri, interventi, traguardi): ELENCO PUNTATO, un punto per riga con "- ". Punti brevi.
- argomenti: per OGNI argomento specifica CHI lo ha trattato o introdotto — il coach oppure un committente (sponsor o referente) — iniziando il punto col ruolo (e il nome, se noto) in grassetto: "- **Coach:** …", "- **Sponsor (Nome):** …", "- **Referente (Nome):** …". Se il report non indica chi, lascia il punto senza grassetto.
- ipotesi_partecipanti: riporta SOLO il numero (anche stimato) dei partecipanti previsti, gli eventuali nominativi e le caratteristiche dei loro profili così come condivise dai committenti. NIENT'ALTRO: obiettivi, richieste e argomenti vanno nelle rispettive voci, non qui.
- obiettivo grezzo / obiettivo SMARTER: UNA-due frasi sintetiche, niente elenchi di valori.
- note: conclusioni/considerazioni del coach, riportate fedelmente, testo scorrevole e conciso.

Italiano. Rispondi SOLO con un oggetto JSON con ESATTAMENTE queste chiavi:
${elenco}`;

  const user = `${intestazione}

=== REPORT DELL'INCONTRO (fonte principale) ===
${(reportText || '').trim() || '(report vuoto)'}

Estrai le voci elencate secondo le regole. Rispondi SOLO con l'oggetto JSON.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (fase non generata)');
  }
  const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const data = parseJsonLoose(txt);
  if (!data) throw new Error('Risposta non in formato atteso (stop_reason: ' + resp.stop_reason + '): ' + txt.slice(0, 160));

  const out = {};
  voci.forEach(v => { const val = data[v.key]; out[v.key] = (val == null || String(val).trim() === '') ? '—' : String(val).trim(); });
  return out;
}

// ── MODULI COMPILATI → ANAGRAFICA (07/08, rifatto l'08/08) ──────────────────
// Il PDF si dà DIRETTAMENTE a Claude, che lo guarda come lo guarderebbe una
// persona. È l'unica strada che regge, e il perché vale la pena scriverlo.
//
// Il primo tentativo leggeva le ANNOTAZIONI del PDF (i "foglietti" che si
// appoggiano sopra il modulo quando lo si compila con Anteprima). Funzionava
// sui documenti di Giuliano e vedeva ZERO su quelli di Giulio, perché lui ha
// compilato con uno strumento che scrive i valori DENTRO la pagina. Stessa
// scheda, stesso contratto, due modi di compilare, un lettore solo che ne
// capiva uno. E le firme: Giuliano firma con timbri grafici, Giulio con firma
// disegnata più "Luogo e data" scritto — e il vecchio criterio "conta i timbri"
// dichiarava Giulio NON consenziente, mentre il consenso c'era, del 15/04/2026.
// Rincorrere ogni modo di compilare è una battaglia persa; Claude li vede tutti.
const CAMPI_MODULO = {
  data_nascita:    'data di nascita, formato AAAA-MM-GG',
  luogo_nascita:   'comune di nascita, senza provincia',
  via:             'indirizzo di residenza: via e numero civico',
  citta:           'comune di residenza, SENZA la provincia fra parentesi',
  provincia:       'sigla della provincia, 2 lettere maiuscole',
  cap:             'CAP, 5 cifre',
  telefono:        'numero di telefono',
  email:           'indirizzo email ordinario (NON la PEC)',
  professione:     'che lavoro fa. Se il modulo ha sia "Reparto" sia "Responsabilità/Ruolo", scegli ciò che dice il MESTIERE',
  societa:         'azienda o studio; se lavora in proprio senza azienda, "—"',
  codice_fiscale:  'codice fiscale (16 caratteri) o partita IVA (11 cifre)',
  pec:             'indirizzo PEC (posta certificata)',
  codice_sdi:      'codice destinatario SDI, 7 caratteri (per i privati "0000000")',
};

const SYSTEM_MODULO = `Sei l'assistente di un coach professionista (Noesys). Il cliente gli ha rimandato compilato un modulo che il coach stesso gli aveva inviato — la scheda anagrafica oppure il contratto di coaching — e il coach sta aggiornando la scheda del proprio cliente nel gestionale, con il consenso dell'interessato.

Guarda il documento e riporta quello che c'è scritto.

Regole ferme:
- Riporta SOLO ciò che è scritto sul documento. Non inventare, non dedurre, non completare. Campo in bianco → "—".
- ⚠️ Un modulo può essere compilato SOLO IN PARTE: è normale e va benissimo. Prendi tutto quello che c'è e lascia "—" per il resto. Un documento parziale NON è un documento vuoto.
- Distingui le ETICHETTE STAMPATE del modulo (le domande) da quello che ha scritto il cliente: ti servono solo le risposte.
- Le risposte alle domande aperte (motivazioni, aspettative, cosa lo motiva) NON servono: ignorale.
- compilato: true se il cliente ha scritto ANCHE UNA SOLA cosa o ha firmato; false solo se il modulo è del tutto in bianco.

Sul CONTRATTO, in più:
- firmato_dal_cliente: se il cliente ha sottoscritto il contratto.
- consenso_dati_personali: se ha sottoscritto ANCHE la clausola sul trattamento dei dati personali, che è una sezione a sé in fondo al documento, con una propria sottoscrizione. Attento: una firma sul contratto NON basta se manca quella del consenso.
- ⚠️ Una sottoscrizione può risultare in modi diversi, e valgono TUTTI: una firma grafica, una firma scritta a mano sopra il documento, oppure il "Luogo e data" compilato sotto quella clausola.
- data_consenso: la data con cui è stato sottoscritto il consenso (di norma il "Luogo e data" accanto alla firma), formato AAAA-MM-GG. Se non è scritta da nessuna parte, "—". Non inventarla e non usare la data di oggi.
- come_risulta: UNA frase che dice DOVE hai visto la firma o la data, così il coach può controllare (es. «firma grafica a pag. 4 sotto il consenso, con "Bologna, 15/04/2026"»).
Sulla SCHEDA ANAGRAFICA le tre voci sulle firme sono false e data_consenso "—": lì non si firma niente.

Nel dubbio scegli "—" o false, mai un valore a caso. Italiano.`;

// Legge un modulo (PDF) e ne ricava i campi dell'anagrafica + lo stato delle firme.
async function leggiModuloPdf({ pdfBuffer, tipoModulo, nomeCliente }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata');
  const client = new Anthropic();

  const props = Object.fromEntries(Object.keys(CAMPI_MODULO).map(k => [k, { type: 'string' }]));
  props.compilato = { type: 'boolean' };
  props.firmato_dal_cliente = { type: 'boolean' };
  props.consenso_dati_personali = { type: 'boolean' };
  props.data_consenso = { type: 'string' };
  props.come_risulta = { type: 'string' };
  const schema = { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };

  const elenco = Object.entries(CAMPI_MODULO).map(([k, d]) => `- ${k}: ${d}`).join('\n');
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { format: { type: 'json_schema', schema } },
    system: SYSTEM_MODULO,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
      { type: 'text', text:
`Cliente: ${nomeCliente || '(nome non indicato)'}
Modulo: ${tipoModulo === 'contratto' ? 'contratto di coaching' : 'scheda anagrafica'}

Campi da ricavare:
${elenco}

Rispondi SOLO con l'oggetto JSON.` },
    ] }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (modulo non letto)');
  }
  const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const data = parseJsonLoose(txt);
  if (!data) throw new Error('Risposta non in formato atteso: ' + txt.slice(0, 160));

  const campi = {};
  for (const k of Object.keys(CAMPI_MODULO)) {
    const v = data[k];
    campi[k] = (v == null || String(v).trim() === '' || String(v).trim() === '—') ? null : String(v).trim();
  }
  const dataConsenso = /^\d{4}-\d{2}-\d{2}$/.test(String(data.data_consenso || '')) ? data.data_consenso : null;
  return {
    campi,
    compilato: !!data.compilato || Object.values(campi).some(Boolean),
    firmato: !!data.firmato_dal_cliente,
    consenso: !!data.consenso_dati_personali,
    dataConsenso,
    comeRisulta: String(data.come_risulta || '').trim(),
  };
}


module.exports = { MODEL, SYSTEM, hasApiKey, generaRiga, generaRigaCollettiva, generaRigaFase, FASE_SPEC, leggiModuloPdf, CAMPI_MODULO };
