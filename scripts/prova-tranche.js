// PROVA DEL PIANO DI PAGAMENTO — server/tranche.js.
//
// Nessun database, nessuna rete: entra una quota, escono le tranche. La parte
// che conta è l'ARROTONDAMENTO: le cifre devono restare intere (regola di
// Germano del 27/07) e la somma deve tornare ESATTA, altrimenti si emettono
// proforma giuste una per una e sbagliate tutte insieme.
//
//   node scripts/prova-tranche.js

const tr = require('../server/tranche');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

console.log('— LA PROPOSTA 30/40/30 —');
{
  const p = tr.pianoProposto(7000);
  prova('su 7.000 escono tre tranche', 3, p.length);
  prova('gli importi sono 2.100 · 2.800 · 2.100', [2100, 2800, 2100], p.map(x => x.importo));
  prova('le etichette dicono cosa sono', ['Acconto', 'Metà percorso', 'Saldo'], p.map(x => x.etichetta));
  prova('gli inneschi sono firma · metà · fine', ['firma', 'meta', 'fine'], p.map(x => x.innesco));
  prova('il termine di pagamento è 30 giorni', [30, 30, 30], p.map(x => x.giorni));
}

console.log('\n— L’ARROTONDAMENTO (la parte che può mentire) —');
{
  // 30% di 3.333 fa 999,9 e 40% fa 1.333,2: se si arrotondasse ogni riga per
  // conto suo la somma non tornerebbe, e nessuna singola riga sembrerebbe storta.
  const p = tr.pianoProposto(3333);
  prova('nessun centesimo: sono tutti numeri interi',
    true, p.every(x => Number.isInteger(x.importo)));
  prova('la somma torna ESATTA anche quando le percentuali non cadono tonde',
    3333, p.reduce((s, x) => s + x.importo, 0));
  prova('il resto si carica sull’ultima tranche, il saldo', [1000, 1333, 1000], p.map(x => x.importo));

  for (const q of [1, 7, 99, 100, 1234, 9999, 12345]) {
    const somma = tr.pianoProposto(q).reduce((s, x) => s + x.importo, 0);
    prova(`somma esatta su € ${q}`, q, somma);
  }
}

console.log('\n— QUANDO UN PIANO NON SI PUÒ SALVARE —');
{
  const buono = tr.pianoProposto(7000);
  prova('un piano che torna non ha problemi', [], tr.problemi(buono, 7000));
  // ⚠️ Niente confronto sul testo formattato: in italiano un numero di 4 cifre
  // NON prende il punto delle migliaia (7000, non 7.000), e una prova che si
  // appoggia alla formattazione fallisce per il motivo sbagliato.
  prova('se le tranche non sommano la quota, lo dice con tutti e due i numeri', true,
    (m => m.includes('1000') && m.includes('7000'))(
      tr.problemi([{ importo: 1000, innesco: 'firma', giorni: 30 }], 7000)[0]));
  prova('una tranche a zero si segnala', true,
    tr.problemi([{ importo: 7000, innesco: 'firma', giorni: 30 },
                 { importo: 0, innesco: 'fine', giorni: 30 }], 7000)
      .some(m => m.includes('a zero')));
  prova('un innesco che non esiste si segnala', true,
    tr.problemi([{ importo: 7000, innesco: 'quandocapita', giorni: 30 }], 7000)
      .some(m => m.includes('quando va chiesta')));
  prova('un piano vuoto non è un piano', 1, tr.problemi([], 7000).length);
}

console.log('\n— LA SCADENZA —');
{
  const prog = { data_inizio: '2026-09-01', data_meta: null, data_fine: '2026-12-15' };
  prova('firma + 30 giorni', '2026-10-01', tr.scadenza({ innesco: 'firma', giorni: 30 }, prog));
  prova('fine + 30 giorni, anche a cavallo dell’anno', '2027-01-14',
    tr.scadenza({ innesco: 'fine', giorni: 30 }, prog));
  prova('senza la data di metà percorso non si inventa una scadenza',
    null, tr.scadenza({ innesco: 'meta', giorni: 30 }, prog));
  prova('zero giorni = il giorno stesso', '2026-09-01',
    tr.scadenza({ innesco: 'firma', giorni: 0 }, prog));
}

// ── C3 (17/08): «CHIESTA» SI RICAVA, NON SI SPUNTA ─────────────────────────
console.log('\n— A CHE PUNTO È UNA RATA —');
{
  const rate = [
    { id: 'a', importo: 1000, stato: 'da_chiedere' },
    { id: 'b', importo: 2000, stato: 'da_chiedere' },
    { id: 'c', importo: 3000, stato: 'incassata' },
  ];
  // La mappa dice, per ogni rata, in che stato e il documento che la contiene.
  const doc = new Map([['b', 'inviata'], ['c', 'inviata']]);
  prova('senza la mappa si ripiega sulla colonna salvata',
    'da_chiedere', tr.statoDi(rate[1]));
  prova('una rata dentro una proforma MANDATA è chiesta',
    'chiesta', tr.statoDi(rate[1], doc));
  prova('🔴 una rata dentro una proforma solo CREATA è «da mandare», NON chiesta',
    'da_mandare', tr.statoDi(rate[1], new Map([['b', 'emessa']])));
  prova('⭐ incassata VINCE su tutto: sta ancora dentro la sua proforma',
    'incassata', tr.statoDi(rate[2], doc));
  prova('una rata che non sta in nessuna proforma resta da chiedere',
    'da_chiedere', tr.statoDi(rate[0], doc));
  prova('una «chiesta» salvata senza documento non regge: comanda il documento',
    'da_chiedere', tr.statoDi({ id: 'z', stato: 'chiesta' }, new Map()));
  prova('i quattro numeri seguono la stessa regola',
    { concordato: 6000, daChiedere: 1000, chiesto: 2000, incassato: 3000 },
    tr.totali(rate, 6000, doc));
  prova('⭐ «da mandare» sta dentro DA CHIEDERE: a chi paga non li ha chiesti nessuno',
    { concordato: 6000, daChiedere: 3000, chiesto: 0, incassato: 3000 },
    tr.totali(rate, 6000, new Map([['b', 'emessa'], ['c', 'inviata']])));
  prova('⭐ annullata la proforma (la rata esce dalla mappa), torna da chiedere DA SOLA',
    { concordato: 6000, daChiedere: 3000, chiesto: 0, incassato: 3000 },
    tr.totali(rate, 6000, new Map([['c', 'inviata']])));
}

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
