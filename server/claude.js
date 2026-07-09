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

const SYSTEM = `Sei l'assistente di un coach professionista (Noesys). Dal report di UNA sessione di coaching (riassunto della riunione Zoom, già rivisto dal coach) e, se presenti, dagli output degli strumenti del cliente, ESTRAI i campi di UNA riga della "Scheda Cliente". Niente prosa: solo i campi.

Regole ferme:
- Attieniti ai fatti presenti nel materiale. NON inventare. Se un campo non risulta, scrivi "—".
- obiettivo:
  · se la sessione è un INTAKE → l'obiettivo di PERCORSO definito in sessione, in forma SMART se emerge (da dove si parte, dove si vuole arrivare, entro quando).
  · se è un ONGOING → l'obiettivo di QUELLA sessione (comunicato prima con l'agenda e reso SMART a inizio seduta).
  · se è un FINAL → l'obiettivo o il bilancio di chiusura.
- argomenti: gli argomenti trattati nella sessione, sintetici.
- attivita: le attività/compiti concordati col cliente per dopo la sessione. Se nessuna, "—".
- scadenza: eventuale scadenza o tempo entro cui svolgere le attività. Se nessuna, "—".
- eseguita: se il report dice che le attività assegnate in una sessione precedente sono state svolte, riportalo (es. "Sì", "No", "In parte"). Per una sessione nuova di norma è "—" (si verifica alla prossima).
- note: eventuali note o conclusioni scritte dal COACH nel report (es. una voce "Note conclusive del coach") riportate FEDELMENTE come sue parole; più eventuali segnalazioni utili. Se nessuna, "—".
- Italiano, sintetico: è il contenuto di celle di una tabella, non un tema. Rispondi SOLO con l'oggetto JSON richiesto.`;

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

module.exports = { MODEL, hasApiKey, generaRiga };
