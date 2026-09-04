// PROVA DEI PEZZI COMUNI — fetta 4.3 del riordino (04/09/2026).
//
// «Un solo oggi, un solo euro, una sola data italiana, un solo rinnovo del
// token Google.» Le copie sono diventate una: qui si prova quella, e si prova
// che i moduli che prima avevano la propria la usino davvero.
//
//   node scripts/prova-comuni.js

const dateIt = require('../server/date-it');
const token = require('../server/google-token');
const incassi = require('../server/incassi');
const sedute = require('../server/sedute');
const maturato = require('../server/maturato');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

(async () => {
  console.log('— LE DATE —');
  prova('oggi a Roma è AAAA-MM-GG', true, /^\d{4}-\d{2}-\d{2}$/.test(dateIt.oggiRoma()));
  prova('e coincide con quello che dicevano sedute.js e maturato.js', [dateIt.oggiRoma(), dateIt.oggiRoma()], [sedute.oggiRoma(), maturato.oggiRoma()]);
  prova('dataIt: una DATE', '04/09/2026', dateIt.dataIt('2026-09-04'));
  prova('dataIt: l\'inizio di una stringa ISO', '04/09/2026', dateIt.dataIt('2026-09-04T22:30:00.000Z'));
  prova('dataIt: vuoto → vuoto', '', dateIt.dataIt(null));
  prova('dataIt: una cosa che non è una data resta com\'è', 'boh', dateIt.dataIt('boh'));
  prova('dataEstesa: «4 settembre 2026»', '4 settembre 2026', dateIt.dataEstesa('2026-09-04'));
  prova('dataEstesa: vuoto → vuoto', '', dateIt.dataEstesa(''));
  prova('dataOraIt: un momento in ora italiana (d\'estate +2)', '04/09/2026 alle 14:26', dateIt.dataOraIt('2026-09-04T12:26:00.000Z'));
  prova('dataOraIt: a mezzanotte e mezza di Greenwich a Roma è già il giorno dopo', '05/09/2026 alle 02:30', dateIt.dataOraIt('2026-09-05T00:30:00.000Z'));
  prova('dataOraIt: vuoto → «—»', '—', dateIt.dataOraIt(null));
  prova('dataOraIt: una cosa che non è una data resta com\'è', 'boh', dateIt.dataOraIt('boh'));

  console.log('\n— L\'EURO —');
  prova('incassi non ha più una «euro» che fa il contrario di fiscale.euro', 'undefined', typeof incassi.euro);
  prova('la conversione da centesimi si chiama per quello che fa', 12.34, incassi.daCentesimi(1234));
  prova('  e regge le stringhe di Postgres', 25.5, incassi.daCentesimi('2550'));

  console.log('\n— IL TOKEN GOOGLE —');
  token.dimentica();
  let chiamate = [];
  const finto = async (url, o) => { chiamate.push(String(o.body)); return { ok: true, json: async () => ({ access_token: 'tok-' + chiamate.length, expires_in: 3600 }) }; };
  const t1 = await token.tokenGoogle({ clientId: 'id', clientSecret: 's', refreshToken: 'R-DRIVE', etichetta: 'Drive', adesso: 1000, chiama: finto });
  const t2 = await token.tokenGoogle({ clientId: 'id', clientSecret: 's', refreshToken: 'R-DRIVE', etichetta: 'Drive', adesso: 2000, chiama: finto });
  prova('il secondo giro con lo stesso refresh token usa la cache: una chiamata sola', ['tok-1', 'tok-1', 1], [t1, t2, chiamate.length]);
  const t3 = await token.tokenGoogle({ clientId: 'id', clientSecret: 's', refreshToken: 'R-GMAIL', etichetta: 'Gmail', adesso: 2000, chiama: finto });
  prova('un refresh token diverso (Gmail) ha il suo token, non quello di Drive', ['tok-2', 2], [t3, chiamate.length]);
  prova('  e la richiesta porta il refresh token giusto', true, /refresh_token=R-GMAIL/.test(chiamate[1]));
  const t4 = await token.tokenGoogle({ clientId: 'id', clientSecret: 's', refreshToken: 'R-DRIVE', etichetta: 'Drive', adesso: 1000 + 3600 * 1000, chiama: finto });
  prova('scaduto (60 s prima della scadenza vera), si rinnova', ['tok-3', 3], [t4, chiamate.length]);
  let err = null;
  try { await token.tokenGoogle({ clientId: 'id', clientSecret: 's', refreshToken: 'R-ROTTO', etichetta: 'Gmail', chiama: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }) }); }
  catch (e) { err = e.message; }
  prova('🔬 un refresh token revocato dice quale collegamento è rotto', 'Rinnovo token Gmail fallito: invalid_grant', err);

  console.log(falliti ? `\n🔴 ${falliti} prove fallite` : '\n✅ pezzi comuni: tutte le prove passano');
  process.exit(falliti ? 1 : 0);
})();
