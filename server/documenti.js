// Generazione documenti personalizzati del cliente (Fetta 1b — lettera di benvenuto).
// Modello LEGGERO: la firma del coach è già DENTRO il PDF-modello; l'unica cosa che
// l'Hub scrive è il NOME di battesimo, nello spazio del saluto ("Caro ___, benvenuto.").
// Niente conversioni Word→PDF: si sovrascrive solo il testo con pdf-lib sul PDF-modello.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const drive = require('./google-drive');

// Coordinate ESATTE estratte dai due PDF-modello (pdfjs, 22/07): la virgola del saluto
// ("Caro ___, benvenuto.") e la linea di base del testo. Il nome è allineato a DESTRA
// contro la virgola (così "Nome," resta sempre attaccato, per qualsiasi lunghezza).
const LETTERE = {
  maschile:  { file: 'Lettera Benvenuto OK.pdf', commaX: 160.6, baseY: 687.3 },
  femminile: { file: 'Lettera Benvenuta OK.pdf', commaX: 165.8, baseY: 687.8 },
};
const NAME_SIZE = 12.6;                 // combacia col corpo della lettera (serif ~Times)
const NAME_COLOR = rgb(0.13, 0.13, 0.13);
const GAP_VIRGOLA = 1.5;                // stacco minimo tra nome e virgola

// Euristica italiana per scegliere Benvenuto/Benvenuta dal nome: finale in -a → femminile.
// È solo un default: nel pannello "Rivedi e invia" il coach potrà cambiare lettera.
function genereFromNome(nome) {
  const primo = String(nome || '').trim().split(/\s+/)[0].toLowerCase();
  if (!primo) return 'maschile';
  return primo.endsWith('a') ? 'femminile' : 'maschile';
}

// Genera il PDF della lettera di benvenuto col nome scritto al punto giusto.
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
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const w = font.widthOfTextAtSize(nomeBattesimo, NAME_SIZE);
  page.drawText(nomeBattesimo, {
    x: cfg.commaX - GAP_VIRGOLA - w, y: cfg.baseY, size: NAME_SIZE, font, color: NAME_COLOR,
  });

  const bytes = Buffer.from(await pdf.save());
  return { bytes, genere: g, fileName: 'Lettera di Benvenuto - ' + nomeBattesimo + '.pdf' };
}

module.exports = { generaLetteraBenvenuto, genereFromNome };
