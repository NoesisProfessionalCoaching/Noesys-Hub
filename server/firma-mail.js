// LA FIRMA DELLE MAIL DELL'HUB — modulo puro (15/10/2026).
//
// Germano, 15/10: ogni mail che parte da info@ si chiude con la stessa firma —
// la sua firma a mano, il nome scritto, il logo NOESYS Professional Coaching e,
// uno sotto l'altro, il sito e l'indirizzo (niente social finché non ci sono).
// Approvata sull'anteprima: logo più piccolo del 15% (196 px), sito e mail in colonna,
// ognuno con un trattino davanti (variante A: riprende i trattini del logo); prima la mail,
// poi il sito (Germano, 15/10 16:30: «telefono, mail, sito» — il telefono solo nella sua casella).
//
// Tutte le mail dell'Hub (benvenuto, contratto, permessi degli strumenti, proforma,
// e-book) si chiudono già col suo nome: qui l'ultima riga «Germano» o «Germano
// Guerriero» (anche «— Noesys Professional Coaching») si TOGLIE, perché il nome lo
// porta la firma. Si toglie al momento di spedire e non nei modelli, così vale
// anche per un testo ritoccato nella finestrella prima dell'invio, e i testi
// approvati (la Matrice, l'e-book) restano quelli.
//
// La mail parte in due versioni: grafica (HTML) e solo testo, per chi non vede la
// grafica. Firma e logo viaggiano DENTRO la mail (allegati «in linea», cid:):
// un'immagine caricata da internet molti programmi la bloccano finché non si
// preme «mostra immagini».

const fs = require('fs');
const path = require('path');

const FIRMA = path.join(__dirname, 'posta', 'firma-germano.png');
const LOGO = path.join(__dirname, 'posta', 'logo-noesys.png');
const CID_FIRMA = 'firma-germano@noesys';
const CID_LOGO = 'logo-noesys@noesys';
const SITO = 'noesys-group.com';
const POSTA = 'info@noesys-group.com';
const BLU = '#223B6E';

const NOME_FINALE = /^germano(\s+guerriero)?(\s*[—–-]\s*noesys professional coaching)?\s*$/i;

/** Toglie l'ultima riga se è il nome di Germano (le righe vuote in coda spariscono con lei). */
function togliNomeFinale(testo) {
  const righe = String(testo || '').replace(/\r\n/g, '\n').split('\n');
  while (righe.length && !righe[righe.length - 1].trim()) righe.pop();
  if (righe.length && NOME_FINALE.test(righe[righe.length - 1].trim())) righe.pop();
  while (righe.length && !righe[righe.length - 1].trim()) righe.pop();
  return righe.join('\n');
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// I collegamenti scritti nel testo diventano cliccabili (il punto finale di una frase resta fuori).
const conLink = s => esc(s).replace(/(https?:\/\/[^\s<]+?)([.,;:!?)]*)(?=\s|$)/g,
  (m, url, coda) => `<a href="${url}" style="color:${BLU}">${url}</a>${coda}`);

/** Il testo della mail in HTML: paragrafi dove c'è una riga vuota, a capo dove c'è un a capo. */
function corpoHtml(testo) {
  return testo.split(/\n{2,}/).filter(p => p.trim())
    .map(p => `<p style="margin:0 0 14px">${conLink(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/**
 * Dal testo scritto per la mail alle due versioni con la firma, più le due immagini da
 * allegare in linea. `testo` è quello di sempre (finisce col nome: si toglie qui).
 */
function componi(testo) {
  const corpo = togliNomeFinale(testo);
  const text = `${corpo}\n\nGermano Guerriero\nNoesys Professional Coaching\n— ${POSTA}\n— ${SITO}\n`;
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#ffffff">
<div style="max-width:600px;padding:24px 20px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#2b2b2b">
${corpoHtml(corpo)}
<img src="cid:${CID_FIRMA}" alt="Germano Guerriero" width="190" style="display:block;width:190px;height:auto;margin:6px 0 2px;border:0">
<div style="font-size:14px;color:#2b2b2b">Germano Guerriero</div>
<div style="border-top:1px solid #e3e1db;margin:22px 0 16px;width:240px;height:0;line-height:0;font-size:0">&nbsp;</div>
<img src="cid:${CID_LOGO}" alt="NOESYS Professional Coaching" width="196" style="display:block;width:196px;height:auto;border:0">
<div style="font-size:13px;line-height:1.6;color:#6b6b6b;margin-top:10px">
—&nbsp;<a href="mailto:${POSTA}" style="color:${BLU};text-decoration:none">${POSTA}</a><br>
—&nbsp;<a href="https://${SITO}" style="color:${BLU};text-decoration:none">${SITO}</a>
</div>
</div>
</body></html>`;
  const immagini = [
    { filename: 'firma.png', content: fs.readFileSync(FIRMA), contentType: 'image/png', cid: CID_FIRMA, contentDisposition: 'inline' },
    { filename: 'noesys.png', content: fs.readFileSync(LOGO), contentType: 'image/png', cid: CID_LOGO, contentDisposition: 'inline' },
  ];
  return { text, html, immagini };
}

module.exports = { componi, togliNomeFinale, corpoHtml, CID_FIRMA, CID_LOGO };
