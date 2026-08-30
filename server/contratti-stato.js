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

module.exports = { STATI, AVANTI, INDIETRO, TIPI, CHIAVI, valido, stato, badge };
