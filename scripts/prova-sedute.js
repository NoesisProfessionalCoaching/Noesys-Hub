// PROVA DELLE SEDUTE — server/sedute.js (fetta 0.3 del riordino, 03/09/2026).
//
// La regola «una sessione con data nel futuro è FISSATA, non fatta» viveva in una
// sola rotta (creazione individuale) e non veniva mai ricalcolata: una sessione
// di team fissata per il mese prossimo contava già ore e sessioni ICF, e una
// sessione spostata di data teneva lo stato di prima. Qui la regola sta in un
// posto solo e si prova con dei numeri, senza database.
//
//   node scripts/prova-sedute.js

const s = require('../server/sedute');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

const OGGI = '2026-09-03';

console.log('— LO STATO VIENE DALLA DATA —');
prova('una sessione di domani è fissata: bozza', 'bozza', s.statoDallaData('2026-09-04', OGGI));
prova('una sessione di ieri è fatta: confermata', 'confermata', s.statoDallaData('2026-09-02', OGGI));
prova('una sessione di oggi è fatta', 'confermata', s.statoDallaData('2026-09-03', OGGI));
prova('senza data è fatta: non si può dire che sia nel futuro', 'confermata', s.statoDallaData(null, OGGI));
prova('una data con l’ora attaccata si legge lo stesso', 'bozza', s.statoDallaData('2026-12-01T00:00:00.000Z', OGGI));
prova('anche se arriva come oggetto Date', 'bozza', s.statoDallaData(new Date('2026-12-01T12:00:00Z'), OGGI));
prova('la data di riferimento è quella di Roma, non di Greenwich', true,
  /^\d{4}-\d{2}-\d{2}$/.test(s.oggiRoma()) && s.oggiRoma() === new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date()));

console.log('\n— QUANDO SI SPOSTA LA DATA —');
// Una riga scritta a mano segue la data. Una riga che ha un report dietro
// (source_file_id) sta in bozza perché ASPETTA L’APPROVAZIONE del coach, o è già
// stata approvata: la data non deve cambiarle lo stato in nessuno dei due casi.
prova('riga a mano spostata nel futuro → bozza', 'bozza',
  s.statoDopoModifica({ data: '2026-10-01', oggi: OGGI, sourceFileId: null, statoAttuale: 'confermata' }));
prova('riga a mano riportata nel passato → confermata', 'confermata',
  s.statoDopoModifica({ data: '2026-09-01', oggi: OGGI, sourceFileId: null, statoAttuale: 'bozza' }));
prova('⛔ riga con report dietro, in bozza, corretta di data → resta bozza (la approva il coach)', 'bozza',
  s.statoDopoModifica({ data: '2026-09-01', oggi: OGGI, sourceFileId: 'drive-abc', statoAttuale: 'bozza' }));
prova('riga con report dietro, già approvata, spostata nel futuro → resta confermata', 'confermata',
  s.statoDopoModifica({ data: '2026-12-01', oggi: OGGI, sourceFileId: 'drive-abc', statoAttuale: 'confermata' }));
prova('senza stato attuale e senza report si ripiega sulla data', 'confermata',
  s.statoDopoModifica({ data: '2026-09-01', oggi: OGGI }));

console.log(`\n${falliti ? '✗' : '✓'} ${falliti} prove fallite.`);
process.exit(falliti ? 1 : 0);
