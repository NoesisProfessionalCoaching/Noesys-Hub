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
  [{ tipo: 'dati_cliente', ruolo: 'cliente', id: 'c1', nome: 'Mario Rossi',
     messaggio: 'Manca: codice fiscale' }],
  f.anomalie({ clienti: [{ id: 'c1', nome: 'Mario', cognome: 'Rossi', ...base }] }));
prova('un committente incompleto finisce nell’elenco come committente, non come cliente',
  ['dati_committente', 'committente'],
  (r => [r[0].tipo, r[0].ruolo])(f.anomalie({
    committenti: [{ id: 'k1', denominazione: 'Prova Srl', paese: 'IT' }] })));
prova('progetto che quadra e con partecipanti → nessuna anomalia',
  [], f.anomalie({ progetti: [{ id: 'p1', titolo: 'Flamingo', quota_totale: 10000,
    quota_committente: 7000, somma_coachee: 3000, n_partecipanti: 2 }] }));
prova('progetto che non quadra → lo dice con le cifre in chiaro, scritte all’italiana',
  // Nota: in italiano il separatore delle migliaia parte da cinque cifre, quindi
  // «10.000,00» ma «9500,00». È la regola della lingua, non una dimenticanza, ed è
  // la stessa che usa già il resto dell'Hub.
  'Totale € 10.000,00, ma committente + coachee fanno € 9500,00 (mancano € 500,00)',
  f.anomalie({ progetti: [{ id: 'p1', titolo: 'Flamingo', quota_totale: 10000,
    quota_committente: 7000, somma_coachee: 2500, n_partecipanti: 2 }] })[0].messaggio);
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

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
