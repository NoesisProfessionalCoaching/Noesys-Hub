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

// ═══════════════════════════════════════════════════════════════════════════
// LE DUE TINTE DELLE BOZZE PER IL COMMERCIALISTA (Germano, 29/08).
// Lui le stampa in BIANCO E NERO, e vuole distinguere a colpo d'occhio ciò che
// è uguale in tutte le versioni di un documento da ciò che cambia:
//   · quello che è comune a tutte le versioni → GRIGIO MEDIO (si riconosce, non
//     si rilegge la quinta volta);
//   · quello che CAMBIA da una versione all'altra → NERO PIENO (è la roba da
//     leggere davvero).
// ⛔ Vale SOLO con `opzioni.evidenziaVarianti`. Un contratto vero, quello che va
//    a un cliente, non è mai grigio: l'interruttore è spento di default e non lo
//    accende nessuna rotta dell'Hub.
// ⚠️ Un documento che esiste in UNA SOLA versione non si stampa in grigio: non
//    ha varianti, quindi non c'è niente da saltare e va letto tutto. Chi lo
//    genera semplicemente non accende l'interruttore.
// ═══════════════════════════════════════════════════════════════════════════
const GRIGIO       = rgb(0.50, 0.50, 0.50);
// ⚠️ Le note piccole restano più chiare del corpo, ma non troppo: a occhio sullo
//    schermo il 64% andava bene, STAMPATO in bianco e nero spariva — e lì dentro
//    ci sono cose che si leggono, per esempio l'articolo di legge sotto il
//    titolo. Misurato sulla pagina renderizzata: era 163 su 255.
const GRIGIO_TENUE = rgb(0.58, 0.58, 0.58);
const NERO         = rgb(0, 0, 0);

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
    // La tinta vera del blocco. Fuori dalle bozze restituisce quella prevista e
    // non cambia niente; dentro, riporta tutto su due soli livelli.
    const tinta = (previsto) => {
      if (!opzioni.evidenziaVarianti) return previsto;
      if (b.variante) return NERO;
      return previsto === TENUE ? GRIGIO_TENUE : GRIGIO;
    };
    switch (b.t) {
      case 'titolo':
        f.vuoto(4); f.scrivi(b.x, { size: 17, forte: true, colore: tinta(BLU) }); f.vuoto(3); break;
      case 'sottotitolo':
        f.scrivi(b.x, { size: 9, colore: tinta(TENUE) }); f.vuoto(10); break;
      case 'h':
        f.vuoto(9); f.spazio(46); f.scrivi(b.x, { size: 11.5, forte: true, colore: tinta(BLU) }); f.vuoto(3); break;
      case 'p':   f.scrivi(b.x, { colore: tinta(INCHIOSTRO) }); f.vuoto(6); break;
      case 'forte': f.scrivi(b.x, { forte: true, colore: tinta(INCHIOSTRO) }); f.vuoto(6); break;
      case 'li':  f.scrivi('•  ' + b.x, { rientro: 12, colore: tinta(INCHIOSTRO) }); f.vuoto(4); break;
      case 'campo': f.scrivi(b.x + '  ' + '.'.repeat(Math.max(4, b.punti || 46)), { colore: tinta(INCHIOSTRO) }); f.vuoto(5); break;
      case 'nota': f.scrivi(b.x, { size: 9, colore: tinta(TENUE) }); f.vuoto(6); break;
      case 'firma': f.vuoto(10); f.scrivi(b.x + '   ' + '_'.repeat(40), { colore: tinta(INCHIOSTRO) }); f.vuoto(8); break;
      // La riga della firma del Professionista. Se il contratto è firmato, il
      // tratto si appoggia SOPRA la riga: la riga resta visibile, com'è giusto
      // per una firma vera su un foglio.
      case 'firmaProf': {
        // ⚠️ Il tratto va SOPRA la riga, e la riga va abbassata per fargli posto.
        // Alla prima prova (27/08) avevo disegnato la firma senza aprire lo
        // spazio: finiva a cavallo della riga del Cliente, quella sopra.
        // 🔴 CORRETTO IL 29/08 — difetto visto da Germano su TUTTI i documenti:
        //    la firma galleggiava sopra la riga invece di appoggiarcisi.
        //    MISURATO sul PDF renderizzato (989×1400 px), non a occhio: la riga
        //    cadeva a 577,9 pt e l'inchiostro si fermava a 586,9 pt — nove punti
        //    di aria. Il PNG non c'entrava: ha appena il 5% di margine
        //    trasparente sotto l'inchiostro. Il colpevole era il punto di
        //    appoggio: `yRiga + 2` tiene l'immagine tutta SOPRA la base del
        //    testo, mentre la riga che si vede — il carattere «_» — cade circa
        //    un punto SOTTO quella base.
        // 🔴 SECONDA CORREZIONE, 29/08 — al primo tentativo avevo appoggiato
        //    sulla riga il BORDO BASSO dell'immagine, e Germano l'ha rivista
        //    ancora troppo in alto. Aveva ragione, e il motivo è nel disegno:
        //    la firma ha due code lunghissime che scendono fin quasi al bordo,
        //    mentre i corpi delle lettere finiscono molto più su. MISURATO sul
        //    PNG (1888×824): l'inchiostro fitto si ferma alla riga 480, cioè al
        //    58,3% dell'altezza. Portata a 44pt, la RIGA DI SCRITTURA della
        //    firma sta 18,4pt sopra il bordo basso, e le code arrivano a 2,5pt.
        //    ➜ Sulla riga va appoggiata la riga di scrittura, non il bordo:
        //      allineare il bordo lascia per forza la firma a mezz'aria.
        const altFirma = firmaPng ? 44 : 0;
        // Quanto l'immagine scende SOTTO la base del testo: 18,4 (la riga di
        // scrittura) + 1,2 (di quanto il carattere «_» cade sotto la base) ≈ 22.
        // Lo stesso valore si toglie dallo spazio aperto sopra, così il disegno
        // resta dov'era rispetto alla pagina e a scendere è solo la riga.
        const SOTTO = firmaPng ? 22 : 0;
        f.vuoto(10 + altFirma - SOTTO);
        f.spazio(46 + altFirma);
        const yRiga = f.y - CORPO;
        f.scrivi(b.x + '   ' + '_'.repeat(40), { colore: tinta(INCHIOSTRO) });
        if (firmaPng) {
          const larg = altFirma * (firmaPng.width / firmaPng.height);
          const xEtichetta = MRG.sx + font.widthOfTextAtSize(b.x + '   ', CORPO);
          f.pagina.drawImage(firmaPng, { x: xEtichetta + 8, y: yRiga + 2 - SOTTO, width: larg, height: altFirma });
        }
        // Le code ora scendono ~17pt sotto la riga: senza questo spazio andrebbero
        // a finire dentro il titolo del blocco successivo.
        f.vuoto(firmaPng ? 26 : 8);
        break;
      }
      case 'riga': f.riga(); break;
      // TIENI INSIEME — chiede `x` punti liberi: se non ci sono, gira pagina
      // PRIMA di cominciare il blocco. Nasce il 29/08 da un rilievo di Germano:
      // nel contratto del partecipante la pagina 5 si apriva con le sole firme,
      // perché l'art. 10 stava sulla 4 e il resto non ci entrava più. Una pagina
      // che comincia con una riga da firmare sembra un foglio staccato.
      // ⚠️ Non spezza niente: se lo spazio c'è, non fa assolutamente nulla.
      case 'tieni': f.spazio(b.x || 200); break;
      case 'vuoto': f.vuoto(b.x || 12); break;
      case 'pagina': f.nuovaPagina(); break;
      default: throw new Error('Blocco sconosciuto: ' + b.t);
    }
  }
  return Buffer.from(await pdf.save());
}

module.exports = { costruisci, BOZZA_NON_VALIDATA, PAG, MRG, COL };
