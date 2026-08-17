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
const fisc = require('../server/fiscale');
// ⭐ C3 (17/08): al modulo si passa il SOGGETTO già normalizzato, non il record
// grezzo. Qui si traduce come fa la pagina, così le prove usano la stessa porta.
const sog = c => fisc.daCliente(c);

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
  const d = pf.componiProforma({ righe, soggetto: sog(cliente), email: cliente.email, emittente, dataEmissione: '2026-08-03' });
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
  const d = pf.componiProforma({ righe: pf.righeDaSedute(sedute), soggetto: sog(prof),
    email: prof.email, emittente, dataEmissione: '2026-08-03' });
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
    [], pf.motiviCheImpediscono({ emittente, soggetto: sog(cliente), righe }));
  prova('senza IBAN si ferma, e dice dove si scrive',
    true, /IBAN.*Chi emette/.test(
      pf.motiviCheImpediscono({ emittente: { ...emittente, iban: '' }, soggetto: sog(cliente), righe })[0]));
  prova('col cliente senza codice fiscale si ferma, e dice cosa manca a LUI',
    true, /codice fiscale/.test(
      pf.motiviCheImpediscono({ emittente, soggetto: sog({ ...cliente, codice_fiscale: '' }), righe })[0]));
  prova('senza sessioni da chiedere lo dice, invece di fare un documento da zero euro',
    1, pf.motiviCheImpediscono({ emittente, soggetto: sog(cliente), righe: [] }).length);
  prova('due problemi insieme → due motivi, non uno solo',
    2, pf.motiviCheImpediscono({ emittente: { ...emittente, iban: '' },
      soggetto: sog({ ...cliente, codice_fiscale: '' }), righe }).length);
}

// ── FETTA C3: CHIEDERE UNA RATA, ANCHE A UN COMMITTENTE ────────────────────
// Una rata non è una sessione: non ha una data di svolgimento, non si
// moltiplica, e chi la riceve deve riconoscerla nel piano che ha firmato.
console.log('\n— LE RIGHE DI UNA RATA —');
{
  const rate = [{ id: 't1', etichetta: 'Acconto', importo: 2100 }];
  const r = pf.righeDaTranche(rate, { titolo: 'Progetto Flamingo Revolution', quota: 7000 });
  prova('una rata, una riga', 1, r.length);
  prova('⭐ la descrizione dice QUALE rata, di CHE COSA e con che percentuale',
    'Acconto (30%) — Progetto Flamingo Revolution', r[0].descrizione);
  prova('la percentuale si RICALCOLA da importo/quota, non si salva mai',
    '(30%)', (r[0].descrizione.match(/\(\d+%\)/) || [''])[0]);
  prova('la riga si ricorda da quale rata viene: è ciò che impedisce di chiederla due volte',
    't1', r[0].tranche_id);
  prova('quantità 1 e nessuna data: una rata non si svolge in un giorno',
    { quantita: 1, data: null }, { quantita: r[0].quantita, data: r[0].data });
  prova('senza la quota non si inventa una percentuale',
    'Saldo — Progetto X',
    pf.righeDaTranche([{ id: 't2', etichetta: 'Saldo', importo: 100 }],
      { titolo: 'Progetto X' })[0].descrizione);
}

console.log('\n— LA STESSA PROFORMA, MA A UN COMMITTENTE —');
{
  const committente = {
    denominazione: 'Flamingo Beauty S.r.l.', paese: 'IT',
    natura_giuridica: 'persona_giuridica', partita_iva: '11122233344',
    regime: 'ordinario', indirizzo: 'Via dei Fiori 3', cap: '20100',
    citta: 'Milano', provincia: 'MI', pec: 'flamingo@pec.it',
  };
  const s = fisc.daCommittente(committente);
  const righe = pf.righeDaTranche([{ id: 't1', etichetta: 'Acconto', importo: 2100 }],
    { titolo: 'Progetto Flamingo Revolution', quota: 7000 });
  const d = pf.componiProforma({ righe, soggetto: s, email: 'amministrazione@flamingo.it',
    emittente, dataEmissione: '2026-08-17',
    periodo: { da: '2026-09-01', a: '2026-12-15' } });
  prova('un’azienda con partita IVA è sostituto d’imposta', 'sostituto_it', d.categoria);
  prova('su 2.100: IVA 462, ritenuta 420, ti bonifica 2.142',
    { imponibile: 2100, iva: 462, ritenuta: 420, totaleDocumento: 2562, daPagare: 2142 },
    { imponibile: d.conti.imponibile, iva: d.conti.iva, ritenuta: d.conti.ritenuta,
      totaleDocumento: d.conti.totaleDocumento, daPagare: d.conti.daPagare });
  prova('il destinatario è l’azienda, con la sua denominazione',
    'Flamingo Beauty S.r.l.', d.destinatarioDati.denominazione);
  prova('l’indirizzo del committente sta in `indirizzo` e arriva lo stesso in `via`',
    'Via dei Fiori 3', d.destinatarioDati.via);
  prova('⭐ il periodo di una rata arriva da fuori: è quello del progetto',
    { da: '2026-09-01', a: '2026-12-15' }, { da: d.periodoDa, a: d.periodoA });
  prova('l’email non è un dato fiscale: si passa a parte e finisce nella fotografia',
    'amministrazione@flamingo.it', d.destinatarioDati.email);
}

console.log('\n— IL BLOCCO PARLA DI CHI RICEVE, NON SEMPRE DEL «CLIENTE» —');
{
  const vuoto = fisc.daCommittente({ denominazione: 'Flamingo Beauty S.r.l.',
    paese: 'IT', natura_giuridica: 'persona_giuridica' });
  const m = pf.motiviCheImpediscono({ emittente, soggetto: vuoto, righe: [{ importo: 1 }] });
  prova('un committente senza partita IVA ferma il documento', 1, m.length);
  prova('e il messaggio manda nella scheda del COMMITTENTE, non in quella del cliente',
    true, /committente.*scheda del committente/s.test(m[0]));
  prova('quando non c’è niente da chiedere, il motivo si può dire con parole giuste',
    'Questa rata è già stata chiesta.',
    pf.motiviCheImpediscono({ emittente, soggetto: fisc.daCliente(cliente), righe: [],
      nienteDaChiedere: 'Questa rata è già stata chiesta.' })[0]);
}

console.log('\n— LA MAIL A UN’AZIENDA NON DÀ DEL TU —');
{
  const base = {
    numero: '2026/002', da_pagare: 2142, anno: 2026, committente_id: 'k1',
    destinatario_dati: { denominazione: 'Flamingo Beauty S.r.l.', email: 'amm@flamingo.it' },
    periodo_da: '2026-09-01', periodo_a: '2026-12-15',
  };
  const righe = [{ tranche_id: 't1', descrizione: 'Acconto (30%) — Progetto Flamingo Revolution' }];
  const m = pf.testoMail(base, righe);
  prova('🔴 non si scrive «Ciao Flamingo» a una società', false, /Ciao/.test(m.body));
  prova('si apre con un saluto neutro', true, m.body.startsWith('Buongiorno,'));
  prova('e si dà del VOI fino in fondo',
    true, /sarà emessa la fattura/.test(m.body) && /Vi ringrazio e vi saluto/.test(m.body));
  prova('⭐ non parla di «sessioni»: nomina la RATA, come la riga del documento',
    true, m.body.includes('per acconto (30%) — Progetto Flamingo Revolution.')
       && !m.body.includes('sessioni di coaching'));
  // 🔴 Dal 17/08 il punto delle migliaia c'è anche sotto le 5 cifre: decisione di
  // Germano contro il default italiano. Ieri questa prova diceva «2142,00».
  prova('l’importo è quello da bonificare, ritenuta già tolta', true, m.body.includes('€ 2.142,00'));
  prova('la norma resta, perché è la ragione per cui il documento esiste',
    true, m.body.includes('art. 6, comma 3, del DPR 633/1972'));
}

console.log('\n— LA RATA DI UN PACCHETTO VA A UNA PERSONA: TU, MA NON «sessioni» —');
{
  const base = {
    numero: '2026/004', da_pagare: 439.2, anno: 2026,
    destinatario_dati: { denominazione: 'Marco Bianchi', email: 'marco@esempio.it' },
  };
  const m = pf.testoMail(base, [{ tranche_id: 't9', descrizione: 'Acconto (30%) — Pacchetto di coaching' }]);
  prova('a una persona il registro confidenziale resta', true, m.body.startsWith('Ciao Marco,'));
  prova('ma l’oggetto è la rata, non le sessioni',
    true, m.body.includes('per acconto (30%) — Pacchetto di coaching.'));
}

// ── IL PROMEMORIA: DAL PRIMO LUNEDÌ ────────────────────────────────────────
// Germano ha scelto «sempre il primo lunedì» conoscendo il rischio (3 volte su
// 12 cade a ridosso della fine del mese prima). Il calcolo va provato: sbagliato
// di un giorno, il promemoria arriva quando non deve — o non arriva affatto, e
// di un promemoria che non arriva non se ne accorge nessuno.
// ── IL TESTO DELLA MAIL ────────────────────────────────────────────────────
// È il testo che arriva a un cliente vero: il numero, la cifra e il periodo
// devono essere quelli del documento, non un'approssimazione.
console.log('\n— IL TESTO DELLA MAIL —');
{
  const base = {
    numero: '2026/001', da_pagare: 488, anno: 2026,
    destinatario_dati: { denominazione: 'Marco Bianchi', email: 'marco@esempio.it' },
    periodo_da: '2026-07-16', periodo_a: '2026-07-30',
  };
  const m = pf.testoMail(base);
  prova('l’oggetto porta il numero', 'Proforma n. 2026/001 — Noesys Professional Coaching', m.subject);
  prova('saluta per nome, come Mail 1 e Mail 2', true, m.body.startsWith('Ciao Marco,'));
  prova('sessioni tutte a luglio → «di luglio 2026», non un intervallo',
    true, m.body.includes('sessioni di coaching di luglio 2026.'));
  prova('la cifra è quella da bonificare, con i centesimi', true, m.body.includes('€ 488,00'));
  prova('c’è la spiegazione voluta da Germano, con la norma',
    true, m.body.includes('art. 6, comma 3, del DPR 633/1972'));
  prova('il saluto è quello scelto il 12/08',
    true, m.body.includes('Ti ringrazio e ti saluto cordialmente,'));

  const due = pf.testoMail({ ...base, periodo_da: '2026-06-28', periodo_a: '2026-07-30' });
  prova('sessioni a cavallo di due mesi → il periodo per esteso, non un mese solo',
    true, due.body.includes('coaching dal 28/06/2026 al 30/07/2026.'));
}

console.log('\n— IL PRIMO LUNEDÌ —');
{
  const mat = require('../server/maturato');
  prova('agosto 2026 comincia di sabato → primo lunedì il 3', 3, mat.giornoPrimoLunedi(2026, 8));
  prova('novembre 2026 comincia di domenica → primo lunedì il 2 (il caso stretto)',
    2, mat.giornoPrimoLunedi(2026, 11));
  prova('febbraio 2027 comincia già di lunedì → primo lunedì il 1',
    1, mat.giornoPrimoLunedi(2027, 2));
  prova('un mese che comincia di martedì → primo lunedì il 7', 7, mat.giornoPrimoLunedi(2026, 9));

  prova('il 2 agosto 2026 (domenica) il promemoria NON c’è ancora',
    { attivo: false, meseLimite: '2026-07' }, mat.finestraPromemoria('2026-08-02'));
  prova('il 3 agosto 2026 (primo lunedì) il promemoria c’è, e riguarda luglio',
    { attivo: true, meseLimite: '2026-07' }, mat.finestraPromemoria('2026-08-03'));
  prova('a metà mese c’è ancora: non è un solo giorno, è da lì in poi',
    { attivo: true, meseLimite: '2026-07' }, mat.finestraPromemoria('2026-08-20'));
  prova('a gennaio il mese da chiedere è dicembre dell’anno prima',
    { attivo: true, meseLimite: '2025-12' }, mat.finestraPromemoria('2026-01-15'));
}

console.log('\n— IL NOME DEL FILE —');
prova('la barra del numero diventa un trattino: «/» è vietato nei nomi dei file',
  'Proforma 2026-001 - Prova Soldi.pdf',
  pf.nomeFile({ numero: '2026/001', destinatario_dati: { denominazione: 'Prova Soldi' } }));

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
