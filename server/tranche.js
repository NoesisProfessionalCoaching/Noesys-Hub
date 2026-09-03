// ═══════════════════════════════════════════════════════════════════════════
// IL PIANO DI PAGAMENTO DEL COMMITTENTE — a tranche.
//
// Un committente non paga il totale in una volta: paga a rate legate a momenti
// del progetto. Ipotesi di Germano, confermata il 12/08/2026:
//   · 30% acconto     → alla firma
//   · 40%             → a metà percorso
//   · 30% saldo       → alla fine
// tutte **a 30 giorni**, e **tutto correggibile di volta in volta** — le
// percentuali non sono una regola, sono una proposta.
//
// ⭐ SI SALVANO GLI EURO, NON LE PERCENTUALI (regola del 27/07). La percentuale
// si ricava sempre da importo/totale, quindi salvarla vorrebbe dire tenere due
// numeri che possono litigare. In pagina la si può digitare lo stesso: è un modo
// di scrivere l'importo, non un dato.
//
// ⭐ CIFRE INTERE (regola del 27/07: «giusto per eliminare decimali e
// centesimi»). Il resto della divisione si carica sull'ULTIMA tranche, il saldo:
// è quella che si emette per ultima, quando ormai il conto deve tornare esatto.
//
// Modulo puro: niente database, niente rete. Si prova con dei numeri.
// ═══════════════════════════════════════════════════════════════════════════

// Anche `fiscale` è un modulo puro: si chiama solo per SCRIVERE i numeri allo
// stesso modo dappertutto (il punto delle migliaia, 17/08).
const fiscale = require('./fiscale');

// I tre momenti che fanno scattare una tranche. `data` dice da dove si prende
// il giorno di riferimento: sono tutti dati che stanno già sul progetto, tranne
// «metà percorso», che l'Hub non ha modo di dedurre e che scrive il coach.
const INNESCHI = {
  firma: { label: 'Alla firma',        campo: 'data_inizio' },
  meta:  { label: 'A metà percorso',   campo: 'data_meta'   },
  fine:  { label: 'Alla fine',         campo: 'data_fine'   },
};

// ⭐ Il piano è di CHI PAGA, non del committente. Un partecipante che paga la
// sua quota ne ha uno anche lui: una tranche sola, alla firma.
//
// 🔴 CORRETTO IL 30/08 — prima erano ZERO giorni, «rimessa diretta», da una
//    decisione di Germano del 10/08. Quel giorno lui l'ha cambiata: «la rimessa
//    diretta va sui clienti dei percorsi individuali; sui pacchetti e sui
//    percorsi strutturati vale la regola dei 30 giorni». Un partecipante a un
//    progetto sta nel secondo gruppo. ⚠️ La nota vecchia diceva il contrario ed
//    è stata riscritta: due fonti che si contraddicono ingannano fra sei mesi.
// Resta uno strumento solo: se un domani un partecipante dovesse pagare in due
// volte, si spezza la sua tranche come si fa con quelle del committente.
const PROPOSTE = {
  committente: [
    { etichetta: 'Acconto',       quota: 0.30, innesco: 'firma', giorni: 30 },
    { etichetta: 'Metà percorso', quota: 0.40, innesco: 'meta',  giorni: 30 },
    { etichetta: 'Saldo',         quota: 0.30, innesco: 'fine',  giorni: 30 },
  ],
  partecipante: [
    { etichetta: 'Quota',         quota: 1,    innesco: 'firma', giorni: 30 },
  ],
};

// Gli stati di una tranche. Sostituiscono l'interruttore «Incassato / Da
// incassare» che stava sull'intera quota: lo stato non è del pagatore, è di
// ogni singola rata.
// ⚠️ `chiesta` la metterà la proforma (fetta A2): qui la si sa già leggere, così
// quando arriverà non ci sarà niente da cambiare in questa parte.
const STATI = {
  da_chiedere: { label: 'Da chiedere', bg: '#f4f7fa', c: '#6B7280' },
  // 🔴 17/08 — STATO NUOVO, e non è un dettaglio. Germano, provando: «l'acconto
  // era segnato come richiesto, ma non c'è stato nessun passaggio di verifica e
  // invio mail… io non ho ricevuto la mail». Aveva ragione: fra «non chiesto» e
  // «chiesto» c'è un momento vero, in cui il documento esiste e non è partito.
  // Chiamarlo «chiesta» è una bugia — e la sua decisione del 15/08 era chiara:
  // «chiesta» si accende QUANDO PARTE LA MAIL.
  da_mandare:  { label: 'Da mandare',  bg: '#fff8dc', c: '#7a5c00' },
  chiesta:     { label: 'Chiesta',     bg: '#fdf6ec', c: '#b7791f' },
  incassata:   { label: 'Incassata',   bg: '#d1fae5', c: '#065f46' },
};

/**
 * Il piano che l'Hub PROPONE quando non ce n'è ancora uno.
 * @param {number} totale la quota di quel pagatore.
 * @param {'committente'|'partecipante'} [chi]
 * @returns {Array} [{ordine, etichetta, importo, innesco, giorni}]
 */
function pianoProposto(totale, chi) {
  const t = Math.round(Number(totale) || 0);
  const modello = PROPOSTE[chi] || PROPOSTE.committente;
  const righe = modello.map((r, i) => ({
    ordine: i, etichetta: r.etichetta, innesco: r.innesco, giorni: r.giorni,
    importo: Math.round(t * r.quota),
  }));
  // Il resto sull'ultima: 30+40+30 di 3.333 fa 1.000+1.333+1.000, e la somma
  // deve tornare 3.333 anche quando le percentuali non cadono tonde.
  const primi = righe.slice(0, -1).reduce((s, r) => s + r.importo, 0);
  righe[righe.length - 1].importo = t - primi;
  return righe;
}

// La percentuale non si salva: si mostra. Senza totale non vuol dire niente.
function percentuale(importo, totale) {
  const t = Number(totale) || 0;
  if (!t) return null;
  return (Number(importo) || 0) / t * 100;
}

/**
 * Cosa non torna in un piano. Vuoto = si può salvare.
 * ⚠️ La somma DEVE fare la quota del committente: un piano che chiede più o
 * meno del concordato produrrebbe proforma sbagliate, una per una, senza che
 * nessun singolo documento sembri storto.
 */
function problemi(righe, totale) {
  const out = [];
  const t = Math.round(Number(totale) || 0);
  if (!righe || !righe.length) return ['Il piano non ha nessuna tranche.'];
  const somma = righe.reduce((s, r) => s + Math.round(Number(r.importo) || 0), 0);
  if (somma !== t) {
    out.push('Le tranche sommano € ' + fiscale.euroIntero(somma)
      + ' invece di € ' + fiscale.euroIntero(t) + '.');
  }
  if (righe.some(r => Math.round(Number(r.importo) || 0) <= 0)) {
    out.push('C’è una tranche a zero: toglila, o dalle un importo.');
  }
  if (righe.some(r => !INNESCHI[r.innesco])) {
    out.push('Una tranche non dice quando va chiesta.');
  }
  if (righe.some(r => !(Number(r.giorni) >= 0))) {
    out.push('I giorni di scadenza non sono un numero.');
  }
  return out;
}

/**
 * La data entro cui una tranche va pagata: il giorno del suo innesco + i giorni
 * concordati. Torna null quando quel giorno non si sa ancora — ed è
 * un'informazione, non un errore: è il caso di «metà percorso» prima che il
 * coach abbia scritto la data.
 */
function scadenza(tr, progetto) {
  const inn = INNESCHI[tr.innesco];
  if (!inn) return null;
  const base = progetto && progetto[inn.campo];
  if (!base) return null;
  const d = new Date(String(base).slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (Number(tr.giorni) || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * I QUATTRO NUMERI in cima all'Amministrazione del progetto (scelta di Germano,
 * 12/08). Non più «Incassato / Da incassare», che con le rate non voleva più
 * dire niente: **«chiesto ma non ancora pagato» è lo stato in cui si vive per
 * settimane**, e senza una casella sua sparirebbe dentro «da incassare».
 *
 * ⚠️ `concordato` NON si somma dalle tranche: è la quota totale del progetto.
 * Se le tranche non arrivano a coprirla, è un'informazione — vuol dire che un
 * pagatore non ha ancora un piano — e va vista, non nascosta.
 */
function totali(tranche, quotaTotale, documenti) {
  const somma = st => (tranche || [])
    .filter(t => statoDi(t, documenti) === st)
    .reduce((s, t) => s + (Number(t.importo) || 0), 0);
  return {
    concordato: Math.round(Number(quotaTotale) || 0),
    // ⚠️ «Da mandare» sta dentro DA CHIEDERE, e non è una scorciatoia: quei soldi
    // a chi paga non li ha ancora chiesti nessuno. Metterli sotto «Chiesto»
    // sarebbe la stessa bugia dell'etichetta. I quattro numeri restano quattro
    // (scelta di Germano del 12/08): è la RIGA a dire che manca un invio.
    daChiedere: somma('da_chiedere') + somma('da_mandare'),
    chiesto:    somma('chiesta'),
    incassato:  somma('incassata'),
  };
}

/**
 * ⭐ FETTA C3 (17/08/2026) — «CHIESTA» NON SI SPUNTA, SI RICAVA.
 * Una rata è chiesta perché **sta dentro una proforma viva**, non perché
 * qualcuno ha premuto un pulsante. `chieste` è l'insieme degli id che ci stanno
 * dentro; se non arriva, si ripiega sulla colonna `stato` (è così che si
 * comporta finché una pagina non ha ancora imparato a chiederlo).
 *
 * ⚠️ L'ordine conta: **incassata vince su chiesta.** Una rata incassata sta
 * ancora dentro la sua proforma, e senza questa precedenza tornerebbe indietro
 * di uno stato appena registrato l'incasso.
 * ⭐ Il regalo: annullare una proforma rimette la rata fra quelle da chiedere
 * **da sé**, senza una riga di codice in più — esattamente come per le sessioni.
 */
function statoDi(t, documenti) {
  const salvato = (t && t.stato) || 'da_chiedere';
  // `documenti`: mappa id della rata → il documento che la contiene. Le annullate
  // non ci sono. Il valore può avere due forme, e le accetta tutte e due:
  //   · una STRINGA con lo stato del documento ('emessa' = creata e ferma ·
  //     'inviata' = partita) — com'era fino alla fetta C3;
  //   · un OGGETTO {stato, saldata, ...} — dalla fetta C4, che porta anche
  //     l'incasso. Così le pagine si sono spostate una per volta, senza che una
  //     rimasta indietro smettesse di funzionare.
  const grezzo = documenti && t && documenti.get ? documenti.get(t.id) : null;
  const doc = typeof grezzo === 'string' ? { stato: grezzo } : grezzo;
  // ⭐ C4 — «INCASSATA» SI RICAVA, come «chiesta»: la rata è incassata perché il
  // documento che la contiene è stato saldato. Nessuna casella da spuntare, e
  // togliendo un incasso sbagliato la rata torna indietro da sé.
  if (doc && doc.saldata) return 'incassata';
  // ⚠️ La colonna `stato` scritta a mano resta valida solo all'indietro: fino a
  // C3 l'incasso si segnava lì col pulsante-ponte. Non la scrive più nessuno,
  // ma chi ci si era già segnato incassato non deve tornare indietro.
  if (salvato === 'incassata') return 'incassata';
  if (doc && doc.stato === 'inviata') return 'chiesta';
  if (doc) return 'da_mandare';
  return salvato === 'chiesta' ? 'da_chiedere' : salvato;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ FETTA 0.1 DEL RIORDINO (03/09/2026) — LE RATE DENTRO UN DOCUMENTO NON SI TOCCANO.
//
// La ricognizione indipendente (B1) ha trovato il difetto più caro dell'Hub:
// salvare il piano cancellava TUTTE le rate e le riscriveva da zero. Se una rata
// stava già dentro una proforma, spariva: il documento restava ma non sapeva più
// a cosa si riferiva, il controllo «già chiesta» non la trovava più e la stessa
// rata si poteva chiedere due volte. Tutto in silenzio.
//
// La regola, in un posto solo, per le tre rotte del piano (progetto, pacchetto,
// partecipante): una rata che sta in un documento vivo — o che risulta incassata
// — è FERMA. Deve arrivare dalla finestrella identica a com'è salvata (stesso
// id, stesso importo, stessa etichetta, stesso innesco, stessi giorni), altrimenti
// il salvataggio si rifiuta e si dice quale rata e quale proforma. Le altre rate
// sono libere: si riscrivono come prima, purché il totale torni.
//
// ⚠️ Perché TUTTO congelato e non solo l'importo: la proforma porta scritti
// l'etichetta e la percentuale, e la scadenza si congela nel documento al momento
// in cui nasce (innesco + giorni). Cambiare uno di quei campi sulla rata farebbe
// dire alla scheda una cosa e al documento un'altra. L'ordine invece non sta nel
// documento, e si può cambiare.
//
// ⛔ Perché NON «annulla la proforma e rifai»: Germano, 03/09 sera — l'annullamento
// è un comando solo interno, il cliente che ha ricevuto il documento non ne sa
// niente, e su un'annullata l'Hub rifiuta gli incassi. Regge solo finché il
// documento non è partito. Una rata incassata poi non si «disfa» in nessun modo.
// ═══════════════════════════════════════════════════════════════════════════

/** Una rata è ferma se sta in un documento vivo o risulta incassata. */
function bloccata(t, documenti) {
  return statoDi(t, documenti) !== 'da_chiedere';
}

const pulita = (s) => String(s == null ? '' : s).trim();
const intero = (n) => Math.round(Number(n) || 0);

/**
 * Confronta le rate salvate con quelle che arrivano dalla finestrella.
 * @param {Array}  salvate    le rate come stanno nel database
 * @param {Map}    documenti  rata → documento vivo (la mappa di `incassi.mappaRate`)
 * @param {Array}  righe      le righe in arrivo; una riga ferma porta il suo `id`
 * @returns {{problemi: string[], ferme: Array, libere: Array}}
 *   `problemi` vuoto = si può salvare. `ferme` = le rate da NON toccare
 *   (al massimo si aggiorna l'ordine). `libere` = le righe da riscrivere.
 */
function riconcilia({ salvate, documenti, righe }) {
  const ferme = (salvate || []).filter(t => bloccata(t, documenti));
  const idsFermi = new Set(ferme.map(t => String(t.id)));
  const arrivate = new Map((righe || []).filter(r => r && r.id).map(r => [String(r.id), r]));
  const problemi = [];
  for (const t of ferme) {
    const doc = documenti && documenti.get ? documenti.get(t.id) : null;
    const chi = `La rata «${pulita(t.etichetta)}» (€ ${fiscale.euroIntero(t.importo)}) `
      + (doc && doc.numero ? `sta nella proforma n. ${doc.numero}` : 'risulta incassata');
    const r = arrivate.get(String(t.id));
    if (!r) { problemi.push(chi + ': non si può togliere dal piano.'); continue; }
    const diversa = intero(r.importo) !== intero(t.importo)
      || pulita(r.etichetta) !== pulita(t.etichetta)
      || pulita(r.innesco) !== pulita(t.innesco)
      || intero(r.giorni) !== intero(t.giorni);
    if (diversa) problemi.push(chi + ': non si può modificare. Cambia le altre rate.');
  }
  // Libera = non è una rata ferma. Un id di una rata libera non la protegge: si
  // riscrive come prima. Un id sconosciuto è solo una riga nuova.
  const libere = (righe || []).filter(r => !(r && r.id && idsFermi.has(String(r.id))));
  return { problemi, ferme, libere };
}

module.exports = { INNESCHI, STATI, pianoProposto, percentuale, problemi, scadenza, totali, statoDi, bloccata, riconcilia };
