/**
 * LO STATO DELLA BOZZA DI CONTRATTO — una sola verità, usata da tutte le pagine.
 *
 * ⭐ LE PAROLE SONO DI GERMANO (29-30/08/2026):
 *      da redigere → da inviare → in attesa di approvazione → approvata
 *
 *    · **«approvata» È il ritorno FIRMATO della controparte**, non un'approvazione
 *      del coach: *«un contratto è approvato solo quando il Cliente o il
 *      Committente lo ha firmato»*. Gli arriva per email, lo salva, e spunta.
 *    · Il terzo stato si chiama **«in attesa di approvazione»** e non «inviata»,
 *      perché deve dire **da chi è la palla**, non solo che il documento è partito.
 *
 * 🔴 «DA REDIGERE» NON SI SCRIVE DA NESSUNA PARTE: è l'ASSENZA della riga in
 *    `contratti`. Un contratto che nessuno ha ancora toccato non ha bisogno di
 *    essere registrato — e così non è servito riempire il database per i nove
 *    clienti che c'erano già.
 *
 * 🔒 IL CONGELAMENTO: quando il contratto del COMMITTENTE è «approvata», le
 *    specifiche del progetto si bloccano. *«La firma del contratto congela tutte
 *    le caratteristiche del Progetto.»* ⚠️ Lo stato è di OGNI singolo contratto,
 *    ma a congelare è **solo quello del Committente**: i contratti dei
 *    partecipanti hanno il loro stato e non bloccano niente. Nei percorsi
 *    individuali il problema non si pone.
 *
 * ↩️ LE DUE AZIONI DI MODIFICA, facoltative: «modifica contratto inviato» e
 *    «modifica contratto approvato». Chi le usa riporta il flusso **a «da
 *    inviare»**, non allo stato precedente.
 *    ⭐ Il perché, deciso il 29/08 sera: un contratto modificato dopo l'invio
 *      lascia in mano al cliente **una versione vecchia**. Dire «in attesa di
 *      approvazione» sarebbe una bugia — la palla è tornata al coach, che deve
 *      rimandarlo. «Da inviare» è l'unico stato che ricorda che c'è una cosa da fare.
 */

const STATI = [
  { key: 'da_redigere', label: 'Da redigere',               bg: '#eef1f5', color: '#7a8089' },
  { key: 'da_inviare',  label: 'Da inviare',                bg: '#fdf6e3', color: '#8a6d1e' },
  { key: 'in_attesa',   label: 'In attesa di approvazione', bg: '#e8f4fd', color: '#1A5280' },
  { key: 'approvata',   label: 'Approvata',                 bg: '#eaf5ee', color: '#2f6b46' },
];

/** Il passo in avanti, e le parole del pulsante: dicono cosa STAI DICHIARANDO. */
const AVANTI = {
  da_redigere: { a: 'da_inviare', label: 'L\'ho preparata' },
  da_inviare:  { a: 'in_attesa',  label: 'L\'ho inviata' },
  in_attesa:   { a: 'approvata',  label: 'È tornata firmata' },
};

/** Le due azioni di modifica. Riportano ENTRAMBE a «da inviare». */
const INDIETRO = {
  in_attesa: { a: 'da_inviare', label: 'Modifica contratto inviato' },
  approvata: { a: 'da_inviare', label: 'Modifica contratto approvato' },
};

const CHIAVI = STATI.map(s => s.key);
const valido = (k) => CHIAVI.includes(String(k || ''));

/**
 * IL PASSO È AMMESSO? — fetta 0.5 del riordino (04/09/2026).
 * Un passaggio è lecito solo se è quello che AVANTI o INDIETRO prevedono da
 * dove si sta: gli stessi pulsanti che la cella mostra. Niente salti («da
 * redigere» → «approvata» congelerebbe un progetto con una chiamata sola), e
 * «da redigere» non si scrive mai: è l'assenza della riga. `da` può essere
 * null (riga assente = da redigere).
 * ⛔ La regola sta qui e non nella rotta: la rotta la applica, questa la sa.
 */
function passaggioAmmesso(da, a) {
  const cur = da == null || da === '' ? 'da_redigere' : String(da);
  if (!valido(cur) || !valido(a) || a === 'da_redigere') return false;
  const av = AVANTI[cur], ind = INDIETRO[cur];
  return !!((av && av.a === a) || (ind && ind.a === a));
}

function stato(k) {
  return STATI.find(s => s.key === k) || STATI[0];
}

/** Il pallino colorato da mettere in pagina. */
function badge(k) {
  const s = stato(k);
  return `<span class="badge" style="background:${s.bg};color:${s.color}">${s.label}</span>`;
}

/**
 * I TRE TIPI, e qual è la colonna che li lega al loro soggetto.
 * ⚠️ Un contratto ha UNO solo di questi tre, mai due: è il tipo a dire quale.
 */
const TIPI = {
  cliente:      { colonna: 'percorso_id',       etichetta: 'Cliente' },
  committente:  { colonna: 'progetto_id',       etichetta: 'Committente' },
  partecipante: { colonna: 'partecipazione_id', etichetta: 'Partecipante' },
};

/**
 * La cella «A che punto è»: il pallino, il passo avanti e — se c'è — l'azione di
 * modifica. Sta qui e non nelle pagine perché la usano sia la card Contratti del
 * progetto sia la scheda del cliente individuale: scriverla due volte vorrebbe
 * dire due pulsantiere che prima o poi dicono cose diverse.
 * ⚠️ Chi la mette in pagina deve avere una funzione `muoviContratto(tipo, id, stato)`.
 * ⭐ Il pulsante dice COSA STAI DICHIARANDO («l'ho inviata»), non a quale stato
 *   stai passando: è la stessa cosa detta dalla parte di chi lavora.
 */
function cella(tipo, id, st) {
  const av = AVANTI[st];
  const ind = INDIETRO[st];
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    ${badge(st)}
    ${av ? `<button onclick="muoviContratto('${tipo}','${id}','${av.a}')" class="btn btn-neutral btn-sm">${av.label}</button>` : ''}
    ${ind ? `<button onclick="muoviContratto('${tipo}','${id}','${ind.a}')" style="background:none;border:none;padding:0;font-size:12px;color:var(--muted);text-decoration:underline;cursor:pointer" title="Riporta il flusso a «da inviare»: il documento cambia, quindi va rimandato">${ind.label}</button>` : ''}
  </div>`;
}

module.exports = { STATI, AVANTI, INDIETRO, TIPI, CHIAVI, valido, passaggioAmmesso, stato, badge, cella };
