// PROVA DELLA PROFORMA — controlla la parte «comporre» di server/proforma.js.
//
// Nessun database, nessuna rete, nessun PDF: qui si verifica che dalle sedute
// escano le righe giuste e i conti giusti. La stampa è un'altra cosa e si guarda
// a occhio (scripts/prova-proforma-pdf.js scrive un PDF di esempio).
//
//   node scripts/prova-proforma.js
//
// Esce con codice 0 se è tutto a posto, 1 se una regola si è rotta.

const pf = require('../server/proforma');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

// Il cliente di collaudo dei soldi: privato italiano, dati completi.
const cliente = {
  nome: 'Prova', cognome: 'Soldi', paese: 'IT', codice_fiscale: 'PRVSLD80A01F205X',
  via: 'Via delle Prove 1', cap: '20100', citta: 'Milano', provincia: 'MI',
  email: 'prova@esempio.it',
};
const emittente = {
  denominazione: 'Noesys Professional Coaching', via: 'Via Roma 1', cap: '20100',
  citta: 'Milano', provincia: 'MI', paese: 'IT', partita_iva: '12345678901',
  regime: 'ordinario', iban: 'IT60X0542811101000000123456',
};
// Luglio 2026 di Prova Soldi: 3 sessioni da 100 €, di cui una di Intake.
const sedute = [
  { id: 's2', percorso_id: 'p1', data: '2026-07-20', tipo: 'Ongoing', prezzo: 100 },
  { id: 's1', percorso_id: 'p1', data: '2026-07-06', tipo: 'Intake',  prezzo: 100 },
  { id: 's3', percorso_id: 'p1', data: '2026-07-31', tipo: 'Ongoing', prezzo: 100 },
];

console.log('— IL NUMERO —');
prova('il primo dell’anno', '2026/001', pf.numeroProforma(2026, 1));
prova('a tre cifre resta a tre cifre', '2026/123', pf.numeroProforma(2026, 123));
prova('oltre le tre cifre non si tronca', '2026/1234', pf.numeroProforma(2026, 1234));

console.log('\n— LE RIGHE: UNA PER SESSIONE —');
{
  const righe = pf.righeDaSedute(sedute);
  prova('tre sessioni, tre righe', 3, righe.length);
  prova('in ordine di data, non nell’ordine in cui arrivano',
    ['2026-07-06', '2026-07-20', '2026-07-31'], righe.map(r => r.data));
  prova('⭐ l’INTAKE vale due sessioni: quantità 2 e importo doppio',
    { quantita: 2, prezzo_unitario: 100, importo: 200 },
    { quantita: righe[0].quantita, prezzo_unitario: righe[0].prezzo_unitario,
      importo: righe[0].importo });
  prova('una sessione normale vale una',
    { quantita: 1, importo: 100 },
    { quantita: righe[1].quantita, importo: righe[1].importo });
  prova('la descrizione dice al cliente cos’è, senza gergo nostro',
    ['Sessione di coaching (Intake)', 'Sessione di coaching (Ongoing)'],
    [righe[0].descrizione, righe[1].descrizione]);
  prova('ogni riga si ricorda da quale seduta viene: è ciò che impedisce di chiederla due volte',
    ['s1', 's2', 's3'], righe.map(r => r.seduta_id));
  prova('una seduta senza data non entra: non si sa a che mese appartiene',
    0, pf.righeDaSedute([{ id: 'x', tipo: 'Ongoing', prezzo: 100 }]).length);
}

console.log('\n— IL DOCUMENTO COMPLETO: il caso vero di Prova Soldi —');
{
  const righe = pf.righeDaSedute(sedute);
  const d = pf.componiProforma({ righe, cliente, emittente, dataEmissione: '2026-08-03' });
  prova('imponibile: 3 sessioni di cui un intake ×2 = 400 €', 400, d.conti.imponibile);
  prova('IVA 22% = 88, da bonificare 488',
    { iva: 88, daPagare: 488 }, { iva: d.conti.iva, daPagare: d.conti.daPagare });
  prova('nessuna ritenuta a un privato', 0, d.conti.ritenuta);
  prova('la categoria è congelata nel documento', 'privato_it', d.categoria);
  prova('il periodo va dalla prima all’ultima sessione',
    { da: '2026-07-06', a: '2026-07-31' }, { da: d.periodoDa, a: d.periodoA });
  prova('la fotografia del destinatario porta il nome intero',
    'Prova Soldi', d.destinatarioDati.denominazione);
  prova('e quella dell’emittente porta l’IBAN, che è il motivo per cui il foglio esiste',
    'IT60X0542811101000000123456', d.emittenteDati.iban);
}

console.log('\n— LO STESSO CLIENTE, MA SOSTITUTO D’IMPOSTA —');
{
  // Stesse tre sessioni, ma il cliente è un professionista con partita IVA:
  // la ritenuta compare e quello che ti bonifica CAMBIA.
  const prof = { ...cliente, partita_iva: '98765432109', regime: 'ordinario',
    pec: 'studio@pec.it' };
  const d = pf.componiProforma({ righe: pf.righeDaSedute(sedute), cliente: prof,
    emittente, dataEmissione: '2026-08-03' });
  prova('categoria: sostituto d’imposta', 'sostituto_it', d.categoria);
  prova('a parità di sessioni ti bonifica MENO, perché trattiene la ritenuta',
    { imponibile: 400, iva: 88, ritenuta: 80, totaleDocumento: 488, daPagare: 408 },
    { imponibile: d.conti.imponibile, iva: d.conti.iva, ritenuta: d.conti.ritenuta,
      totaleDocumento: d.conti.totaleDocumento, daPagare: d.conti.daPagare });
}

console.log('\n— QUANDO NON SI PUÒ EMETTERE, E PERCHÉ (mai un blocco muto) —');
{
  const righe = pf.righeDaSedute(sedute);
  prova('con tutto a posto non c’è nessun motivo per fermarsi',
    [], pf.motiviCheImpediscono({ emittente, cliente, righe }));
  prova('senza IBAN si ferma, e dice dove si scrive',
    true, /IBAN.*Chi emette/.test(
      pf.motiviCheImpediscono({ emittente: { ...emittente, iban: '' }, cliente, righe })[0]));
  prova('col cliente senza codice fiscale si ferma, e dice cosa manca a LUI',
    true, /codice fiscale/.test(
      pf.motiviCheImpediscono({ emittente, cliente: { ...cliente, codice_fiscale: '' }, righe })[0]));
  prova('senza sessioni da chiedere lo dice, invece di fare un documento da zero euro',
    1, pf.motiviCheImpediscono({ emittente, cliente, righe: [] }).length);
  prova('due problemi insieme → due motivi, non uno solo',
    2, pf.motiviCheImpediscono({ emittente: { ...emittente, iban: '' },
      cliente: { ...cliente, codice_fiscale: '' }, righe }).length);
}

console.log('\n— IL NOME DEL FILE —');
prova('la barra del numero diventa un trattino: «/» è vietato nei nomi dei file',
  'Proforma 2026-001 - Prova Soldi.pdf',
  pf.nomeFile({ numero: '2026/001', destinatario_dati: { denominazione: 'Prova Soldi' } }));

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
