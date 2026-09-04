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

console.log(falliti ? `\n🔴 ${falliti} prove fallite` : '\n✅ conformità: tutte le prove passano');
process.exit(falliti ? 1 : 0);
