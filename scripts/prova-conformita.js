// PROVA DI CONFORMITÀ — fetta 0.5 del riordino (04/09/2026).
//
// Due regole che non stanno in nessun conto e che un compilatore non vede:
//
// 1. IL PROMPT DELL'ESTRATTORE non deve dedurre come sta una persona. I contratti
//    lo promettono cinque volte («nessuno strumento analizza o deduce lo stato
//    emotivo o psicologico»), ed è la linea rossa dell'AI Act: l'Hub riporta ciò
//    che il coach ha scritto nel report, non descrive la persona. Fino al 03/09 il
//    prompt non lo vietava e l'esempio di stile mostrava «Freni emotivi»: un esempio
//    pesa più di una regola generica. Qui si legge il testo del prompt.
//
// 2. I PASSAGGI DI STATO DEL CONTRATTO seguono le tabelle AVANTI/INDIETRO di
//    `contratti-stato.js`. Un salto (da «da redigere» ad «approvata») congelerebbe
//    un progetto con una chiamata sola; e «da redigere» non si scrive mai, perché
//    è l'assenza della riga. La rotta usa `passaggioAmmesso`: qui si prova la
//    regola pura, in `prova-pagine-vive` la rotta che la applica.
//
//   node scripts/prova-conformita.js

const claude = require('../server/claude');
const cs = require('../server/contratti-stato');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

console.log('— IL PROMPT DELL\'ESTRATTORE NON DEDUCE COME STA LA PERSONA —');
const P = String(claude.SYSTEM || '');
prova('il prompt dell\'estrattore è esportato e non è vuoto', true, P.length > 200);
prova('contiene il divieto: non dedurre né descrivere lo stato emotivo o psicologico', true,
  /non (dedur|descriv)[^\n]*(emotiv|psicolog)/i.test(P));
prova('e dice di riportare solo ciò che il report dichiara', true, /solo ciò che il report (dichiara|dice|scrive)/i.test(P));
const esempio = P.slice(P.indexOf('Esempio di STILE'));
prova('l\'esempio di stile esiste', true, esempio.length > 50 && esempio.length < P.length);
prova('e non mostra argomenti emotivi («Freni emotivi» era l\'esempio fino al 03/09)', false, /emotiv|psicolog|ansia|paura/i.test(esempio));

console.log('\n— I PASSAGGI DI STATO DEL CONTRATTO —');
const ammesso = cs.passaggioAmmesso;
prova('la regola esiste in contratti-stato.js', 'function', typeof ammesso);
if (typeof ammesso === 'function') {
  // in avanti, un passo alla volta
  prova('da redigere → da inviare (l\'ho preparata)', true, ammesso('da_redigere', 'da_inviare'));
  prova('riga assente = da redigere: null → da inviare', true, ammesso(null, 'da_inviare'));
  prova('da inviare → in attesa (l\'ho inviata)', true, ammesso('da_inviare', 'in_attesa'));
  prova('in attesa → approvata (è tornata firmata)', true, ammesso('in_attesa', 'approvata'));
  // le due azioni di modifica: entrambe riportano a «da inviare»
  prova('in attesa → da inviare (modifica contratto inviato)', true, ammesso('in_attesa', 'da_inviare'));
  prova('approvata → da inviare (modifica contratto approvato): DEVE restare possibile', true, ammesso('approvata', 'da_inviare'));
  // i salti
  prova('⛔ da redigere → approvata: un salto congelerebbe il progetto', false, ammesso('da_redigere', 'approvata'));
  prova('⛔ da redigere → in attesa: salta «da inviare»', false, ammesso('da_redigere', 'in_attesa'));
  prova('⛔ da inviare → approvata: salta «in attesa»', false, ammesso('da_inviare', 'approvata'));
  prova('⛔ approvata → in attesa: indietro di un passo non esiste, si torna a «da inviare»', false, ammesso('approvata', 'in_attesa'));
  prova('⛔ in attesa → in attesa: restare fermi non è un passaggio', false, ammesso('in_attesa', 'in_attesa'));
  // «da redigere» non si scrive mai
  for (const da of cs.CHIAVI) prova(`⛔ ${da} → da redigere: è l'assenza della riga, non si scrive`, false, ammesso(da, 'da_redigere'));
  prova('⛔ uno stato inventato non è mai ammesso', false, ammesso('da_inviare', 'firmata'));
  prova('⛔ da uno stato inventato non si parte', false, ammesso('firmata', 'da_inviare'));
}

console.log('\n— I DATI DI COLLAUDO NON ENTRANO NEI NUMERI (fetta 1.4) —');
const co = require('../server/collaudo');
prova('il filtro tiene fuori solo TRUE: NULL conta come vero (decisione 2 di Germano)', 'COALESCE(c.di_collaudo, FALSE) = FALSE', co.filtro('c'));
prova('il cartellino compare solo sui record di collaudo', true, /di collaudo/.test(co.badge(true)) && co.badge(false) === '' && co.badge(null) === '');
prova('l\'interruttore di un record vero propone «segna come di collaudo»', true, /segna come di collaudo/.test(co.interruttore('cliente', 'x', false)) && /segnaCollaudo\('cliente','x',true\)/.test(co.interruttore('cliente', 'x', false)));
prova('quello di un record di collaudo propone «è un record vero»', true, /è un record vero/.test(co.interruttore('cliente', 'x', true)) && /segnaCollaudo\('cliente','x',false\)/.test(co.interruttore('cliente', 'x', true)));
prova('quello di un record non classificato propone entrambe', true, /non classificato/.test(co.interruttore('progetto', 'y', null)) && /,true\)/.test(co.interruttore('progetto', 'y', null)) && /,false\)/.test(co.interruttore('progetto', 'y', null)));
prova('il cartello tace se non c\'è niente da dire', '', co.cartello({ collaudo: {}, nonClassificati: {} }));
const cart = co.cartello({ collaudo: { clienti: 5, committenti: 2, progetti: 1 }, nonClassificati: { clienti: 1 } });
prova('e altrimenti conta i record di collaudo per tipo', true, /8 record di collaudo/.test(cart) && /5 clienti · 2 committenti · 1 progetto/.test(cart));
prova('e dice che i non classificati contano come veri', true, /1 record non ancora classificato conta/.test(cart) && /come vero/.test(cart));
prova('le tre tabelle', ['clients', 'committenti', 'progetti'], Object.values(co.TABELLE));

// ── UNO STRUMENTO NUOVO SI REGISTRA IN SEI PUNTI (fetta 1.1, 04/09/2026) ─────
// Regola del CLAUDE.md dell'Hub: «Uno strumento nuovo va registrato in sei punti
// (quattro in Coaching-Tools, due qui). Dimenticarne uno = uno strumento
// invisibile da qualche parte.» Era una riga di prosa: qui diventa un controllo
// che legge i SORGENTI. Nell'Hub: l'elenco STRUMENTI e i `case` dell'anteprima
// (renderSessionData). In Coaching-Tools, se il repo è sul Mac: l'elenco degli
// strumenti, le famiglie del portale, le etichette in pagina, l'elenco con la
// descrizione, e il file HTML dello strumento.
console.log('\n— UNO STRUMENTO NUOVO SI REGISTRA IN SEI PUNTI —');
const fs = require('fs');
const path = require('path');
const HUB_ROUTES = path.join(__dirname, '..', 'server', 'routes.js');
const TOOLS_REPO = path.join(__dirname, '..', '..', 'Coaching-Tools');

/** Le key dell'elenco STRUMENTI e quelle dei `case` dell'anteprima, lette dal sorgente. */
function puntiHub(src) {
  const blocco = (src.match(/const STRUMENTI = \[([\s\S]*?)\];/) || [])[1] || '';
  const elenco = [...blocco.matchAll(/key:\s*'([\w-]+)'/g)].map(m => m[1]);
  const corpo = (src.match(/function renderSessionData\([\s\S]*?\n\}\n/) || [])[0] || '';
  const anteprima = [...corpo.matchAll(/case '([\w-]+)':/g)].map(m => m[1]);
  return { elenco, anteprima };
}
/** Chi manca da dove: vuoto se i due punti dicono le stesse key. */
function mancantiHub(src) {
  const { elenco, anteprima } = puntiHub(src);
  const out = [];
  for (const k of elenco) if (!anteprima.includes(k)) out.push(`«${k}» è nell'elenco STRUMENTI ma l'anteprima non sa disegnarlo`);
  for (const k of anteprima) if (!elenco.includes(k)) out.push(`«${k}» ha un'anteprima ma non è nell'elenco STRUMENTI`);
  if (!elenco.length) out.push('elenco STRUMENTI non trovato nel sorgente');
  if (!anteprima.length) out.push('i case dell\'anteprima non sono stati trovati nel sorgente');
  return out;
}
const srcHub = fs.readFileSync(HUB_ROUTES, 'utf8');
const { elenco: keysHub } = puntiHub(srcHub);
prova('l\'Hub conosce almeno dieci strumenti', true, keysHub.length >= 10);
prova('nell\'Hub elenco e anteprima dicono le stesse key', [], mancantiHub(srcHub));
// 🔬 e il controllo sa fallire: un case tolto apposta deve farsi notare
prova('🔬 rotto apposta: senza il case del genogramma il controllo se ne accorge',
  ['«genogramma» è nell\'elenco STRUMENTI ma l\'anteprima non sa disegnarlo'],
  mancantiHub(srcHub.replace("case 'genogramma': {", "{")));

if (fs.existsSync(path.join(TOOLS_REPO, 'server', 'routes.js'))) {
  const srcTools = fs.readFileSync(path.join(TOOLS_REPO, 'server', 'routes.js'), 'utf8');
  /** I quattro punti di Coaching-Tools per una key. */
  function puntiTools(src, k) {
    const q = k.replace(/[-]/g, '\\-');
    const elenco = new RegExp(`\\{\\s*key:\\s*'${q}',\\s*label:`).test(src);
    const famiglia = new RegExp(`keys:\\s*\\[[^\\]]*'${q}'`).test(src);
    const etichetta = new RegExp(`(?:^|[{,])\\s*'?${q}'?\\s*:\\s*'[^']+'`, 'm').test(src);
    const descrizione = new RegExp(`key:\\s*'${q}',\\s*label:\\s*'[^']+',\\s*desc:`).test(src);
    const file = fs.existsSync(path.join(TOOLS_REPO, 'public', 'tools', k + '.html'));
    return { elenco, famiglia, etichetta, descrizione, file };
  }
  const mancanti = [];
  for (const k of keysHub) {
    const p = puntiTools(srcTools, k);
    for (const [nome, ok] of Object.entries(p)) if (!ok) mancanti.push(`«${k}»: manca in Coaching-Tools → ${nome}`);
  }
  prova('ogni strumento dell\'Hub è registrato nei quattro punti di Coaching-Tools, col suo file', [], mancanti);
  prova('🔬 rotto apposta: uno strumento inventato manca ovunque', 5,
    Object.values(puntiTools(srcTools, 'strumento-inventato')).filter(v => !v).length);
} else {
  console.log('   (Coaching-Tools non è su questo Mac: i suoi quattro punti non si controllano qui)');
}

console.log(falliti ? `\n🔴 ${falliti} prove fallite` : '\n✅ conformità: tutte le prove passano');
process.exit(falliti ? 1 : 0);
