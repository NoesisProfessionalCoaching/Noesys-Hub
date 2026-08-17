// PROVA DELL'INCASSO — server/incassi.js (fetta C4, 18/08/2026).
//
// Nessun database, nessuna rete: entrano dei numeri, esce se un documento è
// saldato. La parte che conta sono i CENTESIMI — un documento pagato al
// centesimo esatto deve risultare saldato, e coi decimali in virgola mobile non
// succederebbe sempre.
//
//   node scripts/prova-incassi.js

const inc = require('../server/incassi');
const tr = require('../server/tranche');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

console.log('— A CHE PUNTO È IL PAGAMENTO —');
{
  prova('nessun incasso: aperta', 'aperta', inc.statoPagamento({ da_pagare: 2550, incassato: 0 }));
  prova('un acconto: parziale', 'parziale', inc.statoPagamento({ da_pagare: 2550, incassato: 1000 }));
  prova('tutto: saldata', 'saldata', inc.statoPagamento({ da_pagare: 2550, incassato: 2550 }));
  prova('più del dovuto: saldata lo stesso', 'saldata', inc.statoPagamento({ da_pagare: 2550, incassato: 2600 }));
  // Un documento senza importo non è «pagato»: è un documento che non dice
  // quanto chiedere. Farlo sparire fra le cose fatte lo nasconderebbe.
  prova('da pagare zero: resta aperta, non saldata', 'aperta', inc.statoPagamento({ da_pagare: 0, incassato: 0 }));
}

console.log('\n— I CENTESIMI (la parte che può mentire) —');
{
  // 0,1 + 0,2 non fa 0,3 in virgola mobile: sommando in euro un documento
  // saldato al centesimo resterebbe «manca 0,00» per sempre.
  const righe = [{ importo: 0.1 }, { importo: 0.2 }];
  prova('0,10 + 0,20 fa esattamente 0,30', 0.3, inc.sommaIncassi(righe));
  prova('e con quella somma il documento è saldato', 'saldata',
    inc.statoPagamento({ da_pagare: 0.3, incassato: inc.sommaIncassi(righe) }));

  // Gli importi arrivano da PostgreSQL come STRINGHE: '2550.00', non 2550.
  prova('le stringhe del database si sommano, non si incollano', 2550,
    inc.sommaIncassi([{ importo: '2100.00' }, { importo: '450.00' }]));
  prova('e il documento risulta saldato', true,
    inc.saldata({ da_pagare: '2550.00', incassato: '2550.00' }));

  prova('il residuo di un acconto', 1550, inc.residuo({ da_pagare: 2550, incassato: 1000 }));
  prova('il residuo non va mai sotto zero', 0, inc.residuo({ da_pagare: 2550, incassato: 3000 }));
}

console.log('\n— COSA NON SI PUÒ REGISTRARE —');
{
  prova('un incasso a zero', 1, inc.problemi({ importo: 0, data: '2026-08-20', residuo: 2550 }).length);
  prova('un incasso senza data', 1, inc.problemi({ importo: 100, data: '', residuo: 2550 }).length);
  // 25.000 invece di 2.500: senza questo controllo entrerebbe in silenzio, e si
  // fatturerebbe una cifra che non è mai arrivata.
  prova('più di quanto manca', 1, inc.problemi({ importo: 25000, data: '2026-08-20', residuo: 2550 }).length);
  prova('su un documento già saldato', 1, inc.problemi({ importo: 10, data: '2026-08-20', residuo: 0 }).length);
  prova('un incasso giusto non ha problemi', 0, inc.problemi({ importo: 2550, data: '2026-08-20', residuo: 2550 }).length);
  prova('un acconto non ha problemi', 0, inc.problemi({ importo: 1000, data: '2026-08-20', residuo: 2550 }).length);
}

console.log('\n— LA FATTURA CHE NE NASCE —');
{
  const saldata = { stato: 'inviata', da_pagare: 2550, incassato: 2550 };
  prova('saldata e senza numero: la fattura è da fare', true, inc.daFatturare(saldata));
  prova('col numero scritto: non chiede più niente', false,
    inc.daFatturare({ ...saldata, fattura_numero: '12/2026' }));
  prova('uno spazio non è un numero di fattura', true,
    inc.daFatturare({ ...saldata, fattura_numero: '   ' }));
  prova('non ancora saldata: non si fattura', false,
    inc.daFatturare({ stato: 'inviata', da_pagare: 2550, incassato: 1000 }));
  prova('annullata: non chiede niente a nessuno', false,
    inc.daFatturare({ stato: 'annullata', da_pagare: 2550, incassato: 2550 }));

  // È l'incasso a far nascere la fattura (decisione 2 dell'11/08): con un
  // acconto a luglio e il saldo ad agosto, la fattura è di AGOSTO.
  prova('il conto lo chiude l’ultimo incasso', '2026-08-20',
    inc.dataChiudeIlConto([{ data_incasso: '2026-07-30' }, { data_incasso: '2026-08-20' }]));
  prova('senza incassi non c’è nessuna data', null, inc.dataChiudeIlConto([]));
}

console.log('\n— LA SCADENZA DEL DOCUMENTO (il difetto trovato da Germano il 18/08) —');
{
  // Il caso vero: la 2026/002 di Flamingo. Rata «Acconto» alla firma + 30 giorni,
  // progetto cominciato il 23/07 → scade il 22/08. La proforma è nata prima di
  // C4a, quindi la casella congelata è vuota: ripiegando sul giorno dell'invio
  // (17/08) sembrava a rimessa diretta, e Germano se n'è accorto.
  const flamingo = { scadenza: null, data_emissione: '2026-08-17' };
  const acconto = { innesco: 'firma', giorni: 30 };
  const progetto = { data_inizio: '2026-07-23', data_meta: '2026-09-01', data_fine: '2026-09-28' };
  prova('una rata a 30 giorni scade 30 giorni dopo la firma, non il giorno dell’invio',
    '2026-08-22', inc.scadenzaDocumento(flamingo, acconto, progetto));

  // Quella congelata dentro il documento vince sempre: al cliente hai detto
  // quella, e cambiare le date del progetto non riscrive un documento spedito.
  prova('la scadenza congelata vince su tutto', '2026-07-31',
    inc.scadenzaDocumento({ scadenza: '2026-07-31', data_emissione: '2026-08-17' }, acconto, progetto));

  // Un mese di sessioni si paga a rimessa diretta: lì il giorno di emissione è
  // la scadenza vera, non un ripiego.
  prova('un documento di sole sessioni scade il giorno stesso', '2026-08-17',
    inc.scadenzaDocumento(flamingo, null, null));

  // ⚠️ Se il giorno non si sa, non si inventa: un promemoria per un ritardo che
  // non esiste è peggio di nessun promemoria.
  prova('rata a «metà percorso» senza data: non si sa, e non si inventa', null,
    inc.scadenzaDocumento(flamingo, { innesco: 'meta', giorni: 30 }, { data_inizio: '2026-07-23' }));
}

console.log('\n— IL PROMEMORIA «VERIFICA SE È ARRIVATO» (C4b) —');
{
  const OGGI = '2026-08-25';
  const partita = { stato: 'inviata', da_pagare: 2550, incassato: 0 };

  prova('scaduta il 22, oggi è il 25: si verifica', true,
    inc.daVerificare(partita, '2026-08-22', OGGI));
  prova('scade oggi: si verifica (chi paga a rimessa diretta compare subito)', true,
    inc.daVerificare(partita, OGGI, OGGI));
  // ⭐ La decisione di Germano: PRIMA della scadenza non c'è niente da chiedere.
  prova('scade fra una settimana: NON si verifica', false,
    inc.daVerificare(partita, '2026-09-01', OGGI));
  prova('mai mandata: non si verifica (lo dice già «Proforma da mandare»)', false,
    inc.daVerificare({ ...partita, stato: 'emessa' }, '2026-08-22', OGGI));
  prova('annullata: non si verifica', false,
    inc.daVerificare({ ...partita, stato: 'annullata' }, '2026-08-22', OGGI));
  prova('già saldata: sparisce da sola', false,
    inc.daVerificare({ ...partita, incassato: 2550 }, '2026-08-22', OGGI));
  // Un acconto NON fa sparire la riga: manca ancora qualcosa.
  prova('acconto parziale: resta da verificare', true,
    inc.daVerificare({ ...partita, incassato: 1000 }, '2026-08-22', OGGI));
  // ⚠️ Scadenza sconosciuta = nessun promemoria: non si può dire in ritardo una
  // cosa che un termine non ce l'ha ancora.
  prova('scadenza non ancora nota: nessun promemoria', false,
    inc.daVerificare(partita, null, OGGI));

  prova('i giorni di ritardo', 3, inc.giorniDiRitardo('2026-08-22', OGGI));
  prova('quanti giorni prima della scadenza', -7, inc.giorniDiRitardo('2026-09-01', OGGI));
  prova('senza scadenza non c’è ritardo', null, inc.giorniDiRitardo(null, OGGI));

  prova('le parole: scade oggi', 'scade oggi', inc.daQuantoScaduta(0));
  prova('le parole: ieri', 'scaduta ieri', inc.daQuantoScaduta(1));
  prova('le parole: da N giorni', 'scaduta da 12 giorni', inc.daQuantoScaduta(12));
}

console.log('\n— LA RATA DENTRO IL DOCUMENTO —');
{
  const rata = { id: 'r1', stato: 'da_chiedere' };
  const mappa = m => new Map([['r1', m]]);

  prova('fuori da ogni documento: da chiedere', 'da_chiedere', tr.statoDi(rata, new Map()));
  prova('documento creato e fermo: da mandare', 'da_mandare',
    tr.statoDi(rata, mappa({ stato: 'emessa', saldata: false })));
  prova('documento partito: chiesta', 'chiesta',
    tr.statoDi(rata, mappa({ stato: 'inviata', saldata: false })));
  // ⭐ Il cuore della fetta: nessuno ha spuntato niente sulla rata.
  prova('documento saldato: la rata è incassata da sé', 'incassata',
    tr.statoDi(rata, mappa({ stato: 'inviata', saldata: true })));
  // E togliendo l'incasso torna indietro da sé, senza rimettere a posto niente.
  prova('tolto l’incasso, la rata torna «chiesta»', 'chiesta',
    tr.statoDi(rata, mappa({ stato: 'inviata', saldata: false })));

  // Compatibilità: fino a C3 la mappa portava una stringa. Una pagina rimasta
  // indietro non deve smettere di funzionare.
  prova('la vecchia forma a stringa funziona ancora', 'chiesta', tr.statoDi(rata, mappa('inviata')));
  // Chi si era già segnato incassato col pulsante-ponte non torna indietro.
  prova('l’incasso segnato prima di C4 resta valido', 'incassata',
    tr.statoDi({ id: 'r1', stato: 'incassata' }, new Map()));
}

console.log('\n— LA MAPPA CHE ARRIVA DAL DATABASE —');
{
  const m = inc.mappaRate([
    { tranche_id: 'r1', proforma_id: 'p1', numero: '2026/002', stato: 'inviata',
      da_pagare: '2550.00', incassato: '0', fattura_numero: null },
    { tranche_id: 'r2', proforma_id: 'p2', numero: '2026/003', stato: 'inviata',
      da_pagare: '1000.00', incassato: '1000.00', fattura_numero: null },
  ]);
  prova('la rata chiesta porta con sé il suo documento', '2026/002', m.get('r1').numero);
  prova('e quanto manca ancora', 2550, m.get('r1').residuo);
  prova('la rata saldata lo dice', true, m.get('r2').saldata);
  prova('e non manca più niente', 0, m.get('r2').residuo);
}

console.log(falliti ? `\n✗ ${falliti} prove fallite` : '\n✓ tutte le prove passate');
process.exit(falliti ? 1 : 0);
