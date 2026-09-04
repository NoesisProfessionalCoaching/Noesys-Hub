// ═══════════════════════════════════════════════════════════════════════════
// FISCALE — il cervello della fatturazione. MODULO PURO.
//
// Qui dentro non si entra nel database, non si scrive HTML, non si chiama la rete.
// Entrano dei dati, esce una risposta, sempre la stessa a parità di dati. È così
// apposta: questa è la parte che non può sbagliare, e una cosa che non tocca niente
// si può provare da sola, mille volte, in un secondo (scripts/prova-fiscale.js).
//
// In Fase 1 fa due cose:
//   1. dice a che CATEGORIA FISCALE appartiene un soggetto (chi si fattura);
//   2. dice se i suoi dati bastano per fatturargli, e se no cosa manca.
//
// In Fase 5 qui accanto arriveranno i conti (imponibile → IVA → ritenuta → bollo).
// Riferimento: SPEC_report_mensile_fatture.md §3.4 e §3.6.
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// LE QUATTRO CATEGORIE
//
// ⚠️ Il discriminante è il REGIME FISCALE, non la forma giuridica (spec §3.4).
// Un libero professionista persona fisica con partita IVA in regime ordinario è
// sostituto d'imposta e opera la ritenuta esattamente come una S.r.l. Per questo
// la categoria si chiama `sostituto_it` e non `societa_it`. La natura giuridica
// (persona fisica / persona giuridica) NON entra in questo calcolo: sta in
// anagrafica perché serve a compilare la fattura, non a decidere le imposte.
// ───────────────────────────────────────────────────────────────────────────
const CATEGORIE = {
  privato_it:      'Privato italiano',
  sostituto_it:    'Sostituto d’imposta italiano',
  forfettario_it:  'Forfettario italiano',
  estero_extra_ue: 'Estero (extra UE)',
};

function pulito(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
}

/**
 * A che categoria fiscale appartiene un soggetto.
 * @param {object} s soggetto normalizzato (vedi daCliente / daCommittente)
 * @returns {string|null} una chiave di CATEGORIE, oppure null se i dati non
 *          bastano per deciderlo (caso tipico: ha la partita IVA ma non si sa
 *          in che regime). null NON è un errore: è "non lo so ancora", e chi
 *          chiama deve trattarlo come un dato mancante, mai come un privato.
 */
function categoriaFiscale(s) {
  const paese = (pulito(s.paese) || 'IT').toUpperCase();
  if (paese !== 'IT') return 'estero_extra_ue';
  if (!pulito(s.partita_iva)) {
    // ⚠️ Correzione dell'11/08 (segnalata da Germano su Flamingo Beauty).
    // «Nessuna partita IVA» vuol dire due cose diverse a seconda di chi hai
    // davanti. Per una PERSONA è un'informazione: non ce l'ha, è un privato.
    // Per una SOCIETÀ è impossibile — una persona giuridica la partita IVA ce
    // l'ha sempre — quindi vuol dire solo che nessuno l'ha ancora scritta.
    // Trattarla da privato la mandava nella categoria sbagliata, e l'Hub le
    // chiedeva il codice fiscale invece della partita IVA.
    // La spec (§3.4) non copre il caso: dà `ha_partita_iva` per già saputo.
    if (pulito(s.natura_giuridica) === 'persona_giuridica') return null;
    return 'privato_it';
  }
  const regime = pulito(s.regime).toLowerCase();
  if (regime === 'forfettario') return 'forfettario_it';
  if (regime === 'ordinario')   return 'sostituto_it';
  return null; // ha la partita IVA ma il regime non è stato indicato
}

// ───────────────────────────────────────────────────────────────────────────
// COSA MANCA PER POTER FATTURARE (spec §3.6)
//
// Le etichette sono quelle che legge il coach nella scheda, non i nomi delle
// colonne: chi guarda deve capire cosa andare a scrivere, non dove sta nel
// database.
// ───────────────────────────────────────────────────────────────────────────
function datiMancanti(s) {
  const manca = [];
  const cat = categoriaFiscale(s);

  // Sempre, qualunque sia la categoria: a chi si intesta e dove sta.
  if (!pulito(s.denominazione)) manca.push('nome e cognome');
  if (!pulito(s.via))           manca.push('indirizzo');
  if (!pulito(s.cap))           manca.push('CAP');
  if (!pulito(s.citta))         manca.push('città');
  if (!pulito(s.provincia))     manca.push('provincia');
  if (!pulito(s.paese))         manca.push('paese');

  if (cat === null) {
    // Non si riesce a dire che categoria è. Due cause possibili, e si elencano
    // tutte e due insieme: chi va a correggere apre la scheda una volta sola.
    //   · società senza partita IVA → manca la partita IVA
    //   · partita IVA senza regime  → senza il regime non si sa se va la
    //     ritenuta, ed è il dato che cambia quanto il cliente bonifica
    if (!pulito(s.partita_iva)) manca.push('partita IVA');
    const regime = pulito(s.regime).toLowerCase();
    if (regime !== 'ordinario' && regime !== 'forfettario') {
      manca.push('regime fiscale (ordinario o forfettario)');
    }
    return manca;
  }

  if (cat === 'privato_it') {
    if (!pulito(s.codice_fiscale)) manca.push('codice fiscale');
  }

  if (cat === 'sostituto_it' || cat === 'forfettario_it') {
    if (!pulito(s.partita_iva)) manca.push('partita IVA');
    // Per la fattura elettronica basta UNA delle due strade: il codice
    // destinatario di 7 caratteri, oppure la PEC.
    const sdi = pulito(s.codice_sdi);
    const sdiValido = sdi.length === 7 && sdi !== '0000000';
    if (!sdiValido && !pulito(s.pec)) manca.push('codice destinatario (7 caratteri) o PEC');
  }

  if (cat === 'estero_extra_ue') {
    // L'identificativo estero non è "mancante": se non c'è, in fattura si usa il
    // riempitivo previsto (OO99999999999). La provincia e il CAP italiani non
    // hanno senso qui: si tolgono dall'elenco.
    return manca.filter(m => m !== 'provincia' && m !== 'CAP');
  }

  return manca;
}

/**
 * Il verdetto da mostrare in una scheda.
 * @returns {{stato:string, categoria:string|null, etichettaCategoria:string,
 *            mancanti:string[], messaggio:string}}
 *   stato: 'pronto'       → si può fatturare
 *          'incompleto'   → mancano dei dati, elencati in `mancanti`
 *          'da_verificare'→ soggetto estero: i dati ci sono ma il trattamento
 *                           fiscale è ancora una domanda aperta col
 *                           commercialista (decisione dell'11/08: campi sì,
 *                           calcolo no). Non si fattura al buio.
 */
function statoFatturabilita(s) {
  const categoria = categoriaFiscale(s);
  const mancanti = datiMancanti(s);
  const etichettaCategoria = categoria ? CATEGORIE[categoria] : 'Da completare';

  if (mancanti.length) {
    return {
      stato: 'incompleto', categoria, etichettaCategoria, mancanti,
      messaggio: 'Manca: ' + mancanti.join(', '),
    };
  }
  if (categoria === 'estero_extra_ue') {
    return {
      stato: 'da_verificare', categoria, etichettaCategoria, mancanti,
      messaggio: 'Soggetto estero: trattamento IVA da confermare col commercialista',
    };
  }
  return {
    stato: 'pronto', categoria, etichettaCategoria, mancanti,
    messaggio: 'Pronto per fatturare',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// I DUE TRADUTTORI
//
// Clienti e committenti restano tabelle separate — sono ruoli diversi con vite
// diverse (spec §2). Ma il calcolo fiscale deve stare in un punto solo e non
// deve sapere chi ha davanti. Questi due traduttori portano le due tabelle alla
// stessa forma, e da lì in poi il cervello lavora alla cieca.
// ───────────────────────────────────────────────────────────────────────────
function daCliente(c) {
  return {
    ruolo: 'cliente',
    denominazione: pulito([c.nome, c.cognome].filter(Boolean).join(' ')) || pulito(c.name),
    paese: c.paese, natura_giuridica: c.natura_giuridica,
    codice_fiscale: c.codice_fiscale, partita_iva: c.partita_iva, regime: c.regime,
    identificativo_estero: c.identificativo_estero,
    via: c.via, cap: c.cap, citta: c.citta, provincia: c.provincia,
    codice_sdi: c.codice_sdi, pec: c.pec,
  };
}

function daCommittente(k) {
  return {
    ruolo: 'committente',
    denominazione: pulito(k.denominazione),
    paese: k.paese, natura_giuridica: k.natura_giuridica,
    codice_fiscale: k.codice_fiscale, partita_iva: k.partita_iva, regime: k.regime,
    identificativo_estero: k.identificativo_estero,
    // Sui committenti il campo dell'indirizzo si chiama `indirizzo` e contiene
    // via e civico; CAP, città e provincia sono colonne a sé dall'11/08.
    via: k.indirizzo, cap: k.cap, citta: k.citta, provincia: k.provincia,
    codice_sdi: k.codice_sdi, pec: k.pec,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// I CONTI (spec §5 e §6) — da imponibile a «quanto ti bonificano»
//
// Portati qui in Fase 3 e non in Fase 5 come previsto: la proforma deve dire una
// cifra a un cliente vero, e quella cifra dipende dalla sua categoria fiscale
// esattamente come ci dipenderà il report. È la stessa aritmetica: scriverla due
// volte vorrebbe dire darle due occasioni di divergere.
//
// ⚠️ Tutto questo vale finché CHI EMETTE è in IVA ordinaria (inquadramento dato
// dal commercialista l'11/08). Un emittente forfettario non addebiterebbe l'IVA
// affatto: per questo il regime dell'emittente è un dato obbligatorio e
// `datiMancantiEmittente` non lascia passare una proforma senza.
// ═══════════════════════════════════════════════════════════════════════════

// Le aliquote non si scrivono dentro i conti: cambiano per legge, e devono
// cambiare in UN punto solo (spec §5).
const PARAMETRI = {
  aliquota_iva: 22,
  ritenuta: { aliquota: 20, tipo: 'RT01', causale: 'A' },
  // Il bollo si applica SOPRA la soglia, non a parità: a 77,47 esatti non si mette.
  bollo: { importo: 2.00, soglia: 77.47 },
  ateco_principale: '70.20.09',
};

// La tabella decisionale della spec §6, scritta come TABELLA e non come una
// catena di «se»: così si legge riga per riga e si prova riga per riga.
const TRATTAMENTI = {
  sostituto_it:    { iva: true,  ritenuta: true,  bollo: false, natura: null,    dicitura: null },
  privato_it:      { iva: true,  ritenuta: false, bollo: false, natura: null,    dicitura: null },
  forfettario_it:  { iva: true,  ritenuta: false, bollo: false, natura: null,    dicitura: null },
  estero_extra_ue: { iva: false, ritenuta: false, bollo: true,  natura: 'N2.1',
                     dicitura: 'Operazione non soggetta, art. 7-ter DPR 633/72' },
};

/**
 * Arrotonda a 2 decimali per eccesso sul mezzo centesimo (half-up).
 * `Math.round(v * 100) / 100` da solo NON basta: 1,005 in binario vale un
 * pelo MENO di 1,005, quindi tornerebbe 1,00 invece di 1,01. Lo scostamento
 * minuscolo rimette il numero dalla parte giusta della metà.
 */
function arrotonda(v) {
  const c = Number(v || 0) * 100;
  return Math.round(c + (c >= 0 ? 1e-9 : -1e-9)) / 100;
}

/**
 * I conti di un documento, nell'ordine della spec §6.1.
 *
 * ⚠️ L'imponibile è la CIFRA CONCORDATA (prezzo × sessioni), MAI l'importo che
 * arriva in banca. La spec al §6.1 passo 1 dice «imponibile = importo
 * dell'incasso» e sbaglia: col suo stesso esempio fatturi 1.000, il cliente
 * trattiene 200 di ritenuta e ti bonifica 1.020 — se 1.020 diventasse
 * l'imponibile, IVA e ritenuta verrebbero calcolate su un numero inventato.
 *
 * @returns {object|null} null se la categoria non è decidibile: chi chiama deve
 *          fermarsi e chiedere i dati, mai tirare a indovinare.
 */
function calcolaDocumento({ categoria, imponibile }) {
  const t = TRATTAMENTI[categoria];
  if (!t) return null;
  // Si arrotonda A OGNI PASSAGGIO, non solo alla fine (spec §6.2): è così che
  // calcola il gestionale, e i due numeri devono coincidere al centesimo,
  // altrimenti il documento perde la sua funzione di controllo.
  const imponibileR = arrotonda(imponibile);
  const iva      = t.iva      ? arrotonda(imponibileR * PARAMETRI.aliquota_iva / 100) : 0;
  const ritenuta = t.ritenuta ? arrotonda(imponibileR * PARAMETRI.ritenuta.aliquota / 100) : 0;
  // Il bollo è voce esclusa ex art. 15: non entra nella base dell'IVA né in
  // quella della ritenuta, e si espone sempre come riga a sé (spec §6.3).
  const bollo = (t.bollo && imponibileR > PARAMETRI.bollo.soglia) ? PARAMETRI.bollo.importo : 0;
  const totaleDocumento = arrotonda(imponibileR + iva + bollo);
  const daPagare = arrotonda(totaleDocumento - ritenuta);
  return {
    categoria,
    imponibile: imponibileR, iva, ritenuta, bollo,
    totaleDocumento,
    // Il «netto a pagare» della spec. Qui si chiama così perché è la domanda a
    // cui risponde: quanto mi bonifica il cliente.
    daPagare,
    natura: t.natura, dicitura: t.dicitura,
  };
}

/**
 * Gli stessi conti spezzati nei PASSAGGI da mostrare, uno per riga.
 *
 * Richiesta di Germano (12/08): «l'importante è che siano visibili tutti i
 * passaggi del conteggio». Sta qui e non nella pagina perché la proforma di
 * carta e la schermata devono dire le stesse identiche righe: se ognuna se le
 * costruisse per conto suo, prima o poi direbbero due cose diverse.
 *
 * Le etichette sono scritte dal punto di vista di CHI RICEVE il documento: è il
 * cliente sostituto d'imposta a trattenere la ritenuta e a versarla allo Stato,
 * non il coach.
 */
function passaggiDocumento(d) {
  if (!d) return [];
  const p = [{ etichetta: 'Imponibile', importo: d.imponibile, segno: '' }];
  if (d.iva) {
    p.push({ etichetta: `IVA ${PARAMETRI.aliquota_iva}%`, importo: d.iva, segno: '+' });
  } else {
    p.push({ etichetta: 'IVA', importo: 0, segno: '', nota: d.dicitura });
  }
  if (d.bollo) {
    p.push({ etichetta: `Imposta di bollo (sopra € ${euro(PARAMETRI.bollo.soglia)})`,
             importo: d.bollo, segno: '+' });
  }
  p.push({ etichetta: 'Totale del documento', importo: d.totaleDocumento, segno: '=', forte: true });
  if (d.ritenuta) {
    // ⛔ 17/08 — TOLTA la nota «la trattieni tu e la versi allo Stato».
    // Germano: «chi riceve la proforma sa cos'è una ritenuta d'acconto». Era una
    // spiegazione scritta per noi, su un documento che va a un'azienda: spiegare
    // a un cliente una cosa che conosce lo tratta da incompetente.
    p.push({ etichetta: `Ritenuta d’acconto ${PARAMETRI.ritenuta.aliquota}%`,
             importo: d.ritenuta, segno: '−' });
  }
  p.push({ etichetta: 'Importo da bonificare', importo: d.daPagare, segno: '=', forte: true });
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHI EMETTE — cosa serve avere scritto prima di poter mandare una proforma
//
// Diviso in due elenchi apposta: `mancanti` ferma il documento, `consigliati`
// no. Confonderli vorrebbe dire o bloccare il lavoro per un numero di telefono,
// o lasciar partire un documento senza l'IBAN — e nessuna delle due è
// accettabile.
// ═══════════════════════════════════════════════════════════════════════════
function datiMancantiEmittente(e) {
  e = e || {};
  const mancanti = [], consigliati = [];
  const nomeCompleto = pulito(e.denominazione)
    || pulito([e.nome, e.cognome].filter(Boolean).join(' '));

  if (!nomeCompleto)          mancanti.push('denominazione (o nome e cognome)');
  if (!pulito(e.via))         mancanti.push('indirizzo');
  if (!pulito(e.cap))         mancanti.push('CAP');
  if (!pulito(e.citta))       mancanti.push('città');
  if (!pulito(e.provincia))   mancanti.push('provincia');
  if (!pulito(e.paese))       mancanti.push('paese');
  if (!pulito(e.partita_iva)) mancanti.push('partita IVA');
  // Senza IBAN il documento non dice dove pagare: è il motivo per cui esiste.
  if (!pulito(e.iban))        mancanti.push('IBAN');
  // Il regime non è un dettaglio anagrafico: decide se sul documento ci va
  // l'IVA. I conti qui dentro valgono per l'ordinario, quindi un regime
  // diverso (o assente) deve fermare tutto invece di produrre cifre sbagliate.
  const regime = pulito(e.regime).toLowerCase();
  if (regime !== 'ordinario') {
    mancanti.push(regime === 'forfettario'
      ? 'regime: con il forfettario l’IVA non si addebita e i conti dell’Hub non valgono più — parlane col commercialista'
      : 'regime fiscale');
  }

  if (!pulito(e.codice_fiscale)) consigliati.push('codice fiscale');
  if (!pulito(e.intestatario))   consigliati.push('intestatario del conto');
  if (!pulito(e.banca))          consigliati.push('banca');
  if (!pulito(e.ateco))          consigliati.push('codice ATECO');
  if (!pulito(e.email))          consigliati.push('email');

  return { mancanti, consigliati, pronto: mancanti.length === 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// LE ANOMALIE (spec §7.1 sezione B) — «chi non è fatturabile, e perché»
//
// Anche questa parte è pura: entrano tre elenchi già letti dal database, esce
// l'elenco di ciò che non va. Nessuna query qui dentro, così le regole si
// possono provare con dei numeri finti invece che con dei clienti veri.
//
// ⚠️ Si segnala solo dove ci sono SOLDI VERI in gioco (decisione B2 dell'11/08):
// un cliente senza percorso a pagamento e un progetto senza quota non hanno
// niente da fatturare, quindi non hanno niente da segnalare. Il filtro NON sta
// qui: sta nella query che prepara gli elenchi, perché è lì che si sa chi ha un
// prezzo. Qui si assume che arrivi già solo chi conta.
// ═══════════════════════════════════════════════════════════════════════════

// Confronto fra importi in CENTESIMI interi. Con i decimali, 10000 − 7000 − 3000
// può non fare esattamente zero e la pagina segnalerebbe un'anomalia che non
// esiste. È lo stesso motivo per cui le quote si tengono in euro e non in
// percentuali.
function centesimi(v) {
  return Math.round(Number(v || 0) * 100);
}

// Gli importi si scrivono all'italiana — 10.000,00 e non 10000.00 — anche dentro
// i messaggi. Chi legge sta confrontando cifre, e un punto al posto della virgola
// nelle migliaia è il genere di cosa che fa sbagliare un numero a colpo d'occhio.
// ═══════════════════════════════════════════════════════════════════════════
// COME SI SCRIVONO I NUMERI — in un posto solo (17/08/2026)
//
// 🔴 Germano: «il punto deve essere inserito anche per le migliaia, su tutti i
// numeri superiori a 1.000». Non era un guasto: `toLocaleString('it-IT')` segue
// la regola CLDR italiana, che sotto le 5 cifre il separatore NON lo mette —
// quindi usciva «€ 2142,00». È una scelta di prodotto contro il default, e si
// ottiene con `useGrouping: 'always'`.
//
// ⭐ Erano VENTI i punti che formattavano numeri per conto loro. Correggerli uno
// per uno voleva dire lasciarne indietro qualcuno e ritrovarsi lo stesso importo
// scritto in due modi in due pagine — esattamente il difetto che abbiamo passato
// giorni a togliere. Quindi: due funzioni, e tutti passano di qui.
// ⚠️ Le pagine hanno anche del JS che gira nel BROWSER e non può chiamare questo
// modulo: là le stesse due funzioni sono in `piano-ui.js`, con lo stesso nome e
// le stesse opzioni. Se un giorno cambia la regola, cambia in due punti soli.
// ═══════════════════════════════════════════════════════════════════════════
const GRUPPI = { useGrouping: 'always' };

/** Un importo con i centesimi: «€ 2.142,00». */
function euro(v) {
  return Number(v || 0).toLocaleString('it-IT',
    { minimumFractionDigits: 2, maximumFractionDigits: 2, ...GRUPPI });
}

/**
 * Un importo INTERO, senza centesimi: «2.500».
 * Serve alle rate, che per decisione del 27/07 sono cifre intere: scriverci
 * «,00» dietro darebbe una precisione che quel numero non ha.
 */
function euroIntero(v) {
  return Math.round(Number(v) || 0).toLocaleString('it-IT', GRUPPI);
}

/**
 * Le quote di un progetto tornano? totale = committente + somma dei coachee.
 * @returns {{quadra:boolean, scarto:number}} scarto in euro, positivo se manca
 *          qualcosa all'appello, negativo se le quote superano il totale.
 */
function quoteProgetto(p) {
  const tot = centesimi(p.quota_totale);
  const scarto = tot - centesimi(p.quota_committente) - centesimi(p.somma_coachee);
  return { quadra: scarto === 0, scarto: scarto / 100 };
}

const TIPI_ANOMALIA = {
  dati_cliente:       'Dati di fatturazione incompleti',
  dati_committente:   'Dati di fatturazione incompleti',
  quote_non_tornano:  'Le quote del progetto non tornano',
  senza_partecipanti: 'Progetto con una quota ma nessun partecipante',
};

function anomalie({ clienti = [], committenti = [], progetti = [] } = {}) {
  const out = [];

  for (const c of clienti) {
    const st = statoFatturabilita(daCliente(c));
    if (st.stato !== 'pronto') {
      out.push({ tipo: 'dati_cliente', ruolo: 'cliente', id: c.id, collaudo: c.di_collaudo === true,
        nome: daCliente(c).denominazione, messaggio: st.messaggio });
    }
  }

  for (const k of committenti) {
    const st = statoFatturabilita(daCommittente(k));
    if (st.stato !== 'pronto') {
      out.push({ tipo: 'dati_committente', ruolo: 'committente', id: k.id, collaudo: k.di_collaudo === true,
        nome: pulito(k.denominazione), messaggio: st.messaggio });
    }
  }

  for (const p of progetti) {
    const q = quoteProgetto(p);
    if (!q.quadra) {
      const verso = q.scarto > 0 ? 'mancano' : 'ci sono';
      out.push({ tipo: 'quote_non_tornano', ruolo: 'progetto', id: p.id, collaudo: p.di_collaudo === true,
        nome: pulito(p.titolo),
        messaggio: `Totale € ${euro(p.quota_totale)}, ma committente + coachee fanno `
          + `€ ${euro(Number(p.quota_committente||0) + Number(p.somma_coachee||0))} `
          + `(${verso} € ${euro(Math.abs(q.scarto))})` });
    }
    if (Number(p.n_partecipanti || 0) === 0) {
      out.push({ tipo: 'senza_partecipanti', ruolo: 'progetto', id: p.id, collaudo: p.di_collaudo === true,
        nome: pulito(p.titolo),
        messaggio: 'Nessun coachee collegato: non si sa a chi è riferita la prestazione' });
    }
  }

  return out;
}

/**
 * Le anomalie raccolte PER SOGGETTO, non per tipo di problema.
 *
 * Scelta di Germano (11/08): «apro un cliente e gestisco due anomalie». Chi
 * sistema i dati lavora su una persona per volta — apre la sua scheda, corregge
 * tutto quello che manca, chiude. Raggruppare per tipo di problema costringeva a
 * tornare sullo stesso nome in due riquadri diversi.
 *
 * L'ordine dei soggetti è quello di arrivo (clienti, poi committenti, poi
 * progetti: lo decide `anomalie()`), e dentro ciascuno l'ordine dei suoi problemi.
 *
 * @returns {Array<{ruolo:string, id:string, nome:string, voci:Array}>}
 */
function anomaliePerSoggetto(lista) {
  const gruppi = [];
  for (const a of lista) {
    // La chiave è ruolo+id: un cliente e un progetto potrebbero avere lo stesso
    // id senza essere la stessa cosa.
    const chiave = a.ruolo + ':' + a.id;
    let g = gruppi.find(x => x.chiave === chiave);
    if (!g) { g = { chiave, ruolo: a.ruolo, id: a.id, nome: a.nome, collaudo: !!a.collaudo, voci: [] }; gruppi.push(g); }
    g.voci.push({ tipo: a.tipo, titolo: TIPI_ANOMALIA[a.tipo] || a.tipo, messaggio: a.messaggio });
  }
  return gruppi;
}

module.exports = {
  CATEGORIE, categoriaFiscale, datiMancanti, statoFatturabilita,
  daCliente, daCommittente,
  PARAMETRI, TRATTAMENTI, arrotonda, calcolaDocumento, passaggiDocumento,
  datiMancantiEmittente,
  TIPI_ANOMALIA, quoteProgetto, anomalie, anomaliePerSoggetto, euro, euroIntero,
};
