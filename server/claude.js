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

module.exports = { MODEL, hasApiKey, generaRiga };
