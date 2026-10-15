// PROVA DELLA FIRMA DELLE MAIL (15/10/2026) — server/firma-mail.js e server/mailer.js.
//
// Nessuna rete e nessun invio: si costruisce il messaggio come lo spedirebbe l'Hub
// e lo si legge. Si controlla che:
//   · il nome finale dei testi VERI dell'Hub sparisca (e solo quello);
//   · la mail parta in due versioni, grafica e solo testo, con firma e logo DENTRO;
//   · il mittente sia quello di GMAIL_USER e gli allegati di prima ci siano ancora.
//
//   node scripts/prova-firma-mail.js        → codice 0 se è tutto a posto, 1 se no.

const firma = require('../server/firma-mail');
const mailer = require('../server/mailer');
// L'Hub vecchio non ha l'e-book: il suo testo si prova come stringa (finisce come quello vero).
const strumenti = require('../server/mail-strumenti');
const proforma = require('../server/proforma');

let rotte = 0;
const prova = (cosa, ok, dettaglio) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + cosa + (ok || dettaglio === undefined ? '' : '  →  ' + dettaglio));
  if (!ok) rotte++;
};
const ultima = t => t.trim().split('\n').pop().trim();

(async () => {
  console.log('== il nome finale, sui testi veri dell\'Hub');
  prova('chiusura «Buona lettura,» + «Germano Guerriero»: resta «Buona lettura,»', ultima(firma.togliNomeFinale('Ciao Anna,\n\nBuona lettura,\nGermano Guerriero')) === 'Buona lettura,');
  prova('permesso di uno strumento: resta «A presto,»', ultima(firma.togliNomeFinale(strumenti.GENERICO.body)) === 'A presto,');
  prova('Matrice dell\'Identità (testo di Germano): resta «A presto,»', ultima(firma.togliNomeFinale(strumenti.TESTI['matrice-identita'].body)) === 'A presto,');
  const pfPersona = proforma.testoMail({ numero: '2026/001', da_pagare: 100, destinatario_dati: { denominazione: 'Anna Rossi' } }, []).body;
  const pfAzienda = proforma.testoMail({ numero: '2026/001', da_pagare: 100, committente_id: 'k', destinatario_dati: { denominazione: 'Acme' } }, []).body;
  prova('proforma a una persona: via «Germano Guerriero — Noesys…»', ultima(firma.togliNomeFinale(pfPersona)) === 'Ti ringrazio e ti saluto cordialmente,', ultima(firma.togliNomeFinale(pfPersona)));
  prova('proforma a un\'azienda: idem', ultima(firma.togliNomeFinale(pfAzienda)) === 'Vi ringrazio e vi saluto cordialmente,', ultima(firma.togliNomeFinale(pfAzienda)));
  prova('Mail 1 (chiude con «…a presto.» e «Germano»)', ultima(firma.togliNomeFinale('Ciao Anna,\n\nPer ora è tutto. Grazie ancora e a presto.\nGermano')) === 'Per ora è tutto. Grazie ancora e a presto.');
  prova('righe vuote e spazi dopo il nome: tolti anche quelli', firma.togliNomeFinale('Ciao,\n\nA presto,\nGermano  \n\n') === 'Ciao,\n\nA presto,');
  prova('un testo senza nome in fondo resta com\'è', firma.togliNomeFinale('Ciao,\n\nA presto,') === 'Ciao,\n\nA presto,');
  prova('«Germano» a metà testo resta', firma.togliNomeFinale('Ciao Germano,\n\ngrazie.') === 'Ciao Germano,\n\ngrazie.');
  prova('un altro Germano in fondo («Germano Rossi») resta', ultima(firma.togliNomeFinale('Saluti da\nGermano Rossi')) === 'Germano Rossi');

  console.log('== la versione grafica');
  const c = firma.componi('Ciao Anna,\n\nscarica da qui:\nhttps://esempio.it/x.\n\n<b>non grassetto</b> & co\n\nA presto,\nGermano');
  prova('la firma a mano c\'è (in linea, cid)', c.html.includes(`src="cid:${firma.CID_FIRMA}"`));
  prova('il logo c\'è (in linea, cid)', c.html.includes(`src="cid:${firma.CID_LOGO}"`));
  prova('sito e mail cliccabili, uno sotto l\'altro, col trattino davanti (variante A)', /—&nbsp;<a href="https:\/\/noesys-group\.com"[^]*?<br>\s*—&nbsp;<a href="mailto:info@noesys-group\.com"/.test(c.html));
  prova('il logo è largo 196 px (−15%)', /cid:logo-noesys@noesys" alt="[^"]*" width="196"/.test(c.html));
  prova('il collegamento del testo è cliccabile, il punto finale resta fuori', c.html.includes('<a href="https://esempio.it/x" style="color:#223B6E">https://esempio.it/x</a>.'));
  prova('il testo non diventa codice (< e & protetti)', c.html.includes('&lt;b&gt;non grassetto&lt;/b&gt; &amp; co') && !c.html.includes('<b>non'));
  prova('il nome non compare due volte: una sola riga «Germano Guerriero» oltre all\'immagine', (c.html.match(/>Germano Guerriero</g) || []).length === 1 && !/<p[^>]*>[^<]*A presto,<br>Germano/.test(c.html));
  prova('due immagini da allegare, in linea', c.immagini.length === 2 && c.immagini.every(i => i.cid && i.content.length > 1000 && i.contentDisposition === 'inline'));

  console.log('== la versione solo testo');
  prova('finisce con nome, Noesys, sito e mail (col trattino)', /A presto,\n\nGermano Guerriero\nNoesys Professional Coaching\n— noesys-group\.com\n— info@noesys-group\.com\n$/.test(c.text), JSON.stringify(c.text.slice(-120)));

  console.log('== il messaggio che spedirebbe l\'Hub');
  process.env.GMAIL_USER = 'info@noesys-group.com';
  const raw = (await mailer.preparaMessaggio({
    to: 'anna@esempio.it', subject: 'Prova', text: 'Ciao Anna,\n\nA presto,\nGermano',
    attachments: [{ filename: 'Contratto.pdf', content: Buffer.from('%PDF-1.4 finto'), contentType: 'application/pdf' }],
  })).toString();
  prova('mittente info@ (da GMAIL_USER)', /^From: .*<info@noesys-group\.com>/m.test(raw));
  prova('due versioni: solo testo e grafica', /multipart\/alternative/.test(raw) && /Content-Type: text\/plain/.test(raw) && /Content-Type: text\/html/.test(raw));
  prova('firma e logo dentro la mail', raw.includes('Content-ID: <' + firma.CID_FIRMA + '>') && raw.includes('Content-ID: <' + firma.CID_LOGO + '>'));
  prova('l\'allegato di prima c\'è ancora', /filename="?Contratto\.pdf/.test(raw) && /application\/pdf/.test(raw));

  console.log(rotte ? `\n✗ ${rotte} controlli NON passati.` : '\n✓ La firma delle mail è a posto.');
  process.exit(rotte ? 1 : 0);
})().catch(e => { console.error('✗ La prova si è fermata:', e.message); process.exit(1); });
