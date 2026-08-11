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
  if (!pulito(s.partita_iva)) return 'privato_it';
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
    // Ha la partita IVA: senza il regime non si sa se va la ritenuta. È il dato
    // che cambia l'importo che il cliente bonifica, quindi è mancante a tutti
    // gli effetti.
    manca.push('regime fiscale (ordinario o forfettario)');
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
function euro(v) {
  return Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      out.push({ tipo: 'dati_cliente', ruolo: 'cliente', id: c.id,
        nome: daCliente(c).denominazione, messaggio: st.messaggio });
    }
  }

  for (const k of committenti) {
    const st = statoFatturabilita(daCommittente(k));
    if (st.stato !== 'pronto') {
      out.push({ tipo: 'dati_committente', ruolo: 'committente', id: k.id,
        nome: pulito(k.denominazione), messaggio: st.messaggio });
    }
  }

  for (const p of progetti) {
    const q = quoteProgetto(p);
    if (!q.quadra) {
      const verso = q.scarto > 0 ? 'mancano' : 'ci sono';
      out.push({ tipo: 'quote_non_tornano', ruolo: 'progetto', id: p.id,
        nome: pulito(p.titolo),
        messaggio: `Totale € ${euro(p.quota_totale)}, ma committente + coachee fanno `
          + `€ ${euro(Number(p.quota_committente||0) + Number(p.somma_coachee||0))} `
          + `(${verso} € ${euro(Math.abs(q.scarto))})` });
    }
    if (Number(p.n_partecipanti || 0) === 0) {
      out.push({ tipo: 'senza_partecipanti', ruolo: 'progetto', id: p.id,
        nome: pulito(p.titolo),
        messaggio: 'Nessun coachee collegato: non si sa a chi è riferita la prestazione' });
    }
  }

  return out;
}

module.exports = {
  CATEGORIE, categoriaFiscale, datiMancanti, statoFatturabilita,
  daCliente, daCommittente,
  TIPI_ANOMALIA, quoteProgetto, anomalie,
};
