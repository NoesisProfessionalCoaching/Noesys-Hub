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

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
