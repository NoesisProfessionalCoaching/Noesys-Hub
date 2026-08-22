// ═══════════════════════════════════════════════════════════════════════════
// PROVA DELLE DUE RUOTE E DELLE VARIAZIONI — server/documento-chiusura.js.
//
// Perché serve. Il confronto fra la ruota d'intake e quella della Final è il
// cuore del documento di chiusura, ed è anche il punto più delicato per la
// legge: l'analisi deve restare SOLO NUMERICA (cosa si è mosso e di quanto),
// perché a dire cosa significa è il Cliente, non la macchina.
// Qui si prova che: le due ruote si scelgono per DATA, non si mescolano
// strumenti diversi, e i conti tornano — comprese le aree che non si possono
// confrontare, che vanno DETTE e non fatte sparire.
//
// Non serve né database né rete: sono funzioni pure.
//   node scripts/prova-documento-chiusura.js
// ═══════════════════════════════════════════════════════════════════════════
const doc = require('../server/documento-chiusura.js');

let falliti = 0;
// Racchiude una prova che potrebbe SCHIANTARSI: un guasto deve stampare «✗» e
// dire cosa non andava, non fermare tutto con un pilone di errore (imparato qui
// il 21/08: la prova falliva davvero, ma non si capiva perché).
function provaChe(titolo, atteso, fn) {
  let ottenuto;
  try { ottenuto = fn(); }
  catch (e) { ottenuto = 'ERRORE: ' + e.message; }
  prova(titolo, atteso, ottenuto);
}
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) console.log(`✓ ${titolo}`);
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}
// Una riga di `sessions` come la scrive lo strumento.
const ruota = (id, tool, quando, valori) => ({
  id, tool, created_at: quando,
  data: JSON.stringify({ areas: Object.entries(valori).map(([name, value]) => ({ name, value })) }),
});

const INTAKE = ruota('r-intake', 'ruotavita', '2026-04-22T10:00:00Z',
  { 'Crescita\nPersonale': 5, 'Carriera': 6, 'Salute': 7, 'Amici e\nFamiglia': 8 });
const FINAL = ruota('r-final', 'ruotavita', '2026-07-13T13:00:00Z',
  { 'crescita personale': 8, 'Carriera': 6, 'Salute': 5, 'Amici e\nFamiglia': 9 });

// ── Quali due ruote ─────────────────────────────────────────────────────────
{
  const sola = doc.scegliRuote([INTAKE]);
  prova('con una ruota sola: è quella d\'intake, la final manca', ['r-intake', null],
    [sola.intake && sola.intake.id, sola.final]);
  prova('e lo dice, invece di far finta di niente', true, /una ruota sola/.test(sola.avviso || ''));

  const due = doc.scegliRuote([FINAL, INTAKE]); // apposta in ordine sbagliato
  prova('con due ruote: la più vecchia è l\'intake, la più recente la final',
    ['r-intake', 'r-final'], [due.intake.id, due.final.id]);

  const mista = doc.scegliRuote([INTAKE, FINAL, ruota('r-lead', 'ruota-leadership', '2026-08-01T10:00:00Z', { 'Visione': 7 })]);
  prova('non mescola strumenti diversi: sceglie quello con due versioni',
    ['ruotavita', 'r-intake', 'r-final'], [mista.tool, mista.intake.id, mista.final.id]);

  const rotta = doc.scegliRuote([{ id: 'x', tool: 'ruotavita', created_at: '2026-01-01', data: 'non è json' }]);
  prova('una riga illeggibile non fa cadere niente', null, rotta.intake);
}

// ── Il caso BUSINESS: più ruote diverse (vita · business · leadership) ──────
// Quale confrontare lo dice la ruota che si fa nella Final. Finché non c'è,
// l'Hub non sceglie a caso: lo dice e aspetta. (Regola di Germano, 22/08.)
{
  const vitaIntake = INTAKE;
  const leadIntake = ruota('r-lead-1', 'ruota-leadership', '2026-04-22T11:00:00Z', { 'Visione': 5, 'Delega': 6 });
  // ⚠️ ORE 15: dopo la ruota della vita del 13 luglio (ore 13). Serve al caso in cui
  // i tipi rifatti siano due: deve vincere quella fatta PER ULTIMA, cioè in sessione.
  const leadFinal  = ruota('r-lead-2', 'ruota-leadership', '2026-07-13T15:00:00Z', { 'Visione': 8, 'Delega': 7 });

  const dubbio = doc.scegliRuote([vitaIntake, leadIntake]);
  prova('due ruote diverse, una a testa: non sceglie a caso', [null, null],
    [dubbio.intake, dubbio.final]);
  prova('e dice quali sono, invece di tacere', true,
    /ruotavita/.test(dubbio.avviso || '') && /leadership/.test(dubbio.avviso || ''));

  const deciso = doc.scegliRuote([vitaIntake, leadIntake, leadFinal]);
  prova('appena una viene rifatta, è quella: si confronta con la sua gemella',
    ['ruota-leadership', 'r-lead-1', 'r-lead-2'], [deciso.tool, deciso.intake.id, deciso.final.id]);

  const dueRifatte = doc.scegliRuote([INTAKE, FINAL, leadIntake, leadFinal]);
  prova('se i tipi rifatti sono due, vince quello fatto per ultimo (in sessione)',
    'ruota-leadership', dueRifatte.tool);

  const solaLeadership = doc.scegliRuote([leadIntake]);
  prova('un tipo solo, anche se non è la ruota della vita: è l\'intake e si aspetta',
    ['r-lead-1', null], [solaLeadership.intake.id, solaLeadership.final]);
}

// ── I conti ─────────────────────────────────────────────────────────────────
{
  const v = doc.variazioniRuote(INTAKE, FINAL);
  prova('confronta le aree anche se scritte con maiuscole e a capo diversi', 4, v.aree.length);
  prova('salite, scese e ferme', [2, 1, 1], [v.salite, v.scese, v.ferme]);
  prova('la crescita più grande è quella giusta', ['Crescita Personale', 3],
    [v.maggiore.area, v.maggiore.variazione]);
  prova('una discesa resta una discesa (non si addolcisce)', -2,
    v.aree.find(a => a.area === 'Salute').variazione);
  prova('le medie, prima e dopo', [6.5, 7], [v.mediaPrima, v.mediaDopo]);
  prova('nessuna area non confrontabile', [], v.areeNonConfrontabili);
}
{
  // Il cliente ha rinominato un'area: NON si confronta a caso, si dichiara.
  const finalRinominata = ruota('r-f2', 'ruotavita', '2026-07-13T13:00:00Z',
    { 'Crescita\nPersonale': 8, 'Lavoro': 9 });
  const v = doc.variazioniRuote(INTAKE, finalRinominata);
  prova('confronta solo le aree che esistono in tutt\'e due', ['Crescita Personale'], v.aree.map(a => a.area));
  prova('e le altre le dichiara, invece di ignorarle in silenzio',
    ['Carriera', 'Salute', 'Amici e Famiglia', 'lavoro'].sort(), v.areeNonConfrontabili.slice().sort());
}
{
  prova('con una ruota sola non si inventa nessun confronto', null, doc.variazioniRuote(INTAKE, null));
}

// ── Il raddrizzatore di quello che torna dall'IA ────────────────────────────
// Caso VERO del 21/08: sui report di Francesco il modello ha restituito due
// sezioni come testo che contiene JSON. Il contenuto era giusto, la forma no.
{
  const buono = {
    copertina: { titolo: 'x', periodo: 'y' }, filo: { titolo: 'x', corpo: ['a'] },
    momenti: [], numeri: [], daQuiInAvanti: [],
    portiVia: { titolo: 'x', punti: [{ titolo: 'a', testo: 'b' }] },
    nonTornareIndietro: { titolo: 'x', punti: [{ segnale: 'a', contromossa: 'b' }] },
    paroleDelCoach: { titolo: 'x', corpo: ['a'] }, chiusura: { titolo: 'x', messaggio: 'y' },
  };
  const storto = Object.assign({}, buono, { portiVia: JSON.stringify(buono.portiVia) });
  provaChe('una sezione arrivata come testo torna una struttura', ['x', 1], () => {
    const raddrizzato = doc.normalizza(storto);
    return [raddrizzato.portiVia.titolo, raddrizzato.portiVia.punti.length];
  });

  // Il caso vero: la sezione è arrivata come testo E TRONCATA (mancava la graffa).
  const troncata = JSON.stringify(buono.portiVia).slice(0, -1);
  provaChe('una sezione troncata si richiude e si legge lo stesso', ['x', 1], () => {
    const salvata = doc.normalizza(Object.assign({}, buono, { portiVia: troncata }));
    return [salvata.portiVia.titolo, salvata.portiVia.punti.length];
  });

  // Parentesi e virgolette DENTRO il testo non devono confondere il conteggio.
  // ⚠️ La parentesi dentro la frase è SPAIATA apposta: se il conteggio non tenesse
  // conto delle virgolette, aggiungerebbe una chiusura di troppo e non si leggerebbe più.
  const insidiosa = JSON.stringify({ titolo: 'x', punti: [{ titolo: 'a', testo: 'ha detto "vado" e lasciò la frase { a metà' }] }).slice(0, -1);
  provaChe('le parentesi dentro le frasi non confondono la riparazione',
    'ha detto "vado" e lasciò la frase { a metà',
    () => doc.normalizza(Object.assign({}, buono, { portiVia: insidiosa })).portiVia.punti[0].testo);

  let detto = null;
  try { doc.normalizza(Object.assign({}, buono, { chiusura: undefined })); }
  catch (e) { detto = e.message; }
  prova('se manca un pezzo lo DICE, invece di mostrare il vuoto', true, /chiusura/.test(detto || ''));

  let detto2 = null;
  try { doc.normalizza(Object.assign({}, buono, { momenti: 'tre' })); }
  catch (e) { detto2 = e.message; }
  prova('e si accorge anche se un elenco non è un elenco', true, /momenti/.test(detto2 || ''));
}

console.log(falliti ? `\n✗ ${falliti} controlli falliti.` : '\n✓ Tutti i controlli passati.');
process.exit(falliti ? 1 : 0);
