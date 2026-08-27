/**
 * L'IMPAGINATORE DEI CONTRATTI — il PDF lo costruisce l'Hub, da zero.
 *
 * ⭐ L'INQUADRAMENTO È DI GERMANO (09/08/2026): «la contrattualizzazione si
 *    governa dall'anagrafica e dall'amministrazione, non dai documenti. Il
 *    contratto è una VISTA sui dati dell'Hub, non un foglio da riempire».
 *
 * Perché da zero e non scrivendo sopra un PDF-modello (Opzione 3, scelta il
 * 09/08 fra quattro): un modello per combinazione farebbe otto file da tenere
 * allineati a mano, e ogni ritocco al testo obbligherebbe a rimisurare le
 * coordinate. Qui le pagine le comanda il codice, una per una.
 *
 * ⚠️ NON è la strada fallita l'08/08: quella generava HTML→PDF con Chrome, che
 *    spostava gli elementi `position:fixed` e mandava il piè di pagina in cima
 *    alle pagine successive. Qui la carta intestata si ridisegna a ogni pagina.
 *
 * 📄 CARTA INTESTATA su OGNI pagina, non solo la prima (Germano, 27/08).
 *    Non la ridisegno: incorporo la sua, `Modelli/Carta Intestata OK.pdf`, così
 *    il documento esce con la grafica vera e non con una mia imitazione.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const drive = require('./google-drive');

// 🔴 LA BANDA. Finché è accesa, ogni pagina dice che il testo non è validato.
// Si spegne SOLO quando Germano dice che il controllo legale è passato: è
// l'unica cosa che rende sicuro far girare la catena intera con testi provvisori.
const BOZZA_NON_VALIDATA = true;

// ── Geometria, misurata sulla carta intestata vera (A4 = 595 × 842 punti) ──
// La riga sotto il logo sta a y≈737, il piè di pagina a y≈41. Il testo sta in
// mezzo, centrato sotto la riga ma più stretto: una colonna larga quanto la
// riga sarebbe da ~100 battute, illeggibile.
const PAG = { larg: 595.28, alt: 841.89 };
const MRG = { sx: 70, dx: 70, alto: 700, basso: 78 };
const COL = PAG.larg - MRG.sx - MRG.dx;

const CORPO = 10.5;
const INTERLINEA = 1.42;
const INCHIOSTRO = rgb(0.13, 0.14, 0.16);
const TENUE = rgb(0.42, 0.45, 0.49);
const BLU = rgb(0.13, 0.23, 0.43);

// La cartella `Modelli` su Drive e il nome ESATTO della carta intestata.
const MODELLI = '1rzsYYD_rXejGfMSlIEe_sAW_1KcrqeqG';
const CARTA = 'Carta Intestata OK.pdf';
// La firma di Germano: PNG col tratto su sfondo TRASPARENTE, caricato da lui su
// Drive il 27/08. ⛔ Sta su Drive e non nel repo di proposito: una firma dentro
// GitHub è una firma che gira. Se il file cambia nome, cambia questa riga.
const FIRMA = 'Firma_trasparente.png';

// La carta intestata si scarica una volta per processo: è un file che cambia
// una volta all'anno, e scaricarlo a ogni contratto vorrebbe dire far dipendere
// la generazione dalla rete per niente. Se Germano la cambia su Drive, entra al
// riavvio dell'Hub.
let cartaCache = null;
async function cartaIntestata() {
  if (cartaCache) return cartaCache;
  const f = await drive.findFileByName(MODELLI, CARTA);
  if (!f) throw new Error(`Sul Drive manca «${CARTA}» nella cartella Modelli`);
  cartaCache = await drive.downloadFileBuffer(f.id);
  return cartaCache;
}

let firmaCache = null;
async function firmaGrafica() {
  if (firmaCache) return firmaCache;
  const f = await drive.findFileByName(MODELLI, FIRMA);
  if (!f) throw new Error(`Sul Drive manca «${FIRMA}» nella cartella Modelli`);
  firmaCache = await drive.downloadFileBuffer(f.id);
  return firmaCache;
}

// ⚠️ Il Garamond GRASSETTO non esiste ancora: sul Mac e nel repo c'è solo il
// tondo. Finché non arriva `EBGaramond-Bold.ttf`, il grassetto si simula
// ridisegnando lo stesso testo con uno scarto di 0,25 punti. Sui titoli regge;
// su un paragrafo intero si vedrebbe. ➜ Da sostituire col font vero.
const SCARTO_FINTO_GRASSETTO = 0.25;

class Foglio {
  constructor(pdf, sfondo, font) {
    this.pdf = pdf; this.sfondo = sfondo; this.font = font;
    this.pagina = null; this.y = 0;
    this.nuovaPagina();
  }
  nuovaPagina() {
    this.pagina = this.pdf.addPage([PAG.larg, PAG.alt]);
    this.pagina.drawPage(this.sfondo, { x: 0, y: 0, width: PAG.larg, height: PAG.alt });
    if (BOZZA_NON_VALIDATA) this.banda();
    this.y = MRG.alto;
  }
  banda() {
    const t = 'BOZZA NON VALIDATA — testo non verificato da un legale';
    const s = 7.5;
    const l = this.font.widthOfTextAtSize(t, s);
    this.pagina.drawRectangle({
      x: 0, y: PAG.alt - 20, width: PAG.larg, height: 14,
      color: rgb(0.99, 0.96, 0.86),
    });
    this.pagina.drawText(t, {
      x: (PAG.larg - l) / 2, y: PAG.alt - 16.5, size: s,
      font: this.font, color: rgb(0.55, 0.42, 0.08),
    });
  }
  // Fa stare `spazio` punti: se non ci stanno, gira pagina.
  spazio(quanto) {
    if (this.y - quanto < MRG.basso) this.nuovaPagina();
  }
  scrivi(testo, o = {}) {
    const size = o.size || CORPO;
    const font = this.font;
    const colore = o.colore || INCHIOSTRO;
    const x0 = MRG.sx + (o.rientro || 0);
    const larg = COL - (o.rientro || 0);
    const passo = size * INTERLINEA;
    for (const riga of aCapo(testo, font, size, larg)) {
      this.spazio(passo);
      let x = x0;
      if (o.centrato) x = (PAG.larg - font.widthOfTextAtSize(riga, size)) / 2;
      this.pagina.drawText(riga, { x, y: this.y - size, size, font, color: colore });
      if (o.forte) {
        this.pagina.drawText(riga, {
          x: x + SCARTO_FINTO_GRASSETTO, y: this.y - size, size, font, color: colore,
        });
      }
      this.y -= passo;
    }
  }
  vuoto(quanto = 8) { this.y -= quanto; }
  riga(colore = rgb(0.88, 0.89, 0.91)) {
    this.spazio(10);
    this.pagina.drawLine({
      start: { x: MRG.sx, y: this.y }, end: { x: PAG.larg - MRG.dx, y: this.y },
      thickness: 0.6, color: colore,
    });
    this.y -= 10;
  }
}

/** Spezza un testo in righe che stanno dentro `larg`. */
function aCapo(testo, font, size, larg) {
  const fuori = [];
  for (const paragrafo of String(testo).split('\n')) {
    if (!paragrafo.trim()) { fuori.push(''); continue; }
    let riga = '';
    for (const parola of paragrafo.split(/\s+/)) {
      const prova = riga ? riga + ' ' + parola : parola;
      if (font.widthOfTextAtSize(prova, size) > larg && riga) { fuori.push(riga); riga = parola; }
      else riga = prova;
    }
    if (riga) fuori.push(riga);
  }
  return fuori;
}

/**
 * Costruisce il PDF a partire da un elenco di BLOCCHI.
 * Un blocco è { t: tipo, x: testo }, e i tipi sono pochi apposta:
 *   titolo · sottotitolo · h (numero d'articolo) · p · forte · li · campo ·
 *   nota · firma · riga · vuoto
 */
async function costruisci(blocchi, opzioni = {}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const ttf = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'EBGaramond-Regular.ttf'));
  const font = await pdf.embedFont(ttf, { subset: true });
  const cartaPdf = await PDFDocument.load(await cartaIntestata());
  const [sfondo] = await pdf.embedPdf(cartaPdf, [0]);
  // 🔴 LA FIRMA SI METTE SOLO SE QUALCUNO LA CHIEDE. Il valore normale è NIENTE
  // firma: un'anteprima, una prova o una rigenerazione non devono produrre un
  // file che porta la firma di Germano senza che lui l'abbia approvato.
  const firmaPng = opzioni.firmato ? await pdf.embedPng(await firmaGrafica()) : null;

  const f = new Foglio(pdf, sfondo, font);

  for (const b of blocchi) {
    switch (b.t) {
      case 'titolo':
        f.vuoto(4); f.scrivi(b.x, { size: 17, forte: true, colore: BLU }); f.vuoto(3); break;
      case 'sottotitolo':
        f.scrivi(b.x, { size: 9, colore: TENUE }); f.vuoto(10); break;
      case 'h':
        f.vuoto(9); f.spazio(46); f.scrivi(b.x, { size: 11.5, forte: true, colore: BLU }); f.vuoto(3); break;
      case 'p':   f.scrivi(b.x); f.vuoto(6); break;
      case 'forte': f.scrivi(b.x, { forte: true }); f.vuoto(6); break;
      case 'li':  f.scrivi('•  ' + b.x, { rientro: 12 }); f.vuoto(4); break;
      case 'campo': f.scrivi(b.x + '  ' + '.'.repeat(Math.max(4, b.punti || 46))); f.vuoto(5); break;
      case 'nota': f.scrivi(b.x, { size: 9, colore: TENUE }); f.vuoto(6); break;
      case 'firma': f.vuoto(10); f.scrivi(b.x + '   ' + '_'.repeat(40)); f.vuoto(8); break;
      // La riga della firma del Professionista. Se il contratto è firmato, il
      // tratto si appoggia SOPRA la riga: la riga resta visibile, com'è giusto
      // per una firma vera su un foglio.
      case 'firmaProf': {
        // ⚠️ Il tratto va SOPRA la riga, e la riga va abbassata per fargli posto.
        // Alla prima prova (27/08) avevo disegnato la firma senza aprire lo
        // spazio: finiva a cavallo della riga del Cliente, quella sopra.
        const altFirma = firmaPng ? 44 : 0;
        f.vuoto(10 + altFirma);
        f.spazio(46 + altFirma);
        const yRiga = f.y - CORPO;
        f.scrivi(b.x + '   ' + '_'.repeat(40));
        if (firmaPng) {
          const larg = altFirma * (firmaPng.width / firmaPng.height);
          const xEtichetta = MRG.sx + font.widthOfTextAtSize(b.x + '   ', CORPO);
          f.pagina.drawImage(firmaPng, { x: xEtichetta + 8, y: yRiga + 2, width: larg, height: altFirma });
        }
        f.vuoto(8);
        break;
      }
      case 'riga': f.riga(); break;
      case 'vuoto': f.vuoto(b.x || 12); break;
      case 'pagina': f.nuovaPagina(); break;
      default: throw new Error('Blocco sconosciuto: ' + b.t);
    }
  }
  return Buffer.from(await pdf.save());
}

module.exports = { costruisci, BOZZA_NON_VALIDATA, PAG, MRG, COL };
