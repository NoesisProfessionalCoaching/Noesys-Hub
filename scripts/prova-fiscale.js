// PROVA DEL CERVELLO FISCALE — controlla server/fiscale.js.
//
// Nessun database, nessuna rete: gira in un secondo e si può lanciare quante volte
// si vuole. Serve a garantire che la categoria fiscale di un soggetto e l'elenco
// dei dati mancanti siano SEMPRE quelli giusti, anche fra sei mesi quando nessuno
// si ricorderà più perché una regola era scritta così.
//
//   node scripts/prova-fiscale.js
//
// Esce con codice 0 se è tutto a posto, 1 se una regola si è rotta.
// Da Fase 5 qui dentro arriveranno anche i 6 casi di calcolo del §11.1 della spec.

const f = require('../server/fiscale');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

// Un soggetto italiano con tutti i dati di contorno a posto: così ogni prova
// isola una regola sola invece di inciampare nei dati mancanti.
const base = {
  denominazione: 'Mario Rossi', paese: 'IT',
  via: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI',
};

console.log('— LA CATEGORIA FISCALE (spec §3.4) —');
prova('senza partita IVA → privato italiano',
  'privato_it', f.categoriaFiscale({ ...base }));
prova('partita IVA in regime ordinario → sostituto d’imposta',
  'sostituto_it', f.categoriaFiscale({ ...base, partita_iva: '12345678901', regime: 'ordinario' }));
prova('partita IVA in regime forfettario → forfettario',
  'forfettario_it', f.categoriaFiscale({ ...base, partita_iva: '12345678901', regime: 'forfettario' }));
prova('paese diverso da IT → estero extra UE',
  'estero_extra_ue', f.categoriaFiscale({ ...base, paese: 'CH' }));

console.log('\n— IL PUNTO CHE LA SPEC RIPETE DUE VOLTE (§3.4 nota, §11.1 caso 6) —');
prova('persona FISICA con partita IVA ordinaria → sostituto d’imposta, non privato',
  'sostituto_it', f.categoriaFiscale({
    ...base, natura_giuridica: 'persona_fisica', partita_iva: '12345678901', regime: 'ordinario' }));
prova('persona GIURIDICA in regime ordinario → stessa categoria: la forma non conta',
  'sostituto_it', f.categoriaFiscale({
    ...base, natura_giuridica: 'persona_giuridica', partita_iva: '12345678901', regime: 'ordinario' }));

console.log('\n— UNA SOCIETÀ NON È UN PRIVATO (segnalato da Germano su Flamingo Beauty) —');
prova('società senza partita IVA → nessuna categoria, NON «privato»',
  null, f.categoriaFiscale({ ...base, natura_giuridica: 'persona_giuridica' }));
prova('e le si chiede la partita IVA, non il codice fiscale',
  ['partita IVA', 'regime fiscale (ordinario o forfettario)'],
  f.datiMancanti({ ...base, natura_giuridica: 'persona_giuridica' }));
prova('una PERSONA senza partita IVA resta un privato: per lei è un’informazione, non un buco',
  'privato_it', f.categoriaFiscale({ ...base, natura_giuridica: 'persona_fisica' }));
prova('società con partita IVA e regime → torna tutto normale',
  'sostituto_it', f.categoriaFiscale({ ...base, natura_giuridica: 'persona_giuridica',
    partita_iva: '12345678901', regime: 'ordinario' }));
prova('il caso vero di Flamingo Beauty, com’era nel database',
  'Manca: indirizzo, CAP, città, provincia, partita IVA, regime fiscale (ordinario o forfettario)',
  f.statoFatturabilita(f.daCommittente({ denominazione: 'Flamingo Beauty', tipo: 'azienda',
    natura_giuridica: 'persona_giuridica', paese: 'IT' })).messaggio);

console.log('\n— QUANDO NON SI PUÒ DECIDERE —');
prova('partita IVA ma regime non indicato → nessuna categoria (mai "privato" per ripiego)',
  null, f.categoriaFiscale({ ...base, partita_iva: '12345678901' }));
prova('e allora fra i dati mancanti c’è il regime',
  true, f.datiMancanti({ ...base, partita_iva: '12345678901' })
          .includes('regime fiscale (ordinario o forfettario)'));
prova('paese non scritto → si intende Italia',
  'privato_it', f.categoriaFiscale({ ...base, paese: '' }));
prova('paese scritto minuscolo → funziona lo stesso',
  'estero_extra_ue', f.categoriaFiscale({ ...base, paese: 'ch' }));

console.log('\n— COSA MANCA PER FATTURARE (spec §3.6) —');
prova('privato completo di codice fiscale → non manca niente',
  [], f.datiMancanti({ ...base, codice_fiscale: 'RSSMRA80A01F205X' }));
prova('privato senza codice fiscale → manca il codice fiscale',
  ['codice fiscale'], f.datiMancanti({ ...base }));
prova('senza indirizzo, CAP, città e provincia → li elenca tutti e quattro',
  ['indirizzo', 'CAP', 'città', 'provincia', 'codice fiscale'],
  f.datiMancanti({ denominazione: 'Mario Rossi', paese: 'IT' }));
prova('senza nome → lo dice per primo',
  true, f.datiMancanti({ paese: 'IT' })[0] === 'nome e cognome');

prova('con partita IVA e codice destinatario di 7 caratteri → non manca niente',
  [], f.datiMancanti({ ...base, partita_iva: '12345678901', regime: 'ordinario', codice_sdi: 'ABC1234' }));
prova('con partita IVA e la sola PEC → va bene uguale',
  [], f.datiMancanti({ ...base, partita_iva: '12345678901', regime: 'ordinario', pec: 'ditta@pec.it' }));
prova('con partita IVA e né PEC né codice destinatario → manca il recapito elettronico',
  ['codice destinatario (7 caratteri) o PEC'],
  f.datiMancanti({ ...base, partita_iva: '12345678901', regime: 'forfettario' }));
prova('codice destinatario 0000000 non vale per chi ha la partita IVA',
  ['codice destinatario (7 caratteri) o PEC'],
  f.datiMancanti({ ...base, partita_iva: '12345678901', regime: 'ordinario', codice_sdi: '0000000' }));
prova('a chi ha la partita IVA il codice fiscale non viene chiesto',
  [], f.datiMancanti({ ...base, partita_iva: '12345678901', regime: 'ordinario', pec: 'ditta@pec.it' }));
prova('soggetto estero: CAP e provincia italiani non si chiedono',
  [], f.datiMancanti({ denominazione: 'Hans Meier', paese: 'CH', via: 'Bahnhofstrasse 1', citta: 'Lugano' }));

console.log('\n— IL VERDETTO CHE COMPARE NELLA SCHEDA —');
prova('privato completo → pronto',
  { stato: 'pronto', messaggio: 'Pronto per fatturare' },
  (r => ({ stato: r.stato, messaggio: r.messaggio }))(
    f.statoFatturabilita({ ...base, codice_fiscale: 'RSSMRA80A01F205X' })));
prova('privato senza codice fiscale e senza città → dice cosa manca, in ordine',
  { stato: 'incompleto', messaggio: 'Manca: città, codice fiscale' },
  (r => ({ stato: r.stato, messaggio: r.messaggio }))(
    f.statoFatturabilita({ ...base, citta: '' })));
prova('estero coi dati completi → NON è pronto: prima serve il commercialista',
  'da_verificare',
  f.statoFatturabilita({ denominazione: 'Hans Meier', paese: 'CH',
    via: 'Bahnhofstrasse 1', citta: 'Lugano' }).stato);
prova('l’etichetta della categoria è in italiano leggibile',
  'Sostituto d’imposta italiano',
  f.statoFatturabilita({ ...base, partita_iva: '12345678901', regime: 'ordinario',
    pec: 'a@pec.it' }).etichettaCategoria);

console.log('\n— I DUE TRADUTTORI (cliente e committente arrivano alla stessa forma) —');
prova('cliente: nome e cognome diventano la denominazione',
  'Mario Rossi', f.daCliente({ nome: 'Mario', cognome: 'Rossi' }).denominazione);
prova('cliente vecchio senza nome/cognome separati → si usa `name`',
  'Mario Rossi', f.daCliente({ name: 'Mario Rossi' }).denominazione);
prova('committente: l’indirizzo su una riga fa da via',
  'Via da Qui 69', f.daCommittente({ denominazione: 'X', indirizzo: 'Via da Qui 69' }).via);
prova('un cliente e un committente coi soliti dati danno la STESSA categoria',
  true,
  f.categoriaFiscale(f.daCliente({ nome: 'A', cognome: 'B', paese: 'IT',
    partita_iva: '1', regime: 'ordinario' })) ===
  f.categoriaFiscale(f.daCommittente({ denominazione: 'A B', paese: 'IT',
    partita_iva: '1', regime: 'ordinario' })));

console.log('\n— LE QUOTE DI UN PROGETTO TORNANO? —');
prova('10.000 = 7.000 committente + 3.000 coachee → quadra (è il caso Flamingo)',
  { quadra: true, scarto: 0 },
  f.quoteProgetto({ quota_totale: 10000, quota_committente: 7000, somma_coachee: 3000 }));
prova('se al totale manca qualcosa lo dice, e dice quanto',
  { quadra: false, scarto: 500 },
  f.quoteProgetto({ quota_totale: 10000, quota_committente: 7000, somma_coachee: 2500 }));
prova('se le quote SUPERANO il totale, lo scarto è negativo',
  { quadra: false, scarto: -250 },
  f.quoteProgetto({ quota_totale: 1000, quota_committente: 800, somma_coachee: 450 }));
prova('i centesimi non fanno scattare falsi allarmi (33,33 × 3 = 99,99)',
  { quadra: true, scarto: 0 },
  f.quoteProgetto({ quota_totale: 99.99, quota_committente: 33.33, somma_coachee: 66.66 }));
prova('un progetto senza totale non è un’anomalia di quote',
  { quadra: true, scarto: 0 },
  f.quoteProgetto({ quota_totale: null, quota_committente: null, somma_coachee: 0 }));

console.log('\n— L’ELENCO DELLE ANOMALIE —');
prova('tutto a posto → elenco vuoto',
  [], f.anomalie({
    clienti: [{ id: 'c1', nome: 'Mario', cognome: 'Rossi', ...base, codice_fiscale: 'X' }],
    committenti: [], progetti: [] }));
prova('un cliente a cui manca il codice fiscale finisce nell’elenco, col suo nome',
  [{ tipo: 'dati_cliente', ruolo: 'cliente', id: 'c1', collaudo: false, nome: 'Mario Rossi',
     messaggio: 'Manca: codice fiscale' }],
  f.anomalie({ clienti: [{ id: 'c1', nome: 'Mario', cognome: 'Rossi', ...base }] }));
prova('un committente incompleto finisce nell’elenco come committente, non come cliente',
  ['dati_committente', 'committente'],
  (r => [r[0].tipo, r[0].ruolo])(f.anomalie({
    committenti: [{ id: 'k1', denominazione: 'Prova Srl', paese: 'IT' }] })));
prova('progetto che quadra e con partecipanti → nessuna anomalia',
  [], f.anomalie({ progetti: [{ id: 'p1', titolo: 'Flamingo', quota_totale: 10000,
    quota_committente: 7000, somma_coachee: 3000, n_partecipanti: 2 }] }));
prova('progetto che non quadra → lo dice con le cifre in chiaro, col punto delle migliaia',
  // 🔴 CAMBIATA IL 17/08. Prima qui c'era scritto «9500,00» perché in italiano il
  // separatore delle migliaia parte da cinque cifre — regola della lingua, non
  // una dimenticanza. Germano ha deciso il contrario: «il punto deve esserci
  // anche per le migliaia, su tutti i numeri sopra 1.000». Adesso lo mette
  // `fiscale.euro()`, e passano tutti di lì.
  'Totale € 10.000,00, ma committente + coachee fanno € 9.500,00 (mancano € 500,00)',
  f.anomalie({ progetti: [{ id: 'p1', titolo: 'Flamingo', quota_totale: 10000,
    quota_committente: 7000, somma_coachee: 2500, n_partecipanti: 2 }] })[0].messaggio);
// ── COME SI SCRIVONO I NUMERI (17/08) ──────────────────────────────────────
prova('⭐ il punto delle migliaia c’è anche sotto le cinque cifre',
  ['€ 1.500,00', '€ 2.142,00', '€ 10.000,00'],
  [1500, 2142, 10000].map(n => '€ ' + f.euro(n)));
prova('sotto i mille non si inventa niente', '999,00', f.euro(999));
prova('gli importi INTERI non prendono i centesimi ma prendono il punto',
  ['2.500', '600', '10.000'], [2500, 600, 10000].map(f.euroIntero));
prova('un importo intero si arrotonda, non si tronca', '1.001', f.euroIntero(1000.6));
prova('niente e zero si scrivono come zero',
  ['0,00', '0'], [f.euro(null), f.euroIntero(undefined)]);

prova('progetto con una quota ma senza partecipanti → segnalato',
  'senza_partecipanti',
  f.anomalie({ progetti: [{ id: 'p1', titolo: 'X', quota_totale: 1000,
    quota_committente: 1000, somma_coachee: 0, n_partecipanti: 0 }] })[0].tipo);
prova('un progetto può avere DUE anomalie insieme e le riporta entrambe',
  ['quote_non_tornano', 'senza_partecipanti'],
  f.anomalie({ progetti: [{ id: 'p1', titolo: 'X', quota_totale: 1000,
    quota_committente: 500, somma_coachee: 0, n_partecipanti: 0 }] }).map(a => a.tipo));
prova('il cliente estero completo compare comunque: non è pronto finché non parla il commercialista',
  'dati_cliente',
  f.anomalie({ clienti: [{ id: 'c1', nome: 'Hans', cognome: 'Meier', paese: 'CH',
    via: 'Bahnhofstrasse 1', citta: 'Lugano' }] })[0].tipo);

console.log('\n— LE ANOMALIE RACCOLTE PER PERSONA —');
{
  // Un progetto con DUE problemi: è il caso che ha fatto cambiare idea a Germano.
  // Deve venire fuori UN riquadro solo, con dentro tutte e due le cose.
  const perSoggetto = f.anomaliePerSoggetto(f.anomalie({
    clienti: [{ id: 'c1', nome: 'Anna', cognome: 'Verdi', paese: 'IT' }],
    progetti: [{ id: 'p1', titolo: 'Doppio guaio', quota_totale: 1000,
      quota_committente: 500, somma_coachee: 0, n_partecipanti: 0 }],
  }));
  prova('due soggetti → due riquadri, non quattro',
    2, perSoggetto.length);
  prova('il progetto coi due problemi sta in un riquadro solo',
    2, perSoggetto[1].voci.length);
  prova('e dentro ci sono tutti e due, col loro titolo in italiano',
    ['Le quote del progetto non tornano', 'Progetto con una quota ma nessun partecipante'],
    perSoggetto[1].voci.map(v => v.titolo));
  prova('ogni riquadro sa chi è e come si chiama',
    [{ ruolo: 'cliente', nome: 'Anna Verdi' }, { ruolo: 'progetto', nome: 'Doppio guaio' }],
    perSoggetto.map(g => ({ ruolo: g.ruolo, nome: g.nome })));
  prova('un cliente e un progetto con lo stesso id restano due riquadri distinti',
    2, f.anomaliePerSoggetto([
      { ruolo: 'cliente',  id: 'x', nome: 'Tizio',  tipo: 'dati_cliente', messaggio: 'a' },
      { ruolo: 'progetto', id: 'x', nome: 'Cosino', tipo: 'quote_non_tornano', messaggio: 'b' },
    ]).length);
  prova('nessuna anomalia → nessun riquadro', [], f.anomaliePerSoggetto([]));
}

// ═══════════════════════════════════════════════════════════════════════════
// I CONTI — i 6 casi del §11.1 della spec, coi numeri esatti.
//
// Questi sei non sono prove come le altre: sono i numeri che il commercialista
// si aspetta di rivedere nel gestionale. Se uno solo si muove, il documento ha
// smesso di essere un controllo ed è diventato una fonte di errori.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n— I CONTI: I 6 CASI OBBLIGATORI DELLA SPEC (§11.1) —');
{
  // [titolo, categoria, imponibile, iva, ritenuta, bollo, totale, da pagare]
  const CASI = [
    ['1 · sostituto d’imposta',            'sostituto_it',    1000,  220, 200, 0,    1220, 1020],
    ['2 · privato italiano',               'privato_it',      1000,  220,   0, 0,    1220, 1220],
    ['3 · forfettario italiano',           'forfettario_it',  1000,  220,   0, 0,    1220, 1220],
    ['4 · estero, sopra la soglia bollo',  'estero_extra_ue', 1000,    0,   0, 2,    1002, 1002],
    ['5 · estero, sotto la soglia bollo',  'estero_extra_ue',   50,    0,   0, 0,      50,   50],
    // Il caso 6 è il caso 1 guardato da un'altra parte: verifica che a decidere
    // sia il REGIME e non la forma giuridica. Una persona fisica con partita IVA
    // ordinaria è sostituto d'imposta e la ritenuta ci va.
    ['6 · persona fisica con P.IVA ordinaria', 'sostituto_it', 1000, 220, 200, 0,    1220, 1020],
  ];
  for (const [titolo, categoria, imp, iva, rit, bollo, tot, pag] of CASI) {
    prova(titolo,
      { iva, ritenuta: rit, bollo, totaleDocumento: tot, daPagare: pag },
      (d => ({ iva: d.iva, ritenuta: d.ritenuta, bollo: d.bollo,
               totaleDocumento: d.totaleDocumento, daPagare: d.daPagare }))(
        f.calcolaDocumento({ categoria, imponibile: imp })));
  }
  // La categoria del caso 6 arriva davvero dai dati, non è scritta a mano qui.
  prova('e il caso 6 nasce davvero da una persona fisica con partita IVA',
    'sostituto_it', f.categoriaFiscale({ ...base, natura_giuridica: 'persona_fisica',
      partita_iva: '12345678901', regime: 'ordinario' }));
}

console.log('\n— I CASI LIMITE (§11.3) —');
prova('bollo a 77,47 esatti: NON si mette, la soglia è «superiore a»',
  0, f.calcolaDocumento({ categoria: 'estero_extra_ue', imponibile: 77.47 }).bollo);
prova('bollo a 77,48: si mette',
  2, f.calcolaDocumento({ categoria: 'estero_extra_ue', imponibile: 77.48 }).bollo);
prova('categoria non decidibile → nessun conto, non un conto sbagliato',
  null, f.calcolaDocumento({ categoria: null, imponibile: 1000 }));
prova('il mezzo centesimo si arrotonda per eccesso, non per difetto',
  1.01, f.arrotonda(1.005));
prova('il caso vero di Prova Soldi: luglio 2026, 400 € imponibile',
  { iva: 88, daPagare: 488 },
  (d => ({ iva: d.iva, daPagare: d.daPagare }))(
    f.calcolaDocumento({ categoria: 'privato_it', imponibile: 400 })));

console.log('\n— TUTTI I PASSAGGI DEVONO ESSERE VISIBILI (richiesta di Germano) —');
{
  const sost = f.passaggiDocumento(f.calcolaDocumento({ categoria: 'sostituto_it', imponibile: 1000 }));
  prova('al sostituto d’imposta si mostrano tutti e cinque i passaggi',
    ['Imponibile', 'IVA 22%', 'Totale del documento', 'Ritenuta d’acconto 20%', 'Importo da bonificare'],
    sost.map(p => p.etichetta));
  prova('e l’ultimo passaggio è quanto ti bonifica davvero',
    1020, sost[sost.length - 1].importo);
  const priv = f.passaggiDocumento(f.calcolaDocumento({ categoria: 'privato_it', imponibile: 1000 }));
  prova('al privato non si mostra una ritenuta che non c’è',
    ['Imponibile', 'IVA 22%', 'Totale del documento', 'Importo da bonificare'],
    priv.map(p => p.etichetta));
  const est = f.passaggiDocumento(f.calcolaDocumento({ categoria: 'estero_extra_ue', imponibile: 1000 }));
  prova('all’estero l’IVA a zero si mostra lo stesso, con scritto perché',
    'Operazione non soggetta, art. 7-ter DPR 633/72', est[1].nota);
}

console.log('\n— CHI EMETTE: cosa ferma una proforma e cosa no —');
{
  const completo = {
    denominazione: 'Germano Guerriero', via: 'Via Roma 1', cap: '20100',
    citta: 'Milano', provincia: 'MI', paese: 'IT',
    partita_iva: '12345678901', regime: 'ordinario', iban: 'IT60X0542811101000000123456',
    codice_fiscale: 'GRRGMN80A01F205X', intestatario: 'Germano Guerriero',
    banca: 'Banca X', ateco: '70.20.09', email: 'a@b.it',
  };
  prova('con tutto compilato si può emettere', true, f.datiMancantiEmittente(completo).pronto);
  prova('senza IBAN non si emette: il documento non direbbe dove pagare',
    ['IBAN'], f.datiMancantiEmittente({ ...completo, iban: '' }).mancanti);
  prova('senza partita IVA non si emette',
    ['partita IVA'], f.datiMancantiEmittente({ ...completo, partita_iva: '' }).mancanti);
  prova('nome e cognome bastano al posto della denominazione',
    true, f.datiMancantiEmittente({ ...completo, denominazione: '', nome: 'Germano', cognome: 'Guerriero' }).pronto);
  prova('il regime forfettario ferma tutto e spiega perché',
    true, /forfettario/.test(f.datiMancantiEmittente({ ...completo, regime: 'forfettario' }).mancanti.join(' ')));
  prova('un numero di telefono mancante NON ferma niente',
    true, f.datiMancantiEmittente({ ...completo, telefono: '' }).pronto);
  prova('ma il codice fiscale mancante viene comunque detto',
    true, f.datiMancantiEmittente({ ...completo, codice_fiscale: '' }).consigliati.includes('codice fiscale'));
  prova('una tabella «chi emette» ancora vuota non è pronta',
    false, f.datiMancantiEmittente({}).pronto);
}

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
