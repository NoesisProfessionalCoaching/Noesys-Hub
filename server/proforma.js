// ═══════════════════════════════════════════════════════════════════════════
// LA PROFORMA — comporre il documento, e stamparlo.
//
// La proforma NON ha valore fiscale: è l'unico documento di soldi che l'Hub può
// produrre. Le fatture vere le emette Germano a mano in SuperBill. Questa serve
// a una cosa sola: dire al cliente quanto deve pagare e dove.
//
// Il file è in due metà nette:
//   1. COMPORRE — funzioni pure: entrano le sedute e i due soggetti, escono le
//      righe e i conti. Nessun database, nessuna rete: si prova con dei numeri
//      finti (scripts/prova-proforma.js).
//   2. STAMPARE — il PDF, costruito da zero con pdf-lib.
//
// ⚠️ Chi stampa NON ricalcola niente: prende gli importi già congelati nella
// proforma. Un documento già spedito deve poter essere ristampato identico anche
// fra due anni, quando il prezzo di quel percorso sarà cambiato tre volte.
// ═══════════════════════════════════════════════════════════════════════════

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fiscale = require('./fiscale');
const drive = require('./google-drive');

// ───────────────────────────────────────────────────────────────────────────
// 1. COMPORRE
// ───────────────────────────────────────────────────────────────────────────

function numeroProforma(anno, progressivo) {
  return anno + '/' + String(progressivo).padStart(3, '0');
}

/**
 * Da un elenco di sedute alle righe del documento, una per sessione.
 *
 * ⭐ L'INTAKE VALE DUE SESSIONI (Germano, 10/08): dura il doppio e si paga il
 * doppio. Sul documento non si scrive «vale doppio» — che è gergo nostro: si
 * scrive quantità 2, e il conto si spiega da solo a chi legge.
 *
 * Vale solo col pagamento a sessione (Standard). In un Pacchetto il prezzo è già
 * un totale e non si moltiplica niente.
 */
function righeDaSedute(sedute) {
  return (sedute || [])
    .filter(s => s.data)
    .slice()
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .map((s, i) => {
      const quantita = s.tipo === 'Intake' ? 2 : 1;
      const prezzo = fiscale.arrotonda(s.prezzo);
      return {
        seduta_id: s.id,
        percorso_id: s.percorso_id,
        data: String(s.data).slice(0, 10),
        descrizione: 'Sessione di coaching' + (s.tipo ? ' (' + s.tipo + ')' : ''),
        quantita,
        prezzo_unitario: prezzo,
        importo: fiscale.arrotonda(prezzo * quantita),
        ordine: i,
      };
    });
}

// Le fotografie di chi manda e di chi riceve. Si congelano dentro il documento
// perché un indirizzo che cambia non deve riscrivere una proforma già spedita.
function fotoEmittente(e) {
  e = e || {};
  return {
    denominazione: (e.denominazione || '').trim()
      || [e.nome, e.cognome].filter(Boolean).join(' ').trim(),
    via: e.via || '', cap: e.cap || '', citta: e.citta || '',
    provincia: e.provincia || '', paese: e.paese || 'IT',
    partita_iva: e.partita_iva || '', codice_fiscale: e.codice_fiscale || '',
    iban: e.iban || '', banca: e.banca || '', intestatario: e.intestatario || '',
    email: e.email || '', telefono: e.telefono || '',
  };
}

function fotoDestinatario(c) {
  const s = fiscale.daCliente(c || {});
  return {
    denominazione: s.denominazione, via: s.via || '', cap: s.cap || '',
    citta: s.citta || '', provincia: s.provincia || '', paese: s.paese || 'IT',
    codice_fiscale: s.codice_fiscale || '', partita_iva: s.partita_iva || '',
    email: (c && c.email) || '',
  };
}

/**
 * Le ragioni per cui questa proforma NON si può emettere, scritte per esteso.
 *
 * Torna un elenco vuoto quando si può procedere. Non è un dettaglio di comodo:
 * l'Hub non deve MAI fermarsi in silenzio lasciando chi lo usa a chiedersi
 * perché non succede niente — ogni blocco dice cosa manca e dove si sistema.
 */
function motiviCheImpediscono({ emittente, cliente, righe }) {
  const motivi = [];
  const em = fiscale.datiMancantiEmittente(emittente);
  if (!em.pronto) {
    motivi.push('Mancano i tuoi dati: ' + em.mancanti.join(', ')
      + ' — si scrivono in Amministrazione, «Chi emette».');
  }
  const st = fiscale.statoFatturabilita(fiscale.daCliente(cliente || {}));
  if (st.stato !== 'pronto') {
    motivi.push('I dati del cliente non bastano per fatturargli. ' + st.messaggio + '.');
  }
  if (!righe || !righe.length) {
    motivi.push('Non c’è nessuna sessione da chiedere: sono già state chieste tutte.');
  }
  return motivi;
}

/**
 * Il documento completo, pronto da salvare. Numero e id NON li mette questa
 * funzione: il numero lo assegna il database, che è l'unico a sapere qual è il
 * prossimo ed è l'unico posto dove due richieste insieme non possono prenderne
 * uno uguale.
 */
function componiProforma({ righe, cliente, emittente, dataEmissione }) {
  const categoria = fiscale.categoriaFiscale(fiscale.daCliente(cliente || {}));
  const imponibile = fiscale.arrotonda(
    (righe || []).reduce((s, r) => s + Number(r.importo || 0), 0));
  const conti = fiscale.calcolaDocumento({ categoria, imponibile });
  const date = (righe || []).map(r => r.data).filter(Boolean).sort();
  return {
    dataEmissione,
    categoria,
    conti,                                   // null se la categoria non è decidibile
    periodoDa: date[0] || null,
    periodoA: date[date.length - 1] || null,
    emittenteDati: fotoEmittente(emittente),
    destinatarioDati: fotoDestinatario(cliente),
    righe: righe || [],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 2. STAMPARE
//
// Il contenuto è disegnato da zero, ma NON la carta: intestazione e piede sono
// ritagliati dal modello vero su Drive (vedi «LA CARTA INTESTATA» più sotto), così
// la proforma arriva al cliente sulla stessa carta della lettera di benvenuto.
// Caratteri di serie di pdf-lib (Helvetica), perché l'unico font in casa — EB
// Garamond — non ha il grassetto, e qui i numeri da leggere devono staccare.
// ───────────────────────────────────────────────────────────────────────────

const A4 = { w: 595.28, h: 841.89 };
const M = 56;                                   // margine
const NAVY  = rgb(0.133, 0.231, 0.431);         // #223B6E
const INK   = rgb(0.29, 0.29, 0.29);            // #4A4A4A
const MUTED = rgb(0.55, 0.57, 0.60);
const LINEA = rgb(0.88, 0.90, 0.93);
const ORO   = rgb(0.847, 0.682, 0.180);         // #D8AE2E

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function dataIt(iso) {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return `${Number(g)} ${MESI[Number(m) - 1]} ${a}`;
}
function dataBreve(iso) {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return `${g}/${m}/${a}`;
}
const eur = v => '€ ' + fiscale.euro(v);

// I caratteri di serie di pdf-lib scrivono in WinAnsi, che copre l'italiano ma
// non tutto: un carattere fuori tabella non fa una brutta figura, fa FALLIRE la
// generazione del PDF. È già successo col meno tipografico «−».
// Non è pignoleria: il nome di un cliente straniero, un carattere incollato da
// un'altra applicazione, e la proforma non esce più — proprio mentre serve.
// Qui i pochi segni che usiamo si traducono, e tutto il resto si scarta.
const TRADUZIONI = { '−': '-', '‑': '-', ' ': ' ', ' ': ' ', '⭐': '', '⚠': '' };
// Oltre a Latin-1 (32..255), WinAnsi ha questi segni sparsi: virgolette curve,
// trattini lunghi, euro, puntini di sospensione.
const WINANSI_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
  0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D,
  0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);

function sicuro(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const t = TRADUZIONI[ch];
    if (t !== undefined) { out += t; continue; }
    const c = ch.codePointAt(0);
    if ((c >= 32 && c <= 255) || WINANSI_EXTRA.has(c)) out += ch;
  }
  return out;
}

// ── LA CARTA INTESTATA ────────────────────────────────────────────────────
// L'intestazione e il piede NON si ridisegnano: si prende la CARTA VERA da
// Drive e ci si scrive sopra, come già si fa per la lettera di benvenuto e per
// l'agenda. Così la proforma arriva al cliente sulla stessa carta di tutto il
// resto, e il giorno che il marchio cambierà cambierà anche qui, da sola,
// senza che nessuno tocchi il codice.
//
// «Carta Intestata OK.pdf» è una pagina A4 con solo il logo in alto e i recapiti
// in fondo: si appoggia intera come sfondo. Le due quote qui sotto dicono solo
// dove comincia e dove finisce lo spazio scrivibile.
const MODELLO_CARTA = 'Carta Intestata OK.pdf';
const Y_INIZIO = 700;          // prima riga scrivibile, sotto la riga grigia
const Y_PIEDE  = 100;          // sotto qui si entra nella zona dei recapiti

async function caricaCartaIntestata() {
  const modelli = await drive.findModelliFolder();
  if (!modelli) throw new Error('Cartella "Modelli" non trovata su Drive');
  const src = await drive.findFileByName(modelli.id, MODELLO_CARTA);
  if (!src) throw new Error('Modello non trovato in Modelli: ' + MODELLO_CARTA);
  return drive.downloadFileBuffer(src.id);
}

/**
 * Il PDF della proforma.
 * @param {object} p documento già salvato: numero, date, importi, le due
 *        fotografie e le righe. Qui NON si ricalcola niente.
 * @param {Buffer} [cartaBytes] la carta intestata già in mano (la passa lo
 *        script di prova, per non dipendere da Drive); se manca, si scarica.
 * @returns {Promise<Buffer>}
 */
async function generaPdf(p, cartaBytes) {
  const carta = await PDFDocument.load(cartaBytes || await caricaCartaIntestata());
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // La carta si appoggia intera, per prima: tutto quello che viene dopo ci
  // finisce sopra.
  const sfondo = await pdf.embedPage(carta.getPages()[0]);
  const page = pdf.addPage([A4.w, A4.h]);
  page.drawPage(sfondo, { x: 0, y: 0 });

  const em = p.emittente_dati || {};
  const de = p.destinatario_dati || {};
  // La dicitura obbligatoria (oggi solo per l'estero) non è una colonna: viene
  // dalla categoria congelata nel documento, che è la stessa cosa e non può
  // finire in disaccordo con i conti.
  const dicitura = (fiscale.TRATTAMENTI[p.categoria_fiscale] || {}).dicitura || null;

  const testo = (t, x, y, { size = 9.5, f = font, color = INK, max } = {}) => {
    let s = sicuro(t);
    if (max) while (s && f.widthOfTextAtSize(s, size) > max) s = s.slice(0, -1);
    page.drawText(s, { x, y, size, font: f, color });
  };
  const destra = (t, xFine, y, o = {}) => {
    const f = o.f || font, size = o.size || 9.5;
    testo(t, xFine - f.widthOfTextAtSize(sicuro(t), size), y, o);
  };
  const riga = (y, x1 = M, x2 = A4.w - M, color = LINEA) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.7, color });

  // ── Sotto la carta intestata: che documento è, e chi lo manda ─────────────
  // Il marchio ce l'ha già la carta: qui basta dire come ti chiami ai fini
  // fiscali, con partita IVA e indirizzo — che nel piede della carta non ci sono.
  let y = Y_INIZIO;
  destra('PROFORMA', A4.w - M, y, { size: 17, f: bold, color: NAVY });
  destra('n. ' + (p.numero || ''), A4.w - M, y - 18, { size: 11, f: bold });
  destra(dataIt(p.data_emissione), A4.w - M, y - 32, { size: 9.5, color: MUTED });

  testo(em.denominazione, M, y, { size: 11.5, f: bold, color: NAVY });
  y -= 16;
  const emRighe = [
    [em.via, [em.cap, em.citta, em.provincia && '(' + em.provincia + ')']
      .filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    em.partita_iva ? 'Partita IVA ' + em.partita_iva : '',
    em.codice_fiscale ? 'Codice fiscale ' + em.codice_fiscale : '',
    // Email e telefono NON si ripetono qui: stanno già nel piede della carta.
  ].filter(Boolean);
  for (const r of emRighe) { testo(r, M, y, { size: 9, color: MUTED }); y -= 12; }

  // ── Destinatario ─────────────────────────────────────────────────────────
  y -= 24;
  riga(y + 14);
  testo('DESTINATARIO', M, y, { size: 8, f: bold, color: MUTED });
  y -= 16;
  testo(de.denominazione, M, y, { size: 12, f: bold, color: NAVY });
  y -= 14;
  const deRighe = [
    [de.via, [de.cap, de.citta, de.provincia && '(' + de.provincia + ')']
      .filter(Boolean).join(' ')].filter(Boolean).join(' — '),
    de.partita_iva ? 'Partita IVA ' + de.partita_iva : '',
    de.codice_fiscale ? 'Codice fiscale ' + de.codice_fiscale : '',
  ].filter(Boolean);
  for (const r of deRighe) { testo(r, M, y, { size: 9, color: INK }); y -= 12; }

  // ── Il periodo: per cosa ti sto chiedendo dei soldi ───────────────────────
  y -= 16;
  if (p.periodo_da) {
    const stesso = p.periodo_da === p.periodo_a;
    testo(stesso
      ? 'Prestazioni del ' + dataIt(p.periodo_da)
      : 'Prestazioni dal ' + dataIt(p.periodo_da) + ' al ' + dataIt(p.periodo_a),
      M, y, { size: 9.5, color: MUTED });
    y -= 18;
  }

  // ── Le righe: una per sessione ───────────────────────────────────────────
  const COL = { data: M, desc: M + 68, qta: 380, prezzo: 452, imp: A4.w - M };
  riga(y + 12);
  testo('DATA', COL.data, y, { size: 8, f: bold, color: MUTED });
  testo('DESCRIZIONE', COL.desc, y, { size: 8, f: bold, color: MUTED });
  destra('Q.TÀ', COL.qta, y, { size: 8, f: bold, color: MUTED });
  destra('PREZZO', COL.prezzo, y, { size: 8, f: bold, color: MUTED });
  destra('IMPORTO', COL.imp, y, { size: 8, f: bold, color: MUTED });
  y -= 8;
  riga(y);
  y -= 15;

  for (const r of (p.righe || [])) {
    testo(dataBreve(r.data), COL.data, y, { size: 9 });
    testo(r.descrizione, COL.desc, y, { size: 9, max: COL.qta - COL.desc - 24 });
    destra(Number(r.quantita) === Math.round(Number(r.quantita))
      ? String(Number(r.quantita)) : fiscale.euro(r.quantita), COL.qta, y, { size: 9 });
    destra(eur(r.prezzo_unitario), COL.prezzo, y, { size: 9 });
    destra(eur(r.importo), COL.imp, y, { size: 9 });
    y -= 15;
  }

  // ── I passaggi del conto, uno per riga ───────────────────────────────────
  // ⭐ Le righe arrivano da fiscale.passaggiDocumento(): sono le STESSE che vede
  // la schermata. Richiesta di Germano: tutti i passaggi devono essere visibili,
  // e devono essere gli stessi in tutti e due i posti.
  y -= 6;
  riga(y + 8, COL.desc);
  y -= 8;
  const passaggi = fiscale.passaggiDocumento({
    imponibile: Number(p.imponibile), iva: Number(p.iva), ritenuta: Number(p.ritenuta),
    bollo: Number(p.bollo), totaleDocumento: Number(p.totale_documento),
    daPagare: Number(p.da_pagare), dicitura,
  });
  passaggi.forEach((t, i) => {
    // L'ultima riga è quella che il cliente deve leggere: si stacca con un filo
    // d'oro SOPRA di sé, non sotto — una linea sotto taglia le lettere basse.
    if (i === passaggi.length - 1) {
      y -= 7;
      page.drawLine({ start: { x: COL.desc, y: y + 13 }, end: { x: COL.imp, y: y + 13 },
        thickness: 1.4, color: ORO });
      y -= 5;
    }
    const f = t.forte ? bold : font, size = t.forte ? 10.5 : 9.5;
    const col = t.forte ? NAVY : INK;
    destra(t.etichetta, COL.prezzo, y, { size, f, color: col });
    destra((t.segno === '−' ? '− ' : '') + eur(t.importo), COL.imp, y, { size, f, color: col });
    y -= 13;
    if (t.nota) { destra(t.nota, COL.prezzo, y + 1, { size: 7.5, color: MUTED }); y -= 13; }
  });

  // ── Dove si paga ─────────────────────────────────────────────────────────
  y -= 30;
  testo('DOVE PAGARE', M, y, { size: 8, f: bold, color: MUTED });
  y -= 15;
  testo('IBAN  ' + (em.iban || ''), M, y, { size: 10.5, f: bold, color: NAVY });
  y -= 13;
  const conto = [em.intestatario && 'Intestato a ' + em.intestatario, em.banca]
    .filter(Boolean).join('  ·  ');
  if (conto) { testo(conto, M, y, { size: 9, color: MUTED }); y -= 13; }

  // ── In fondo: che cos'è questo foglio ────────────────────────────────────
  // Scritto in chiaro e non in caratteri minuscoli: una proforma scambiata per
  // una fattura è un guaio per chi la riceve, non solo per chi la manda.
  const yPie = Y_PIEDE + 8;
  riga(yPie + 26);
  testo('Questo documento non è una fattura e non ha valore fiscale.',
    M, yPie + 12, { size: 8.5, f: bold, color: INK });
  testo('La fattura viene emessa dopo il pagamento, come previsto per le prestazioni di servizi.',
    M, yPie, { size: 8.5, color: MUTED });
  if (dicitura) testo(dicitura, M, yPie - 12, { size: 8.5, color: MUTED });

  return Buffer.from(await pdf.save());
}

// ───────────────────────────────────────────────────────────────────────────
// 3. MANDARE — il testo della mail e l'archivio su Drive
// ───────────────────────────────────────────────────────────────────────────

/**
 * Oggetto e testo della mail di accompagnamento, già compilati.
 *
 * Sta qui e non nella pagina perché è la stessa cosa in due posti: la
 * finestrella lo mostra da modificare, e chi lo legge deve poterlo ritrovare
 * uguale. Il coach può cambiarlo prima di mandare: quello che parte è sempre il
 * testo che ha davanti, non questo.
 *
 * Il registro è quello di Mail 1 e Mail 2 (si dà del tu), con il saluto scelto
 * da Germano il 12/08. ⚠️ La riga sulla legge è stata voluta da lui («inserirei
 * la spiegazione della procedura»): l'art. 6 comma 3 del DPR 633/1972 dice che
 * per le prestazioni di servizi l'operazione si considera effettuata al
 * pagamento del corrispettivo — ed è il motivo per cui la fattura viene DOPO.
 * Da far confermare al commercialista prima del primo cliente vero.
 */
function testoMail(p) {
  const de = p.destinatario_dati || {};
  const nome = String(de.denominazione || '').trim().split(/\s+/)[0] || '';
  const numero = p.numero || '';
  const importo = '€ ' + fiscale.euro(p.da_pagare);

  // «di luglio 2026» quando le sessioni stanno tutte nello stesso mese, il
  // periodo per esteso quando sono a cavallo: dirlo sbagliato è peggio che non
  // dirlo, perché è la riga che il cliente controlla.
  let periodo = '';
  if (p.periodo_da) {
    const [a1, m1] = String(p.periodo_da).slice(0, 7).split('-');
    const [a2, m2] = String(p.periodo_a || p.periodo_da).slice(0, 7).split('-');
    periodo = (a1 === a2 && m1 === m2)
      ? ' di ' + MESI[Number(m1) - 1] + ' ' + a1
      : ' dal ' + dataBreve(p.periodo_da) + ' al ' + dataBreve(p.periodo_a);
  }

  return {
    subject: 'Proforma n. ' + numero + ' — Noesys Professional Coaching',
    body:
`Ciao ${nome},

in allegato la proforma n. ${numero} per le sessioni di coaching${periodo}.
L'importo da bonificare è di ${importo}; l'IBAN è indicato nel documento.

A pagamento ricevuto ti invierò la fattura: per le prestazioni di servizi la fattura si emette al momento in cui viene pagato il corrispettivo (art. 6, comma 3, del DPR 633/1972). La proforma serve a questo, e non ha valore fiscale.

Ti ringrazio e ti saluto cordialmente,
Germano Guerriero — Noesys Professional Coaching`,
  };
}

/**
 * La copia su Drive, in `Noesys/Amministrazione/Proforma/{anno}/`.
 *
 * ⭐ Archivio UNICO, non una cartella per cliente (decisione di Germano, 12/08):
 * si cerca in un posto solo, a fine anno è la cartella da dare al commercialista,
 * e per i committenti — che una cartella propria non ce l'hanno — non ci sarà
 * niente da inventare.
 *
 * ⚠️ La copia NON è l'originale: l'originale sono i dati congelati nell'Hub, da
 * cui il PDF si rifà identico. Se questa fallisce, il documento è comunque a
 * posto — ed è il motivo per cui chi manda la mail non deve fermarsi qui.
 *
 * ⚠️ `uploadFileToFolder` è idempotente sul NOME e non sovrascrive. Qui è un
 * bene: il nome contiene il numero della proforma, che non si riusa mai, quindi
 * rimandare lo stesso documento non produce doppioni.
 */
async function archiviaSuDrive(p, bytes) {
  const root = await drive.findNoesysRoot();
  if (!root) throw new Error('Cartella "Noesys" non trovata su Drive');
  const amm  = await drive.findOrCreateFolder(root.id, 'Amministrazione');
  const prof = await drive.findOrCreateFolder(amm.id, 'Proforma');
  const anno = await drive.findOrCreateFolder(prof.id, String(p.anno || new Date(p.data_emissione).getFullYear()));
  const su = await drive.uploadFileToFolder(nomeFile(p), 'application/pdf', bytes, anno.id);
  return { id: su.id, url: 'https://drive.google.com/file/d/' + su.id + '/view', giaCera: !!su.skipped };
}

function nomeFile(p) {
  const numero = String(p.numero || '').replace('/', '-');   // «/» è vietato nei nomi
  const chi = String((p.destinatario_dati || {}).denominazione || '').trim();
  return [('Proforma ' + numero).trim(), chi].filter(Boolean).join(' - ') + '.pdf';
}

module.exports = {
  numeroProforma, righeDaSedute, componiProforma, motiviCheImpediscono,
  fotoEmittente, fotoDestinatario,
  generaPdf, nomeFile, testoMail, archiviaSuDrive,
};
