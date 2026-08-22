// ═══════════════════════════════════════════════════════════════════════════
// IL DOCUMENTO DI CHIUSURA DEL PERCORSO — quello che va al CLIENTE.
//
// ⚠️ Non confonderlo con `documenti.js`, che scrive il nome sulla lettera di
// benvenuto e sull'agenda: quelli sono modelli PDF, questo è il documento che
// racconta il percorso. (Report = i documenti professionali del coach, su Drive.
// Documenti = quello che riceve il cliente.)
//
// COME NASCE (modello approvato da Germano il 21/08/2026)
//  1. Si raccoglie il materiale: i REPORT INTERI da Drive — non i campi riassunti
//     `obiettivo/argomenti/attivita` della Scheda Cliente, che sono un compendio e
//     fanno perdere il senso del percorso — più le ruote dallo strumento e le sedute.
//  2. L'IA ne ricava i momenti che contano: QUANTI NE TROVA, i difficili solo se ci
//     sono. Ogni momento porta con sé la FRASE ESATTA del report da cui viene.
//  3. Si salva in `documenti`, con i contenuti generati e le correzioni del coach in
//     due posti separati: il documento continua a crescere (la seconda ruota arriva
//     in sessione, il report della Final dopo) e una rigenerazione non deve mai
//     cancellare ciò che lui ha riscritto.
//
// 🔴 DUE LINEE ROSSE, non negoziabili:
//  · Il cliente SI CITA, NON SI INTERPRETA. Niente diagnosi, niente «sembrava
//    insicuro»: si riporta quello che ha detto e fatto, con la sua frase.
//  · MAI dedurre o descrivere EMOZIONI (AI Act + legge 132/2025). L'analisi delle
//    ruote è muta: dice cosa si è mosso e di quanto. A commentare è il cliente.
// ═══════════════════════════════════════════════════════════════════════════
const mammoth = require('mammoth');
const db = require('./db');
const drive = require('./google-drive');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-8';

// ── 1 · I DATI CHE STANNO GIÀ NELL'HUB ──────────────────────────────────────
async function datiDalDatabase(percorsoId) {
  const p = await db.query(
    `SELECT p.*, c.id AS cliente_id, c.name, c.nome, c.cognome, c.area, c.tipo_percorso
       FROM percorsi p JOIN clients c ON c.id = p.client_id WHERE p.id = $1`, [percorsoId]);
  const percorso = p.rows[0];
  if (!percorso) throw new Error('Percorso non trovato');

  const s = await db.query(
    `SELECT id, tipo, data, ore, stato, source_file_id, obiettivo, note
       FROM sedute WHERE percorso_id = $1 ORDER BY data ASC NULLS LAST, created_at ASC`, [percorsoId]);

  // Le ruote sono righe di `sessions` (la tabella degli strumenti): ogni compilazione
  // è una versione datata a sé, quindi la seconda ruota NON sovrascrive la prima.
  const r = await db.query(
    `SELECT id, tool, data, created_at FROM sessions
      WHERE client_id = $1 AND tool LIKE 'ruota%' ORDER BY created_at ASC`, [percorso.cliente_id]);

  return { percorso, cliente: {
    id: percorso.cliente_id, name: percorso.name, nome: percorso.nome, cognome: percorso.cognome,
    area: percorso.area, tipo_percorso: percorso.tipo_percorso,
  }, sedute: s.rows, ruoteGrezze: r.rows };
}

// ── 2 · LE DUE RUOTE — si distinguono per DATA ──────────────────────────────
// Regola di Germano: una in intake, una in final; «non ci sarà mai una Final
// antecedente una Intake». Quindi: la più vecchia è l'intake, la più recente la
// final. Si confrontano solo due versioni dello STESSO strumento (una ruota della
// vita e una ruota di leadership misurano cose diverse).
// Il documento nasce con UNA ruota sola: la seconda arriva durante la sessione.
function scegliRuote(ruoteGrezze) {
  const buone = (ruoteGrezze || []).filter(r => leggiAree(r).length);
  if (!buone.length) return { intake: null, final: null, avviso: 'Nessuna ruota compilata nello strumento.' };
  const perTool = {};
  for (const r of buone) (perTool[r.tool] = perTool[r.tool] || []).push(r);
  // ⚠️ Si ordina QUI per data, senza fidarsi dell'ordine in cui arrivano le righe:
  // «la più vecchia è l'intake, la più recente la final» è la regola, e una regola
  // che dipende da come chiama chi ti chiama prima o poi si rompe.
  for (const t of Object.keys(perTool)) perTool[t].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  // Lo strumento con più versioni (a pari merito: quello con la versione più recente).
  const tool = Object.keys(perTool).sort((a, b) =>
    perTool[b].length - perTool[a].length ||
    new Date(perTool[b][perTool[b].length - 1].created_at) - new Date(perTool[a][perTool[a].length - 1].created_at))[0];
  const v = perTool[tool];
  if (v.length === 1) return { intake: v[0], final: null, tool, avviso: 'C\'è una ruota sola: la seconda si fa in sessione.' };
  return { intake: v[0], final: v[v.length - 1], tool, avviso: null };
}

function leggiAree(riga) {
  if (!riga) return [];
  try {
    const d = typeof riga.data === 'string' ? JSON.parse(riga.data) : (riga.data || {});
    return Array.isArray(d.areas) ? d.areas.filter(a => a && a.name != null && a.value != null) : [];
  } catch (_) { return []; }
}

// ── 3 · LE VARIAZIONI — SOLO NUMERI, nessun commento ────────────────────────
// 🔴 Qui NON si interpreta e non si nominano stati d'animo: si dice cosa si è
// mosso e di quanto. A raccontare cosa significa è il cliente, in sessione.
function variazioniRuote(intake, final) {
  const a = leggiAree(intake), b = leggiAree(final);
  if (!a.length || !b.length) return null;
  const pulisci = n => String(n).replace(/\s+/g, ' ').trim().toLowerCase();
  const mappaB = new Map(b.map(x => [pulisci(x.name), Number(x.value)]));
  const aree = [], solo = [];
  for (const x of a) {
    const k = pulisci(x.name);
    if (!mappaB.has(k)) { solo.push(String(x.name).replace(/\s+/g, ' ')); continue; }
    const prima = Number(x.value), dopo = mappaB.get(k);
    aree.push({ area: String(x.name).replace(/\s+/g, ' '), prima, dopo, variazione: dopo - prima });
    mappaB.delete(k);
  }
  for (const k of mappaB.keys()) solo.push(k);
  const salite = aree.filter(x => x.variazione > 0);
  const scese  = aree.filter(x => x.variazione < 0);
  const ferme  = aree.filter(x => x.variazione === 0);
  const media = arr => arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : null;
  return {
    aree,
    mediaPrima: media(aree.map(x => x.prima)),
    mediaDopo:  media(aree.map(x => x.dopo)),
    salite: salite.length, scese: scese.length, ferme: ferme.length,
    maggiore: salite.length ? salite.reduce((m, x) => x.variazione > m.variazione ? x : m) : null,
    areeNonConfrontabili: solo,
  };
}

// ── 4 · I REPORT INTERI DA DRIVE ────────────────────────────────────────────
// Ogni seduta nata dall'automazione conserva l'impronta del file Word di origine:
// si riscarica quello, non si rilegge il riassunto.
async function testiDeiReport(sedute) {
  const out = [];
  for (const s of sedute) {
    if (!s.source_file_id) { out.push({ ...soloDati(s), testo: null, mancante: 'nessun report collegato' }); continue; }
    try {
      const buf = await drive.downloadFileBuffer(s.source_file_id);
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const testo = (value || '').trim();
      out.push({ ...soloDati(s), testo: testo || null, mancante: testo ? null : 'report vuoto' });
    } catch (e) {
      out.push({ ...soloDati(s), testo: null, mancante: 'lettura Drive: ' + e.message });
    }
  }
  return out;
}
const soloDati = s => ({ id: s.id, tipo: s.tipo, data: s.data ? String(s.data).slice(0, 10) : null, ore: s.ore });

// ── 5 · IL MATERIALE COMPLETO ───────────────────────────────────────────────
// 🔴 IL REPORT DELLA FINAL NON ENTRA NELLA GENERAZIONE. Non è un accorgimento per
// le prove: è la realtà. Il documento si prepara PRIMA della Final, quando quel
// report non esiste ancora. Il report della Final serve DOPO, per il documento da
// consegnare: le parole del Cliente sulle variazioni, gli impegni, il materiale
// per le parole del coach.
// ⚠️ Francesco Pilo è l'unico caso in cui quel report esiste già (la sua Final si è
// svolta il 13/07/2026): senza questa regola l'unica prova disponibile sarebbe
// falsata, e il documento racconterebbe cose che in una Final vera non si sanno.
async function raccogliMateriale({ percorsoId, conFinal = false }) {
  const base = await datiDalDatabase(percorsoId);
  const ruote = scegliRuote(base.ruoteGrezze);
  const sedutePerReport = conFinal ? base.sedute : base.sedute.filter(x => x.tipo !== 'Final');
  const report = await testiDeiReport(sedutePerReport);
  return {
    cliente: base.cliente,
    percorso: { id: base.percorso.id, tipo: base.percorso.tipo, modalita: base.percorso.modalita,
                stato: base.percorso.stato, data_inizio: base.percorso.data_inizio,
                ore_fatte: base.percorso.ore_fatte, n_sessioni_fatte: base.percorso.n_sessioni_fatte },
    sedute: base.sedute.map(soloDati),
    report,
    ruote: {
      tool: ruote.tool || null, avviso: ruote.avviso,
      intake: ruote.intake ? { id: ruote.intake.id, quando: String(ruote.intake.created_at).slice(0, 10), aree: leggiAree(ruote.intake) } : null,
      final:  ruote.final  ? { id: ruote.final.id,  quando: String(ruote.final.created_at).slice(0, 10),  aree: leggiAree(ruote.final) }  : null,
      variazioni: ruote.final ? variazioniRuote(ruote.intake, ruote.final) : null,
    },
  };
}

// ── 6 · COSA DEVE USCIRE — la forma del documento approvato ─────────────────
// Le voci ricalcano le slide del modello del 21/08: copertina · il filo · i momenti
// che contano · le due ruote · i numeri che si è dato · cosa ti porti · come non
// tornare indietro · da qui in avanti · le parole del coach · chiusura.
// Ogni voce esiste in DUE versioni dentro lo stesso file: «da sessione» (con tracce
// e fonti, serve al coach mentre conduce) e «da consegnare» (le domande diventano
// impegni in prima persona, tracce e fonti spariscono).
const SCHEMA = {
  type: 'object',
  properties: {
    copertina: { type: 'object', properties: {
      titolo: { type: 'string' }, periodo: { type: 'string' },
    }, required: ['titolo', 'periodo'], additionalProperties: false },
    filo: { type: 'object', properties: {
      titolo: { type: 'string' }, corpo: { type: 'array', items: { type: 'string' } },
    }, required: ['titolo', 'corpo'], additionalProperties: false },
    momenti: { type: 'array', items: { type: 'object', properties: {
      data: { type: 'string' },              // all'italiana: '4 maggio 2026' (o due date unite da ' e ')
      etichetta: { type: 'string' },         // es. 'La svolta', 'Passaggio scomodo'
      difficile: { type: 'boolean' },        // vero solo se è davvero un momento duro
      titolo: { type: 'string' },
      punti: { type: 'array', items: { type: 'string' } },  // 2-4 punti BREVI: cosa è successo
      considerazioni: { type: 'string' },    // 2-3 righe, non di più
      fonte: { type: 'string' },             // solo versione da sessione
      portatoCitazione: { type: 'string' },  // LA FRASE ESATTA del report
      portatoSpiegazione: { type: 'string' },
      traccia: { type: 'string' },           // solo versione da sessione
    }, required: ['data','etichetta','difficile','titolo','punti','considerazioni','fonte','portatoCitazione','portatoSpiegazione','traccia'], additionalProperties: false } },
    numeri: { type: 'array', items: { type: 'object', properties: {
      etichetta: { type: 'string' }, valore: { type: 'string' }, quando: { type: 'string' },
    }, required: ['etichetta','valore','quando'], additionalProperties: false } },
    portiVia: { type: 'object', properties: {
      titolo: { type: 'string' },
      punti: { type: 'array', items: { type: 'object', properties: {
        titolo: { type: 'string' }, testo: { type: 'string' }, riferimento: { type: 'string' },
      }, required: ['titolo','testo','riferimento'], additionalProperties: false } },
    }, required: ['titolo','punti'], additionalProperties: false },
    nonTornareIndietro: { type: 'object', properties: {
      titolo: { type: 'string' },
      punti: { type: 'array', items: { type: 'object', properties: {
        titolo: { type: 'string' }, testo: { type: 'string' }, riferimento: { type: 'string' },
      }, required: ['titolo','testo','riferimento'], additionalProperties: false } },
    }, required: ['titolo','punti'], additionalProperties: false },
    daQuiInAvanti: { type: 'array', items: { type: 'object', properties: {
      domanda: { type: 'string' },   // la fa il coach in sessione, con le righe vuote sotto
      etichetta: { type: 'string' },  // il titoletto della risposta nella versione da consegnare
    }, required: ['domanda','etichetta'], additionalProperties: false } },
    paroleDelCoach: { type: 'object', properties: {
      titolo: { type: 'string' }, corpo: { type: 'array', items: { type: 'string' } },
    }, required: ['titolo','corpo'], additionalProperties: false },
    chiusura: { type: 'object', properties: {
      titolo: { type: 'string' }, messaggio: { type: 'string' },
    }, required: ['titolo','messaggio'], additionalProperties: false },
  },
  required: ['copertina','filo','momenti','numeri','portiVia','nonTornareIndietro','daQuiInAvanti','paroleDelCoach','chiusura'],
  additionalProperties: false,
};

const SYSTEM = `Sei l'assistente di un coach professionista (Noesys). Dai REPORT INTERI di un percorso di coaching individuale — scritti dal coach, uno per sessione — costruisci il DOCUMENTO DI CHIUSURA che il coach userà nella sessione Final e poi consegnerà al Cliente.

Non è un riassunto e non è un verbale: è il racconto del percorso restituito alla persona che l'ha fatto.

🔴 A CHI STAI PARLANDO — la regola che viene prima di tutte
Il documento è del CLIENTE e parla A LUI: sempre in SECONDA PERSONA, dandogli del tu.
«Sei arrivato con un obiettivo pratico», «te lo sei dato 9 su 10», «la frase che conta l'hai detta tu».
⛔ MAI in terza persona: niente «Francesco ha scoperto», «il cliente si è dato», «lui diceva».
Vale per TUTTO ciò che legge lui: copertina, filo, i punti e le considerazioni dei momenti, cosa ti
porti, come non tornare indietro, le domande, le parole del coach, la chiusura.
✅ Le UNICHE due eccezioni sono i testi scritti PER IL COACH, che al Cliente non arrivano mai:
la fonte (da dove viene il contenuto) e la traccia (l'istruzione al coach: «Chiedigli…», «Non elencarli…»).

🔴 DUE REGOLE CHE VENGONO PRIMA DI TUTTO
1. Il Cliente SI CITA, NON SI INTERPRETA. Ogni momento deve poggiare su una frase o un fatto che sta nei report. Non aggiungere, non dedurre, non "leggere dentro".
2. MAI descrivere o dedurre EMOZIONI e stati d'animo ("si sentiva insicuro", "era ansioso"). Riporta cosa ha detto e cosa ha fatto. Se un'emozione l'ha nominata lui, si può citare tra virgolette come sua parola — non come tua osservazione.

I MOMENTI CHE CONTANO
- 🔴 QUANTI: **almeno uno per ogni sessione ONGOING**. Se le ongoing sono sei, i momenti sono almeno sei;
  se sono due, almeno due. Nessuna sessione resta senza il suo tema: il Cliente c'è stato, e vuole
  ritrovarcisi. Regola di Germano del 22/08.
- Se una sessione ha prodotto DUE cose distinte e non collegate fra loro, si mettono **tutte e due**,
  separate: non si accorpano per far prima (es. un discorso in pubblico andato bene e una decisione
  presa in famiglia sono due momenti, non uno).
- 🔴 DALL'INTAKE deve uscire SEMPRE **l'obiettivo di percorso**: è il filo da cui parte tutto, e va nella
  copertina e nel filo. Da lì si prendono anche **i valori/numeri di partenza** che il Cliente si è dato,
  perché sono il termine di paragone dei confronti.
  ⚠️ L'intake diventa un MOMENTO **solo se ha qualcosa da segnalare** (una scena, una frase, un fatto).
  Se è solo l'inquadramento dell'obiettivo, l'obiettivo esce lo stesso — nella copertina e nel filo — ma
  il momento non si fa. Regola di Germano del 22/08.
- I momenti DIFFICILI si mettono se ci sono (difficile = true). Non è una quota da riempire: se nei report non ci sono, non inventarli.
- 🔴 BREVITÀ. Il coach legge queste slide mentre parla con una persona: niente paragrafi.
  · punti = 2-4 PUNTI ELENCO, uno per riga, ognuno al massimo 12-14 parole: cosa è successo in quella sessione.
  · considerazioni = 2-3 righe in tutto, massimo 45 parole: cosa ha prodotto quel momento. Non di più.
- Ogni momento ha anche: la data ALL'ITALIANA, «4 maggio 2026» (o due, se è maturato in due sessioni), un'etichetta breve ("La svolta",
  "Passaggio scomodo", "La contraddizione") e un titolo concreto che richiama LA scena, mai generico.
- portatoCitazione = LA FRASE ESATTA del report (parole del Cliente se ci sono, altrimenti il fatto preciso che
  ha portato lui). Copiala, non riscriverla: è la prova che il documento poggia su di lui.
- portatoSpiegazione = UNA riga: perché quell'elemento ha fatto la differenza.
- fonte = da dove viene ("Report dell'11 maggio: tabella autorevolezza 7/10 · esercizio sull'immagine…").
- traccia = un'istruzione operativa al coach ("Chiedigli che numero darebbe oggi, prima di andare avanti").

🔴 LE TRE SLIDE DI CHIUSURA SONO LA TRACCIA DEL COACH, NON IL DOCUMENTO DEL CLIENTE
Nel documento che il coach usa DURANTE la Final queste tre slide gli servono da traccia: gli ricordano
cosa è successo, così può condurre. Nel documento che poi si consegna verranno SOSTITUITE dalle parole
del Cliente, prese dal report della Final. Quindi: qui non scrivi conclusioni al posto suo, prepari il
materiale del coach.
- portiVia («Cosa ti porti»): 5-6 punti BREVI, uno per riga. Ogni punto = titolo di 3-5 parole + UNA riga
  che dice cos'è + riferimento corto («Usata all'open day», «Scoperta l'11 maggio»). Solo cose che il
  Cliente ha già usato o detto almeno una volta: niente teorie.
- nonTornareIndietro: 3 punti, stessa forma. Sono i posti in cui è più facile che smetta: titolo + una
  o due righe + riferimento con le date in cui è emerso.
- daQuiInAvanti: 4 DOMANDE che il coach fa in chiusura, cucite su questo percorso (nomina le sue cose).
  Per ognuna, la voce etichetta = il titoletto brevissimo che la risposta avrà nel documento da consegnare
  (es. «Il segnale a cui sto attento», «Cosa faccio quando succede», «Su cosa mi appoggio»).
  NON scrivere le risposte: sono sue e arriveranno dal report della Final.

LE ALTRE PARTI
- filo: il filo che tiene insieme il percorso. Titolo che dice la cosa, non "Il tuo percorso". DUE paragrafi corti.
- numeri: i numeri che il CLIENTE si è dato nei report (voti, scale), con quando li ha detti. Mai calcolati da te.
- paroleDelCoach: BOZZA delle parole del coach, costruita SOLO con frasi e osservazioni che il coach ha già
  scritto nei suoi report (le note conclusive). Le riscriverà lui: dagli il materiale suo, non parole tue. Corta.
- chiusura: titolo = il nome di battesimo del Cliente; messaggio = poche righe personali, senza retorica.

LINGUA E TONO: italiano lineare e semplice, frasi corte, niente gergo, niente entusiasmo di maniera. Concreto: nomi di cose, scene, numeri. Mai adulazione.

Rispondi SOLO con l'oggetto JSON richiesto. Ogni sezione va restituita come STRUTTURA (oggetti ed elenchi veri), mai come testo che contiene altro JSON.`;

// Il materiale come lo legge il modello: i report INTERI, in ordine di data.
function costruisciPrompt(materiale) {
  const c = materiale.cliente || {};
  const nome = (c.nome || c.name || '').trim();
  const testa = [
    `Cliente: ${c.name || '(sconosciuto)'} (nome di battesimo: ${nome.split(/\s+/)[0] || '—'})`,
    c.area ? `Area: ${c.area}` : null,
    `Percorso: ${materiale.percorso.tipo || 'Individuale'} · ${materiale.percorso.n_sessioni_fatte || materiale.sedute.length} sessioni · ${materiale.percorso.ore_fatte || '—'} ore`,
  ].filter(Boolean).join('\n');

  const reports = materiale.report.map(r => {
    const t = `### ${r.tipo} — ${r.data || 'data sconosciuta'}`;
    return r.testo ? `${t}\n${r.testo}` : `${t}\n(report non disponibile: ${r.mancante})`;
  }).join('\n\n');

  const ruote = [];
  if (materiale.ruote.intake) ruote.push(`Ruota di INTAKE (${materiale.ruote.intake.quando}): ` +
    materiale.ruote.intake.aree.map(a => `${String(a.name).replace(/\s+/g, ' ')} ${a.value}`).join(' · '));
  if (materiale.ruote.final) ruote.push(`Ruota della FINAL (${materiale.ruote.final.quando}): ` +
    materiale.ruote.final.aree.map(a => `${String(a.name).replace(/\s+/g, ' ')} ${a.value}`).join(' · '));
  if (!ruote.length) ruote.push('(nessuna ruota compilata nello strumento)');

  const user =
`${testa}

=== I REPORT INTERI DEL PERCORSO, in ordine ===
${reports}

=== LE RUOTE (dallo strumento) ===
${ruote.join('\n')}
⚠️ Le ruote NON si commentano e non si interpretano: servono solo come contesto. Il confronto fra le due lo fa l'Hub, con i soli numeri.

Costruisci il documento di chiusura come da istruzioni.`;
  return { system: SYSTEM, user };
}

// ── 7 · RADDRIZZARE QUELLO CHE TORNA ────────────────────────────────────────
// 21/08/2026, visto sui report veri di Francesco: il modello ha restituito due
// sezioni come TESTO (una stringa che contiene JSON) invece che come struttura.
// Il contenuto era giusto, la forma no — e una pagina che si aspetta un elenco e
// riceve una frase non dà errore: mostra il vuoto. Quindi si raddrizza qui, una
// volta sola, e se manca davvero qualcosa lo si DICE invece di tirare avanti.
// ⚠️ IL DIFETTO VERO, visto il 21/08 sui report di Francesco: due sezioni sono
// tornate come TESTO che contiene JSON, e per giunta TRONCATO — mancava la graffa
// di chiusura. Il contenuto era perfetto, la forma no. Una pagina che si aspetta
// un elenco e riceve una frase non dà errore: mostra il vuoto.
// Quindi: si prova a leggere; se non si legge, si CHIUDONO le parentesi rimaste
// aperte e si riprova una volta sola. Niente di più creativo — se non si legge
// nemmeno così è giusto che il documento venga dichiarato incompleto.
function leggiJsonAncheStorto(testo) {
  try { return JSON.parse(testo); } catch (_) {}
  try { return JSON.parse(chiudiParentesi(String(testo))); } catch (_) {}
  return null;
}

// Scorre il testo tenendo conto delle virgolette e delle barre di protezione, e
// restituisce lo stesso testo con le parentesi ancora aperte chiuse in fondo.
function chiudiParentesi(t) {
  const pila = [];
  let dentroStringa = false, protetta = false;
  for (const ch of t) {
    if (protetta) { protetta = false; continue; }
    if (ch === '\\') { protetta = true; continue; }
    if (ch === '"') { dentroStringa = !dentroStringa; continue; }
    if (dentroStringa) continue;
    if (ch === '{' || ch === '[') pila.push(ch);
    else if (ch === '}' || ch === ']') pila.pop();
  }
  let fuori = t;
  if (dentroStringa) fuori += '"';
  while (pila.length) fuori += pila.pop() === '{' ? '}' : ']';
  return fuori;
}

const FORMA = {
  copertina: ['titolo', 'periodo'], filo: ['titolo', 'corpo'],
  portiVia: ['titolo', 'punti'], nonTornareIndietro: ['titolo', 'punti'],
  paroleDelCoach: ['titolo', 'corpo'], chiusura: ['titolo', 'messaggio'],
};
function normalizza(grezzo) {
  const d = Object.assign({}, grezzo || {});
  for (const k of Object.keys(d)) {
    if (typeof d[k] === 'string' && /^\s*[[{]/.test(d[k])) {
      const letto = leggiJsonAncheStorto(d[k]);
      if (letto !== null) d[k] = letto;   // se resta testo, lo becca il controllo qui sotto
    }
  }
  const mancano = [];
  for (const [k, campi] of Object.entries(FORMA)) {
    if (!d[k] || typeof d[k] !== 'object') { mancano.push(k); continue; }
    for (const c of campi) if (d[k][c] === undefined) mancano.push(k + '.' + c);
  }
  for (const k of ['momenti', 'numeri', 'daQuiInAvanti']) {
    if (!Array.isArray(d[k])) mancano.push(k + ' (deve essere un elenco)');
  }
  if (!Array.isArray(d.portiVia && d.portiVia.punti)) mancano.push('portiVia.punti (deve essere un elenco)');
  if (!Array.isArray(d.nonTornareIndietro && d.nonTornareIndietro.punti)) mancano.push('nonTornareIndietro.punti (deve essere un elenco)');
  if (mancano.length) throw new Error('Il documento generato è incompleto: manca ' + mancano.join(', '));
  return d;
}

async function generaContenuti({ materiale }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY non configurata');
  const { system, user } = costruisciPrompt(materiale);
  const client = new Anthropic();
  const r = await client.messages.create({
    model: MODEL, max_tokens: 16000, system,
    messages: [{ role: 'user', content: user }],
    tools: [{ name: 'documento', description: 'Il documento di chiusura', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'documento' },
  });
  const blocco = r.content.find(b => b.type === 'tool_use');
  if (!blocco) throw new Error("L'IA non ha restituito il documento");
  return normalizza(blocco.input);
}

// ── 8 · IL MAGAZZINO — generato e correzioni, sempre separati ────────────────
// 🔴 LA REGOLA CHE TIENE IN PIEDI TUTTO: `generato` lo riscrive la macchina ogni
// volta che serve (arriva la seconda ruota, arriva il report della Final, si
// rigenera); `correzioni` è del coach e NON si tocca MAI da codice automatico.
// Quando si mostra il documento, dove c'è una correzione vince la correzione.
// Senza questa divisione, il primo aggiornamento cancellerebbe quello che lui ha
// letto, corretto e approvato prima della sessione.

// La chiave di una correzione è il "sentiero" dentro il documento: 'filo.titolo',
// 'momenti.2.corpo.0', 'chiusura.messaggio'. Così una correzione resta attaccata
// al suo pezzo anche se intorno cambia altro.
function valoreDa(oggetto, sentiero) {
  return String(sentiero).split('.').reduce((o, k) => (o == null ? undefined : o[k]), oggetto);
}
function scriviIn(oggetto, sentiero, valore) {
  const parti = String(sentiero).split('.');
  let o = oggetto;
  for (let i = 0; i < parti.length - 1; i++) {
    const k = parti[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(parti[i + 1]) ? [] : {};
    o = o[k];
  }
  o[parti[parti.length - 1]] = valore;
}

// Il documento come si vede: generato + correzioni sopra. Non modifica gli originali.
// ⭐ Una correzione può essere DUE cose (22/08):
//  · un testo → sostituisce quel pezzo;
//  · un ELENCO INTERO → sostituisce tutta la lista. È così che il coach può
//    riscrivere un punto, TOGLIERNE uno o AGGIUNGERNE uno: la lista che conta è
//    quella che ha lasciato lui, non quella che aveva prodotto la macchina.
function unisci(generato, correzioni) {
  const fuori = JSON.parse(JSON.stringify(generato || {}));
  for (const [sentiero, testo] of Object.entries(correzioni || {})) {
    if (Array.isArray(testo)) {                       // l'elenco riscritto dal coach
      if (valoreDa(fuori, sentiero) !== undefined) scriviIn(fuori, sentiero, testo);
      continue;
    }
    // Una correzione su un pezzo che non esiste più (documento rigenerato con meno
    // momenti) NON si butta via: si lascia dov'è nel magazzino e semplicemente non
    // si mostra. Buttarla sarebbe perdere il lavoro del coach senza dirglielo.
    if (valoreDa(fuori, sentiero) === undefined) continue;
    scriviIn(fuori, sentiero, testo);
  }
  return fuori;
}

async function caricaDocumento({ percorsoId }) {
  const r = await db.query("SELECT * FROM documenti WHERE percorso_id=$1 AND tipo='chiusura'", [percorsoId]);
  return r.rows[0] || null;
}

// Scrive SOLO la parte generata. Le correzioni restano quelle: è la ragione per cui
// le due colonne esistono.
async function salvaGenerato({ percorsoId, clientId, sedutaId, contenuti, ruote }) {
  const { v4: uuidv4 } = require('uuid');
  const esistente = await caricaDocumento({ percorsoId });
  const ruotaIntake = ruote && ruote.intake ? ruote.intake.id : null;
  const ruotaFinal  = ruote && ruote.final  ? ruote.final.id  : null;
  if (esistente) {
    await db.query(
      `UPDATE documenti SET generato=$2, generato_at=NOW(), updated_at=NOW(),
              seduta_id=COALESCE($3, seduta_id), ruota_intake_id=$4, ruota_final_id=$5
        WHERE id=$1`,
      [esistente.id, JSON.stringify(contenuti), sedutaId, ruotaIntake, ruotaFinal]);
    return esistente.id;
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO documenti (id, percorso_id, client_id, seduta_id, tipo, stato, generato, generato_at, ruota_intake_id, ruota_final_id)
     VALUES ($1,$2,$3,$4,'chiusura','bozza',$5,NOW(),$6,$7)`,
    [id, percorsoId, clientId, sedutaId, JSON.stringify(contenuti), ruotaIntake, ruotaFinal]);
  return id;
}

// Più correzioni in un colpo solo (il pulsante «Salva» della pagina).
async function salvaCorrezioni({ documentoId, correzioni }) {
  const voci = Object.entries(correzioni || {});
  if (!voci.length) return 0;
  await db.query(
    `UPDATE documenti SET correzioni = COALESCE(correzioni,'{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1`, [documentoId, JSON.stringify(Object.fromEntries(voci))]);
  return voci.length;
}

// Una correzione del coach: si aggiunge alle sue, non tocca il generato.
async function salvaCorrezione({ documentoId, sentiero, testo }) {
  await db.query(
    `UPDATE documenti SET correzioni = COALESCE(correzioni,'{}'::jsonb) || jsonb_build_object($2::text, $3::text),
            updated_at = NOW() WHERE id = $1`,
    [documentoId, sentiero, testo]);
}

module.exports = { MODEL, SCHEMA, costruisciPrompt, generaContenuti, normalizza,
  unisci, caricaDocumento, salvaGenerato, salvaCorrezione, salvaCorrezioni, raccogliMateriale, datiDalDatabase, testiDeiReport, scegliRuote, variazioniRuote, leggiAree };
