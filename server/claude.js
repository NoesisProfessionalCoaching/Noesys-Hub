// Estrazione di UNA riga della "Scheda Cliente" dal report di sessione (+ strumenti).
// La Scheda Cliente è una tabella con una riga per sessione (modello storico Cowork):
// data · sessione · OBIETTIVO · ARGOMENTI · ATTIVITÀ · SCADENZA · ESEGUITA · NOTE.
// Qui estraiamo i 6 campi di contenuto; data e tipo li mette lo scanner.
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
- eseguita: "✓" se il report dice che le attività assegnate in precedenza sono state svolte, "✗" se non svolte, "—" se non applicabile (tipicamente una sessione nuova).
- note: le conclusioni/considerazioni del COACH, riportando FEDELMENTE eventuali "Note conclusive del coach" (tra virgolette come nel report); più eventuali dati utili (prossimo appuntamento, spunti). Testo scorrevole e conciso.

Esempio di STILE (imita il formato, non il contenuto):
  obiettivo: "Individuare due modi concreti per chiedere aiuto ai genitori con serenità."
  argomenti: "- Difficoltà a chiedere aiuto\n- Freni emotivi: autonomia, non disturbare\n- Differenze caratteriali con i genitori"
  attivita: "- **Cliente:** individuare un supporto specifico da chiedere\n- Allenarsi a rispondere con calma agli aiuti non richiesti"
  scadenza: "2026-07-21"
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
    eseguita:  { type: 'string' },
    note:      { type: 'string' },
  },
  required: ['obiettivo', 'argomenti', 'attivita', 'scadenza', 'eseguita', 'note'],
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

Estrai i 6 campi della riga (obiettivo, argomenti, attivita, scadenza, eseguita, note) secondo le regole. Rispondi SOLO con l'oggetto JSON.`;

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

module.exports = { MODEL, hasApiKey, generaRiga, generaRigaFase, FASE_SPEC };
