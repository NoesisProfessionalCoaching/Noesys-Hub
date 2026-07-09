// Generazione della "scheda di sessione" a partire dal report Zoom (+ output degli
// strumenti). È il cuore del sostituto di Cowork: legge il materiale e ne estrae il
// riepilogo strutturato che il coach poi APPROVA. Formato approvato con Germano
// (memoria noesys-scheda-sessione-standard): fonte = report + strumenti; densità media.
//
// Modello: Opus 4.8 (il più capace) — poche schede a settimana, costo trascurabile.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

function hasApiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = `Sei l'assistente di un coach professionista (Noesys). A partire dal report di una sessione di coaching (riassunto della riunione Zoom, già rivisto dal coach) e, se presenti, dagli output degli strumenti compilati dal cliente, redigi la "scheda di sessione": un riepilogo strutturato a uso interno del coach.

Regole ferme:
- Attieniti ai fatti presenti nel materiale. NON inventare nulla sul cliente: né obiettivi, né attività, né date che non risultino dal report o dagli strumenti. Se un'informazione non c'è, ometti la sezione o scrivi "non emerso".
- Questa è una BOZZA che il coach revisiona: sii fedele alla fonte, non interpretare oltre il dovuto.
- Registro professionale, italiano, chiaro e non direttivo (il coaching è una partnership, non si impartiscono lezioni). Niente enfasi pubblicitaria.
- "Nelle sue parole": riporta 1–3 citazioni testuali del CLIENTE solo se presenti nel report (tra virgolette). Se non ce ne sono, ometti la sezione.
- "Osservazioni del coach": qui e solo qui puoi proporre spunti tuoi (pattern, ipotesi, possibili direzioni). Marca chiaramente che sono PROPOSTE da validare, non fatti.
- Densità media: sintetico ma completo. Solo Markdown, nessun preambolo tipo "Ecco la scheda".`;

function sezioniPerTipo(tipo) {
  const base = [
    tipo === 'Intake'
      ? '## Ritratto\nSintesi del cliente e del suo momento, come emerge dall\'Intake.'
      : null,
    '## Obiettivo\nL\'obiettivo di lavoro; se emerge in forma SMART, rendilo esplicito.',
    '## Argomenti per strumento\nPer OGNI strumento effettivamente usato, un sotto-punto con cosa è emerso. Se non ci sono strumenti, riporta i temi trattati nella sessione.',
    '## Attività\nCompiti/azioni concordati con il cliente (se presenti).',
    '## Scadenza\nEventuale data o impegno temporale (se presente).',
    '## Nelle sue parole\nCitazioni testuali del cliente (solo se presenti).',
    '## Osservazioni del coach (proposte)\nSpunti dell\'assistente, marcati come proposte da validare.',
  ].filter(Boolean);
  return base.join('\n\n');
}

async function generaScheda({ tipo, cliente, reportText, strumentiText }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY non configurata su Railway');
  const client = new Anthropic(); // legge ANTHROPIC_API_KEY dall'ambiente

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
${(strumentiText || '').trim() || '(nessuno strumento disponibile per questo cliente)'}

=== COSA PRODURRE ===
Redigi la scheda in Markdown con queste sezioni (ometti quelle senza contenuto reale):

${sezioniPerTipo(tipo)}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (resp.stop_reason === 'refusal') {
    throw new Error('Richiesta rifiutata dal classificatore di sicurezza (scheda non generata)');
  }
  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Scheda vuota (stop_reason: ' + resp.stop_reason + ')');
  return text;
}

module.exports = { MODEL, hasApiKey, generaScheda };
