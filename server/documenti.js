// Generazione documenti personalizzati del cliente (Fetta 1b — lettera di benvenuto).
// Modello LEGGERO: la firma del coach è già DENTRO il PDF-modello; l'unica cosa che
// l'Hub scrive è il saluto personalizzato ("Caro ___, benvenuto.").
// Niente conversioni Word→PDF: si scrive solo il saluto con pdf-lib sul PDF-modello.
//
// Come combacia con la lettera (rifinitura 23/07):
//  - font = EB Garamond incorporato (il modello usa Garamond; EB Garamond è la
//    versione libera che gli somiglia), corpo ~12.96 come il testo della lettera;
//  - invece di scrivere solo il nome (che lasciava un brutto vuoto dopo "Caro"),
//    si scrive TUTTO il pezzo "{Nome}, benvenuto." subito dopo "Caro" (spaziatura
//    naturale) e si copre con un rettangolo bianco il ", benvenuto." già stampato.

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const drive = require('./google-drive');

// TTF EB Garamond incorporato nel repo (server/assets/fonts). Caricato una volta.
const GARAMOND_TTF = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'EBGaramond-Regular.ttf'));

// Coordinate ESATTE estratte dai due PDF-modello (pdfjs, 22-23/07).
//  - caroEndX = fine della parola "Caro"/"Cara" (dove attacca il saluto nuovo);
//  - clearX/clearW = rettangolo bianco che copre il vecchio ", benvenuto."/", benvenuta.";
//  - baseY = linea di base del saluto; word = parola giusta per genere.
const LETTERE = {
  maschile:  { file: 'Lettera Benvenuto OK.pdf', caroEndX: 95.6, clearX: 156, clearW: 76, baseY: 687.3, word: 'benvenuto' },
  femminile: { file: 'Lettera Benvenuta OK.pdf', caroEndX: 94.2, clearX: 161, clearW: 72, baseY: 687.8, word: 'benvenuta' },
};
const NAME_SIZE = 12.96;                // combacia col corpo della lettera
const NAME_COLOR = rgb(0.13, 0.13, 0.13);

// Euristica italiana per scegliere Benvenuto/Benvenuta dal nome: finale in -a → femminile.
// È solo un default: nel pannello "Rivedi e invia" il coach potrà cambiare lettera.
function genereFromNome(nome) {
  const primo = String(nome || '').trim().split(/\s+/)[0].toLowerCase();
  if (!primo) return 'maschile';
  return primo.endsWith('a') ? 'femminile' : 'maschile';
}

// Genera il PDF della lettera di benvenuto col saluto personalizzato.
// `nome` = nome di battesimo (usa solo la prima parola). `genere` opzionale forza M/F.
// Restituisce { bytes:Buffer, genere, fileName }.
async function generaLetteraBenvenuto({ nome, genere }) {
  const nomeBattesimo = String(nome || '').trim().split(/\s+/)[0];
  if (!nomeBattesimo) throw new Error('Manca il nome del cliente per la lettera');
  const g = (genere === 'maschile' || genere === 'femminile') ? genere : genereFromNome(nomeBattesimo);
  const cfg = LETTERE[g];

  const modelli = await drive.findModelliFolder();
  if (!modelli) throw new Error('Cartella "Modelli" non trovata su Drive');
  const src = await drive.findFileByName(modelli.id, cfg.file);
  if (!src) throw new Error('Modello lettera non trovato in Modelli: ' + cfg.file);

  const pdf = await PDFDocument.load(await drive.downloadFileBuffer(src.id));
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(GARAMOND_TTF, { subset: true });
  const page = pdf.getPages()[0];

  // 1) Copro il vecchio ", benvenuto." con un rettangolo bianco (la riga del saluto
  //    è isolata: sopra c'è l'intestazione, sotto una riga vuota, quindi c'è spazio).
  page.drawRectangle({
    x: cfg.clearX, y: cfg.baseY - 4, width: cfg.clearW, height: 17,
    color: rgb(1, 1, 1),
  });

  // 2) Scrivo "{Nome}, benvenuto." subito dopo "Caro" (spazio iniziale = spaziatura naturale).
  const testo = ' ' + nomeBattesimo + ', ' + cfg.word + '.';
  page.drawText(testo, {
    x: cfg.caroEndX, y: cfg.baseY, size: NAME_SIZE, font, color: NAME_COLOR,
  });

  const bytes = Buffer.from(await pdf.save());
  return { bytes, genere: g, fileName: 'Lettera di Benvenuto - ' + nomeBattesimo + '.pdf' };
}

module.exports = { generaLetteraBenvenuto, genereFromNome };
