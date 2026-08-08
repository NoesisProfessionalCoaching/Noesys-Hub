// Lettura dei MODULI che il cliente rimanda compilati (scheda anagrafica, contratto).
// -----------------------------------------------------------------------------
// I moduli sono PDF, e il cliente li compila SCRIVENDOCI SOPRA (come si fa con
// Anteprima sul Mac o con un'app di firma). Perciò i valori NON sono testo del
// documento — il testo del PDF è solo il modulo vuoto, con le domande — ma
// ANNOTAZIONI appoggiate sopra, ciascuna con la sua posizione sulla pagina.
// Qui si tirano fuori tre cose:
//   · che modulo è (vedi sotto: dal nome, e il perché)
//   · i valori scritti, IN ORDINE DI LETTURA (dall'alto in basso, da sinistra)
//   · quante firme ci sono (i "timbri": nel contratto la SECONDA vale come
//     consenso al trattamento dei dati — regola di Germano, 07/08)
// L'abbinamento valore→campo NON si fa qui: la geometria da sola sbaglia (provata,
// sfasa di una riga e sul contratto non aggancia niente). Lo fa Claude, che sa
// che "23 Agosto 1970" è una data di nascita. Vedi claude.estraiAnagrafica().
//
// pdf-lib era GIÀ in casa (serve a generare la modulistica): nessuna libreria nuova.
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict } = require('pdf-lib');

// ⚠️ CHE MODULO È — dal NOME del file, e questo va spiegato.
// Volevo riconoscerlo dal testo stampato ("Scheda Profilo Cliente", "Accordo per
// servizi di coaching"), che sarebbe più solido. Non si può: dentro questi PDF il
// testo è scritto con font incorporati e una mappa di caratteri propria, quindi
// letto grezzo esce illeggibile (`!!!!!"#$%&'…`). Servirebbe applicare la ToUnicode
// del font, cioè un lettore PDF completo: sproporzionato per il risultato.
// Il nome, in compenso, NON è casuale: questi moduli li genera e li spedisce
// l'Hub stesso (Mail 1 e Mail 2), quindi si chiamano sempre allo stesso modo; il
// trattino basso lo aggiunge il download di Drive.
// **Se il nome non corrisponde, il file viene IGNORATO** — mai interpretato a caso:
// un modulo non riconosciuto non fa danni, un modulo scambiato sì.
const TIPI = [
  { tipo: 'scheda',    nome: /(scheda[\s_-]*(anagrafic|profilo)|anagrafic)/i },
  { tipo: 'contratto', nome: /(contratto|accordo)/i },
];

function tipoDalNome(nomeFile) {
  const t = TIPI.find(x => x.nome.test(String(nomeFile || '')));
  return t ? t.tipo : null;
}

// Legge un PDF e restituisce: che modulo è, i valori scritti sopra, le firme.
async function leggiModulo(buffer, nomeFile) {
  const doc = await PDFDocument.load(buffer, {
    ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false,
  });
  const ctx = doc.context;
  const pagine = doc.getPages();

  let valori = [];
  let firme = 0;
  let firmaUltimaPagina = false;

  pagine.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const o = ctx.lookup(annots.get(k), PDFDict);
      if (!o || !o.get) continue;
      const sub = o.get(PDFName.of('Subtype'));
      const tipoAnn = sub ? sub.toString() : '';
      if (tipoAnn === '/Stamp') {
        firme++;
        if (i === pagine.length - 1) firmaUltimaPagina = true;
      }
      const c = o.get(PDFName.of('Contents'));
      if (!c) continue;
      const testo = (c instanceof PDFString || c instanceof PDFHexString)
        ? c.decodeText() : String(c);
      if (!testo.trim()) continue;
      const rect = ctx.lookup(o.get(PDFName.of('Rect')), PDFArray);
      const r = rect ? [0, 1, 2, 3].map(n => rect.get(n).asNumber()) : [0, 0, 0, 0];
      // y cresce dal basso nel PDF: la giro, così "più piccolo" = "più in alto"
      const altezza = p.getSize().height;
      valori.push({ pagina: i + 1, alto: Math.round(altezza - r[3]), sin: Math.round(r[0]), testo: testo.trim() });
    }
  });

  // ordine di lettura: pagina, poi dall'alto, poi da sinistra. La tolleranza di
  // 8 punti tiene sulla stessa riga due valori affiancati (es. Data e Luogo di
  // nascita), che altrimenti si invertirebbero per una differenza di un pixel.
  valori.sort((a, b) => a.pagina - b.pagina
    || (Math.abs(a.alto - b.alto) > 8 ? a.alto - b.alto : a.sin - b.sin));

  return {
    tipo: tipoDalNome(nomeFile),
    compilato: valori.length > 0,
    valori: valori.map(v => v.testo),
    firme,
    firmaUltimaPagina,
    pagine: pagine.length,
  };
}

// ── Numeri di telefono ────────────────────────────────────────────────────
// Regola di Germano (07/08): nei numeri di telefono i punti non ci vanno, e dopo
// il prefisso ci va uno spazio. "347.1154399" → "347 1154399".
// I CELLULARI italiani hanno prefisso di 3 cifre e iniziano per 3: lì si sa dove
// spezzare. Sui FISSI il prefisso è lungo da 2 a 4 cifre (02, 06, 0721…) e non si
// può indovinare senza sbagliare: si tolgono solo i separatori e si lascia stare.
function normalizzaTelefono(v) {
  if (!v) return v;
  const originale = String(v).trim();
  const piu = originale.startsWith('+');
  const cifre = originale.replace(/[^\d]/g, '');
  if (!cifre) return originale;
  if (piu) return '+' + cifre;                       // internazionale: non si tocca
  if (/^3\d{8,9}$/.test(cifre)) return cifre.slice(0, 3) + ' ' + cifre.slice(3);
  return cifre;
}

// ── COME SI SCRIVONO I DATI (standard deciso l'08/08) ─────────────────────
// Germano: «bisogna creare uno standard di inserimento delle informazioni come
// fatto per i numeri di telefono; scegliamo un criterio e lo applichiamo a
// tutti». Vale sia per quello che arriva dai moduli sia per quello che il coach
// scrive a mano: altrimenti lo stesso dato si scrive in due modi a seconda di
// come è entrato.
//
// ⚠️ REGOLA DI PRUDENZA sulle maiuscole: si sistemano SOLO i testi arrivati
// tutti maiuscoli o tutti minuscoli. Un testo già scritto in modo sensato non si
// tocca — «Quartu Sant'Elena» e «San Donà di Piave» hanno maiuscole e minuscole
// che nessuna regola automatica indovina, e riscriverli significherebbe
// peggiorarli.
const PARTICELLE = new Set(['di','da','de','del','dello','della','dei','degli','delle',
                            'd','e','in','su','al','alla','ai','agli','a','il','lo','la','i','gli','le']);

function tuttoUgualeCaso(s) {
  const lettere = s.replace(/[^a-zà-ùA-ZÀ-Ù]/g, '');
  if (lettere.length < 3) return false;
  return lettere === lettere.toUpperCase() || lettere === lettere.toLowerCase();
}

function iniziali(v) {
  if (!v) return v;
  const s = String(v).trim().replace(/\s+/g, ' ');
  if (!tuttoUgualeCaso(s)) return s;         // già scritto bene: non si tocca
  return s.toLowerCase().split(' ').map((p, i) => {
    if (i > 0 && PARTICELLE.has(p.replace(/[.']/g, ''))) return p;
    // "sant'elena" → "Sant'Elena"; "10h" resta com'è
    return p.replace(/^([a-zà-ù])/, (m) => m.toUpperCase())
            .replace(/'([a-zà-ù])/, (m, c) => "'" + c.toUpperCase());
  }).join(' ');
}

// Indirizzo: tipo + nome + civico, senza virgola e senza "n." davanti al numero.
// "Degli Eroi, 8" e "Degli Eroi n.8" diventano tutt'e due "Degli Eroi 8".
function normalizzaVia(v) {
  if (!v) return v;
  let s = String(v).trim().replace(/\s+/g, ' ');
  s = s.replace(/,\s*(?=\d)/g, ' ');                 // via la virgola prima del civico
  s = s.replace(/\bn[.°]?\s*(?=\d)/gi, '');          // via "n." / "n°" / "n "
  s = s.replace(/\s+/g, ' ').trim();
  return iniziali(s);
}

function normalizzaEmail(v)     { return v ? String(v).trim().toLowerCase() : v; }
function normalizzaCodice(v)    { return v ? String(v).trim().toUpperCase().replace(/\s+/g, '') : v; }
function normalizzaProvincia(v) { return v ? String(v).trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) : v; }
function normalizzaCap(v)       { return v ? String(v).replace(/\D/g, '').slice(0, 5) : v; }

// Applica lo standard a un campo, in base a come si chiama.
function normalizzaCampo(nome, valore) {
  if (valore == null || String(valore).trim() === '') return valore;
  switch (nome) {
    case 'telefono':                              return normalizzaTelefono(valore);
    case 'email': case 'pec':                     return normalizzaEmail(valore);
    case 'codice_fiscale': case 'codice_sdi':     return normalizzaCodice(valore);
    case 'via':                                   return normalizzaVia(valore);
    case 'provincia':                             return normalizzaProvincia(valore);
    case 'cap':                                   return normalizzaCap(valore);
    case 'citta': case 'luogo_nascita':
    case 'nome': case 'cognome': case 'societa':
    case 'professione':                           return iniziali(valore);
    default:                                      return String(valore).trim();
  }
}

module.exports = {
  leggiModulo, normalizzaTelefono, tipoDalNome,
  normalizzaCampo, normalizzaVia, normalizzaEmail, normalizzaCodice, iniziali,
};
