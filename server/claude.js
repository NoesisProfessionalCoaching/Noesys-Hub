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
  argomenti: "- Difficoltà a chiedere aiuto\n- Freni emotivi: autonomia, non disturbare\n- Differenze caratteriali con i genitori"
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

// ── ANAGRAFICA DAI MODULI COMPILATI (07/08) ─────────────────────────────────
// Dal modulo che il cliente rimanda arrivano i VALORI che ha scritto, in ordine
// di lettura, ma SENZA sapere a quale domanda rispondono: nel PDF sono foglietti
// appoggiati sopra la pagina. L'abbinamento per posizione non regge (provato: si
// sfasa di una riga), mentre qui basta il buon senso — "23 Agosto 1970" è una
// data di nascita, "DVDGLN70M23F205V" un codice fiscale. Perciò lo fa Claude.
const CAMPI_ANAGRAFICA = {
  data_nascita:    'data di nascita, in formato AAAA-MM-GG (es. "23 Agosto 1970" → "1970-08-23")',
  luogo_nascita:   'comune di nascita, senza provincia',
  via:             'indirizzo di residenza: via e numero civico, nient\'altro',
  citta:           'comune di residenza, SENZA la provincia fra parentesi',
  provincia:       'sigla della provincia, 2 lettere maiuscole (es. "Quartu S. Elena (CA)" → "CA")',
  cap:             'CAP, 5 cifre',
  telefono:        'numero di telefono',
  email:           'indirizzo email ordinario (NON la PEC)',
  professione:     'professione o ruolo. Se ci sono più voci (es. "Libero professionista" e la descrizione del ruolo) scegli quella che dice CHE LAVORO FA',
  societa:         'azienda o studio. Se è un libero professionista senza azienda, "—"',
  codice_fiscale:  'codice fiscale, 16 caratteri maiuscoli. Se è una partita IVA di 11 cifre mettila comunque qui',
  pec:             'indirizzo PEC (posta certificata). Spesso vicino al codice destinatario SDI',
  codice_sdi:      'codice destinatario SDI, 7 caratteri (per i privati è "0000000")',
};

// I moduli sono documenti di identità e contratti: capita che il classificatore
// di sicurezza si insospettisca. Il messaggio dice a chiare lettere di che si
// tratta — è il coach che legge la scheda del proprio cliente, con il suo
// consenso — così la richiesta non viene scambiata per altro.
const SYSTEM_ANAGRAFICA = `Sei l'assistente di un coach professionista (Noesys). Il suo cliente gli ha rimandato compilato il modulo di anagrafica (o il contratto) che il coach stesso gli aveva inviato. Il coach sta aggiornando la scheda del cliente nel proprio gestionale, con il consenso dell'interessato.

Ti arriva l'ELENCO DEI VALORI che il cliente ha scritto sul modulo, nell'ordine in cui compaiono sulla pagina, ma senza l'etichetta del campo: nel PDF sono annotazioni appoggiate sopra il modulo. Il tuo compito è capire, per ciascun campo richiesto, QUALE di quei valori gli corrisponde.

Regole ferme:
- Usa SOLO i valori dell'elenco. Non inventare, non completare, non correggere.
- Un valore può servire a un campo solo. Se per un campo non c'è nulla, scrivi "—".
- Se un valore contiene più informazioni, prendi solo la parte che serve al campo (es. "Quartu S. Elena (CA)" → città "Quartu S. Elena", provincia "CA").
- Le risposte discorsive alle domande aperte (motivazioni, aspettative, cosa lo motiva) NON servono: ignorale.
- In caso di dubbio fra due valori, scegli "—" invece di rischiare.

Italiano. Rispondi SOLO con l'oggetto JSON richiesto.`;

async function estraiAnagrafica({ valori, tipoModulo, nomeCliente }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata');
  const client = new Anthropic();

  const schema = {
    type: 'object',
    properties: Object.fromEntries(Object.keys(CAMPI_ANAGRAFICA).map(k => [k, { type: 'string' }])),
    required: Object.keys(CAMPI_ANAGRAFICA),
    additionalProperties: false,
  };
  const elenco = Object.entries(CAMPI_ANAGRAFICA).map(([k, d]) => `- ${k}: ${d}`).join('\n');

  const user = `Cliente: ${nomeCliente || '(nome non indicato)'}
Modulo: ${tipoModulo === 'contratto' ? 'contratto di coaching firmato' : 'scheda anagrafica del cliente'}

=== VALORI SCRITTI SUL MODULO, in ordine di lettura ===
${valori.map((v, i) => `${i + 1}. ${v}`).join('\n')}

=== CAMPI DA RICAVARE ===
${elenco}

Rispondi SOLO con l'oggetto JSON.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { format: { type: 'json_schema', schema } },
    system: SYSTEM_ANAGRAFICA,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (anagrafica non estratta)');
  }
  const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const data = parseJsonLoose(txt);
  if (!data) throw new Error('Risposta non in formato atteso: ' + txt.slice(0, 160));

  const out = {};
  for (const k of Object.keys(CAMPI_ANAGRAFICA)) {
    const v = data[k];
    out[k] = (v == null || String(v).trim() === '' || String(v).trim() === '—') ? null : String(v).trim();
  }
  return out;
}

module.exports = { MODEL, hasApiKey, generaRiga, generaRigaCollettiva, generaRigaFase, FASE_SPEC, estraiAnagrafica, CAMPI_ANAGRAFICA };
