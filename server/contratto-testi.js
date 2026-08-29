/**
 * I TESTI DEI CONTRATTI — le parole stanno qui, l'impaginazione sta in
 * `contratto.js`. Sono due file separati per un motivo pratico: cambiare una
 * parola non deve voler dire toccare il codice che disegna le pagine.
 *
 * ⭐ REGOLA DI GERMANO (27/08/2026): «non mi piace l'idea di inserire le opzioni
 *    di pagamento nel contratto. Vorrei che ogni tipologia avesse il suo modulo».
 *    ➜ Il cliente NON trova caselle da spuntare: il documento esce già con la
 *      sua sola clausola. La scelta la fa l'Hub leggendo `percorsi.modalita`.
 *
 * 🔴 TESTO NON VALIDATO DA UN LEGALE. Finché `BOZZA_NON_VALIDATA` è accesa in
 *    `contratto.js`, ogni pagina lo dichiara. Le parti che aspettano un parere
 *    non sono fiscali (le vede il commercialista il 04/09) ma di Codice del
 *    Consumo: recesso a 14 giorni, foro, approvazione 1341.
 */

// ── I dati del professionista ────────────────────────────────────────────
// ⚠️ Sede, codice fiscale/P. IVA e PEC arrivano a SETTEMBRE, con l'apertura
// della società individuale. Finché sono vuoti il contratto lo dice invece di
// far finta di niente: un contratto che rimanda a un'epigrafe inesistente è
// l'errore che avevamo già fatto l'08/08.
const PROFESSIONISTA = {
  nome: 'Germano Guerriero — Noesys Professional Coaching',
  sede: null,
  piva: null,
  pec: null,
  email: 'info@noesys.it',
  telefono: '+39 335 6700378',
  sito: 'www.noesys.it',
};

// ⚠️ I soldi si scrivono in UN SOLO modo in tutto l'Hub. La prima stesura di
// questo file aveva la sua funzione, e sbagliava: l'italiano non raggruppa i
// numeri di quattro cifre, quindi nello stesso paragrafo usciva «€ 10.000,00»
// accanto a «€ 7000,00». La funzione `euro` di `fiscale.js` lo risolve già per
// tutti, e usarla vuol dire che se un giorno cambia il formato cambia ovunque.
const { euro } = require('./fiscale');

// ═══════════════════════════════════════════════════════════════════════════
// I PARAGRAFI CHE I CONTRATTI HANNO IN COMUNE — scritti UNA volta sola.
// Il contratto del cliente individuale e quello del partecipante a un progetto
// dicono le stesse cose su cos'è il coaching, su come si svolgono le sessioni,
// sul ripensamento e sull'intelligenza artificiale. Se fossero due copie, prima
// o poi una verrebbe corretta e l'altra no, e due clienti si troverebbero due
// promesse diverse sulla stessa cosa.
// ⚠️ La NUMERAZIONE degli articoli resta scritta in ciascun contratto: è
//    l'unica cosa che cambia davvero fra i due, e nasconderla in una funzione
//    renderebbe illeggibile il testo qui dentro.
// ═══════════════════════════════════════════════════════════════════════════

const COSA_E_IL_COACHING = [
  { t: 'p', x: 'Il coaching è un processo di collaborazione in cui il/la Cliente, guidato/a dal Coach, mette a fuoco i propri obiettivi e le strade per raggiungerli.' },
  { t: 'p', x: 'Non è una terapia psicologica, una consulenza specialistica né un intervento di counseling. Il Coach non formula diagnosi e non cura disturbi: se durante il percorso emergono situazioni che richiedono un professionista sanitario, il Coach lo segnala e il percorso può essere sospeso.' },
  { t: 'p', x: 'Il coaching è una prestazione d\'opera intellettuale: il Coach si impegna sui mezzi, non sul risultato. Le decisioni e le azioni restano del/la Cliente, che ne è l\'unico/a responsabile. Il Coach non risponde del mancato raggiungimento degli obiettivi né delle conseguenze delle scelte compiute dal/la Cliente durante o dopo il percorso.' },
];

const COME_SI_SVOLGONO = [
  { t: 'p', x: 'Le sessioni si tengono negli orari concordati fra le parti, in videochiamata oppure di persona, secondo quanto stabilito di volta in volta. In entrambi i casi si svolgono in un luogo riservato, senza altre persone presenti se non dichiarate.' },
  { t: 'forte', x: 'Disdette.' },
  { t: 'p', x: 'Chi non può presentarsi avvisa l\'altra parte almeno 24 ore prima. Una sessione disdetta oltre quel termine si considera erogata.' },
  { t: 'forte', x: 'Le sessioni non vengono registrate.' },
  { t: 'p', x: 'Non viene creato né conservato alcun file audio o video della sessione. È una regola che discende dal Codice Etico di ICF, a cui il/la Professionista aderisce. Una registrazione può essere effettuata solo con il consenso esplicito e preventivo del/la Cliente, prestato per iscritto e per una finalità determinata — ad esempio la presentazione di una sessione ai fini delle credenziali ICF del/la Professionista. In quel caso il/la Cliente viene informato/a prima della sessione dello scopo, di chi avrà accesso alla registrazione e per quanto tempo verrà conservata, e può negare il consenso senza alcuna conseguenza sul percorso.' },
  { t: 'forte', x: 'Resoconto della sessione.' },
  { t: 'p', x: 'Al termine di ogni sessione il/la Professionista redige un resoconto scritto. Per prepararlo si avvale di uno strumento automatico che ascolta la sessione e ne riassume per iscritto i punti principali, senza che la sessione venga registrata. Il/la Professionista rilegge, corregge e integra quel testo, e ne risponde: il resoconto così approvato è l\'unico documento che viene conservato. Il riassunto grezzo prodotto dallo strumento viene cancellato una volta salvato il resoconto approvato.' },
  { t: 'p', x: 'Il/la Cliente presta il proprio consenso a questo trattamento firmando l\'informativa che gli/le viene consegnata insieme al presente accordo, e può revocarlo in qualsiasi momento: da quel momento il/la Professionista prenderà appunti a mano.' },
];

const INTELLIGENZA_ARTIFICIALE = [
  { t: 'nota', x: 'Informativa resa ai sensi dell\'art. 13 della Legge 23 settembre 2025, n. 132.' },
  { t: 'p', x: 'Nello svolgimento della propria attività il/la Professionista si avvale di strumenti di intelligenza artificiale, con funzione di supporto organizzativo e documentale: per predisporre i resoconti delle sessioni, per ordinare e conservare le informazioni del percorso, per preparare materiali di lavoro e di restituzione al/la Cliente, e all\'interno degli strumenti digitali messi a disposizione del/la Cliente stesso/a.' },
  { t: 'p', x: 'Qualunque sia lo strumento utilizzato — e il/la Professionista può cambiarlo o affiancarne altri nel tempo — valgono sempre queste regole:' },
  { t: 'li', x: 'l\'intelligenza artificiale propone, il/la Professionista decide: nessun risultato viene utilizzato o consegnato al/la Cliente senza la sua revisione;' },
  { t: 'li', x: 'la responsabilità della prestazione resta interamente del/la Professionista, che non la delega ad alcuno strumento;' },
  { t: 'li', x: 'nessuno strumento viene impiegato per analizzare o dedurre lo stato emotivo o psicologico del/la Cliente, né per formulare valutazioni sulla sua persona;' },
  { t: 'li', x: 'i dati del/la Cliente non vengono utilizzati per addestrare sistemi di intelligenza artificiale.' },
  { t: 'p', x: 'Il/la Cliente può chiedere in qualsiasi momento quali strumenti il/la Professionista stia utilizzando.' },
];

// ⚠️ I 14 giorni valgono per ogni PERSONA FISICA che firma da consumatore —
// compreso il partecipante a un progetto, anche se la maggior parte del
// compenso la paga la sua azienda. Quello che firma lui è un contratto suo.
function ripensamento14Giorni() {
  return [
    { t: 'p', x: 'Se il/la Cliente è un consumatore — cioè agisce per scopi estranei alla propria attività professionale — e questo accordo è concluso a distanza o fuori dai locali del/la Professionista, ha diritto di ripensarci entro 14 giorni dalla firma, senza doversi giustificare e senza alcuna penale (artt. 52 e seguenti del Codice del Consumo).' },
    { t: 'p', x: `Per farlo basta comunicarlo per iscritto, anche via email a ${PROFESSIONISTA.email}, oppure usare il modulo allegato in fondo a questo accordo.` },
    { t: 'p', x: 'Se il percorso deve cominciare prima che i 14 giorni siano trascorsi, serve una richiesta espressa del/la Cliente:' },
    { t: 'p', x: '☐  Chiedo che il percorso cominci subito, prima della scadenza dei 14 giorni. Sono consapevole che, se poi decidessi di ripensarci, dovrò comunque il compenso per le sessioni già svolte fino a quel momento, in proporzione.' },
    { t: 'firma', x: 'Firma per l\'avvio immediato' },
    { t: 'nota', x: 'Senza questa richiesta firmata, le sessioni non cominciano prima del quindicesimo giorno.' },
  ];
}

function allegatoRecesso() {
  return [
    { t: 'pagina' },
    { t: 'titolo', x: 'Allegato A — Modulo di recesso' },
    { t: 'nota', x: 'Da compilare e restituire solo se si desidera recedere entro i 14 giorni.' },
    { t: 'vuoto', x: 8 },
    { t: 'p', x: `Destinatario: ${PROFESSIONISTA.nome} — ${PROFESSIONISTA.email}` },
    { t: 'vuoto', x: 6 },
    { t: 'campo', x: 'Con la presente comunico il recesso dall\'accordo per servizi di coaching sottoscritto in data', punti: 20 },
    { t: 'vuoto', x: 6 },
    { t: 'campo', x: 'Nome e Cognome:' },
    { t: 'campo', x: 'Indirizzo:' },
    { t: 'firma', x: 'Data' },
    { t: 'firma', x: 'Firma' },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// LA TIPOLOGIA DEL PERCORSO DI UN PROGETTO — le quattro di Germano.
// 🔴 Nasce da un difetto trovato da lui il 28/08: i contratti di Flamingo
//    dicevano «percorso individuale» mentre il progetto è di tipo TEAM. Il dato
//    c'era in `progetti.tipo` fin dall'inizio: quella parola l'avevo scritta a
//    mano invece di andarla a prendere.
// ⚠️ Un tipo sconosciuto NON diventa «individuale» per ripiego: si ferma. Un
//    contratto che sbaglia la natura del percorso è peggio di un contratto che
//    non esce.
// ═══════════════════════════════════════════════════════════════════════════
const PERCORSI_PROGETTO = {
  'individuale':          { agg: 'individuale', collettivo: false },
  'individuale-multiplo': { agg: 'individuale', collettivo: false },
  'team':                 { agg: 'di team',     collettivo: true  },
  'group':                { agg: 'di gruppo',   collettivo: true  },
};

function tipoPercorso(tipo) {
  const t = PERCORSI_PROGETTO[String(tipo || '').trim()];
  if (!t) throw new Error(`Tipologia di progetto sconosciuta: «${tipo}». Le quattro previste sono individuale, individuale-multiplo, team, group.`);
  return t;
}

/** Il punto 4, in quattro versioni. Ne esce UNA sola per contratto. */
function compenso(modalita, prezzo, nSessioni, prestazione) {
  const p = prezzo == null ? '……………' : '€ ' + euro(prezzo);
  const n = nSessioni == null ? '………' : String(nSessioni);
  const pagamento = {
    t: 'p',
    x: 'Il compenso si salda entro 15 giorni dalla data della fattura, con bonifico sul conto indicato in fattura. Il compenso non è in alcun modo condizionato all\'esito del percorso.',
  };
  switch (modalita) {
    case 'Standard':
      return [
        { t: 'p', x: `Il compenso è di ${p} + IVA 22% per ogni sessione, per un percorso di ${n} sessioni.` },
        pagamento,
      ];
    case 'Pacchetto':
      return [
        { t: 'p', x: `Il compenso è di ${p} + IVA 22% per l'intero percorso di ${n} sessioni.` },
        { t: 'p', x: 'Il pacchetto va utilizzato entro 6 mesi dalla data della prima sessione.' },
        pagamento,
      ];
    case 'Scambio servizi':
      return [
        { t: 'p', x: 'Il/la Cliente non corrisponde denaro. A fronte del percorso di coaching eroga al/la Professionista la seguente prestazione:' },
        // Se la prestazione è scritta sul percorso, la si stampa. Se non c'è,
        // restano i puntini e si riempie a penna: un contratto con uno spazio
        // vuoto si firma lo stesso, uno con una frase inventata no.
        (prestazione && String(prestazione).trim())
          ? { t: 'forte', x: String(prestazione).trim() }
          : { t: 'campo', x: '', punti: 74 },
        { t: 'p', x: 'Le due prestazioni restano operazioni autonome: ciascuna parte adempie per proprio conto agli obblighi fiscali e di fatturazione che la riguardano.' },
      ];
    case 'Pro bono':
      return [
        { t: 'p', x: 'Il percorso è offerto a titolo gratuito. Nessun corrispettivo è dovuto, in denaro o in altra forma. Restano validi tutti gli altri obblighi del presente accordo.' },
      ];
    default:
      throw new Error(`Modalità sconosciuta: «${modalita}». Le quattro previste sono Standard, Pacchetto, Scambio servizi, Pro bono.`);
  }
}

/** Il box con i dati del professionista. Dice cosa manca, non lo nasconde. */
function boxProfessionista() {
  const b = [{ t: 'forte', x: 'Il Professionista' }, { t: 'p', x: PROFESSIONISTA.nome }];
  if (PROFESSIONISTA.sede) b.push({ t: 'p', x: PROFESSIONISTA.sede });
  else b.push({ t: 'nota', x: 'Sede legale, codice fiscale / P. IVA e PEC: in corso di attribuzione, saranno indicati prima della sottoscrizione definitiva.' });
  b.push({ t: 'p', x: `${PROFESSIONISTA.email} · ${PROFESSIONISTA.telefono} · ${PROFESSIONISTA.sito}` });
  return b;
}

/** Il box del cliente: i valori che l'Hub ha già, e i puntini per quelli che no. */
function boxCliente(c) {
  const v = (x) => (x && String(x).trim() ? String(x).trim() : null);
  const riga = (etichetta, valore) => valore
    ? { t: 'p', x: `${etichetta} ${valore}` }
    : { t: 'campo', x: etichetta };
  const citta = [v(c.citta), v(c.provincia) ? '(' + v(c.provincia) + ')' : null].filter(Boolean).join(' ');
  const indirizzo = [v(c.via), v(c.cap)].filter(Boolean).join(', ');
  return [
    { t: 'forte', x: 'Il Cliente' },
    riga('Nome e Cognome:', [v(c.nome), v(c.cognome)].filter(Boolean).join(' ') || null),
    riga('Codice fiscale:', v(c.codice_fiscale)),
    riga('Indirizzo:', indirizzo || null),
    riga('Città e Prov.:', citta || null),
    riga('Email:', v(c.email)),
    riga('Cellulare:', v(c.telefono)),
  ];
}

/**
 * Il contratto della PERSONA FISICA — cioè di ogni Cliente di percorso
 * individuale (Germano, 27/08: «Persona Fisica: sono tutti i Clienti dei
 * percorsi individuali»).
 */
function personaFisica({ cliente, percorso }) {
  const modalita = percorso.modalita || 'Standard';
  return [
    { t: 'titolo', x: 'Accordo per servizi di coaching' },
    { t: 'sottotitolo', x: 'ai sensi degli artt. 2229 e seguenti del Codice Civile e della Legge 14 gennaio 2013, n. 4' },
    { t: 'riga' },
    ...boxProfessionista(),
    { t: 'vuoto', x: 8 },
    ...boxCliente(cliente),
    { t: 'vuoto', x: 6 },
    { t: 'p', x: 'Il/la sottoscritto/a (di seguito il/la Cliente) affida a Noesys Professional Coaching, nella persona di Germano Guerriero (di seguito il/la Professionista o il Coach), un percorso di coaching secondo modalità conformi agli standard e al Codice Etico di ICF – International Coaching Federation, e manifesta il proprio accordo sui punti che seguono.' },
    { t: 'riga' },

    { t: 'h', x: '1. Oggetto' },
    { t: 'p', x: 'Il/la Professionista si impegna a erogare al/la Cliente un percorso di coaching, articolato in sessioni individuali concordate fra le parti.' },

    { t: 'h', x: '2. Che cos\'è il coaching, e che cosa non è' },
    ...COSA_E_IL_COACHING,

    { t: 'h', x: '3. Come si svolgono le sessioni' },
    ...COME_SI_SVOLGONO,

    { t: 'h', x: '4. Compenso' },
    ...compenso(modalita, percorso.prezzo, percorso.n_sessioni_previste, percorso.prestazione_scambio),

    { t: 'h', x: '5. I primi 14 giorni: il diritto di ripensamento' },
    ...ripensamento14Giorni(),

    { t: 'h', x: '6. Recesso' },
    { t: 'p', x: 'Ai sensi dell\'art. 2237 c.c. entrambe le parti possono recedere in qualsiasi momento, con preavviso scritto.' },
    { t: 'li', x: 'Se recede il/la Cliente, deve il compenso per le sessioni già svolte e le spese sostenute.' },
    { t: 'li', x: 'Se recede il/la Professionista, il/la Cliente non deve nulla per le sessioni non svolte e non ha diritto ad alcun risarcimento.' },
    { t: 'p', x: 'Il Coach può proporre di interrompere il percorso quando ritiene che non stia portando beneficio al/la Cliente. Il recesso si comunica per iscritto agli indirizzi indicati in testa a questo accordo.' },

    { t: 'h', x: '7. Riservatezza' },
    { t: 'p', x: 'Tutto ciò che il/la Cliente condivide durante il percorso è riservato. Il Coach non lo rivela a nessuno e non lo usa per fini propri, salvo:' },
    { t: 'li', x: 'consenso scritto del/la Cliente;' },
    { t: 'li', x: 'obblighi di legge o richieste dell\'Autorità;' },
    { t: 'li', x: 'verifiche di ICF sull\'effettivo svolgimento delle sessioni, ai fini delle credenziali del Coach (data, durata e nominativo: mai i contenuti);' },
    { t: 'li', x: 'situazioni in cui emerga un pericolo grave e attuale per l\'incolumità di qualcuno.' },

    { t: 'h', x: '8. Strumenti di intelligenza artificiale' },
    ...INTELLIGENZA_ARTIFICIALE,

    { t: 'h', x: '9. Controversie e Foro competente' },
    { t: 'p', x: 'Per ogni controversia inerente il presente accordo è competente il Foro del luogo di residenza o di domicilio elettivo del/la Cliente, quando questi è un consumatore.' },

    { t: 'h', x: '10. Disposizioni finali' },
    { t: 'p', x: 'Il presente accordo sostituisce ogni intesa precedente, scritta o verbale, fra le parti in materia di coaching, e ne contiene tutti i termini. Le modifiche sono valide solo se scritte e sottoscritte da entrambe le parti. Per quanto non previsto si rinvia agli artt. 2229–2238 c.c. L\'informativa sul trattamento dei dati personali, consegnata insieme a questo accordo, ne è parte integrante.' },

    { t: 'riga' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma del/la Cliente' },
    { t: 'firmaProf', x: 'Firma del/la Professionista' },

    { t: 'h', x: 'Approvazione specifica delle clausole' },
    { t: 'p', x: 'Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., il/la Cliente dichiara di aver preso visione dell\'intero testo e di approvare espressamente le clausole: 2 (natura del servizio e limiti di responsabilità), 3 (svolgimento e resoconto), 4 (compenso), 5 (avvio immediato), 6 (recesso), 7 (riservatezza), 8 (intelligenza artificiale).' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma del/la Cliente' },

    ...allegatoRecesso(),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// L'INFORMATIVA PRIVACY — documento A SÉ, non in coda al contratto.
// Modello di semplicità scelto da Germano: la lettera del suo ex coach
// (2 pagine, punti da a) a h), una firma sola invece di tre consensi separati).
// ⚠️ Il consenso alle comunicazioni informative resta STACCATO e facoltativo:
//    quello del marketing non si può impacchettare con gli altri, o non vale.
// ═══════════════════════════════════════════════════════════════════════════

/** I punti da a) a h): identici per il cliente individuale e per il partecipante. */
function puntiPrivacy({ perEsteso }) {
  return [
    { t: 'h', x: 'a) Quali dati tratto' },
    { t: 'p', x: 'I tuoi dati anagrafici e di contatto; i dati necessari alla fatturazione; i contenuti che emergono durante le sessioni; i materiali che compili negli strumenti di lavoro che ti metto a disposizione.' },

    { t: 'h', x: 'b) Perché li tratto' },
    { t: 'p', x: 'Per erogare il percorso di coaching che abbiamo concordato, e per adempiere agli obblighi di legge, fiscali e contabili che ne derivano. Solo se me lo consenti separatamente, anche per inviarti comunicazioni informative.' },

    { t: 'h', x: 'c) Le sessioni non vengono registrate' },
    { t: 'p', x: 'Non creo né conservo file audio o video delle sessioni: me lo impone il Codice Etico di ICF, a cui aderisco.' },
    { t: 'p', x: 'Una registrazione è possibile solo con un tuo consenso esplicito e preventivo, per una finalità precisa che ti spiego prima di chiedertelo — per esempio la presentazione di una sessione ai fini delle mie credenziali ICF. Puoi negarlo senza alcuna conseguenza sul percorso.' },

    { t: 'h', x: 'd) Il resoconto della sessione' },
    { t: 'p', x: 'Al termine di ogni sessione scrivo un resoconto. Per prepararlo mi avvalgo di uno strumento automatico che ascolta la sessione e ne riassume per iscritto i punti principali, senza registrarla.' },
    { t: 'p', x: 'Poi rileggo, correggo e integro quel testo, e ne rispondo io: il resoconto approvato è l\'unico documento che conservo. Il riassunto grezzo prodotto dallo strumento viene cancellato appena il resoconto è salvato.' },
    { t: 'p', x: 'Puoi revocare in qualsiasi momento il consenso a questo trattamento: da quel momento prenderò appunti a mano.' },

    { t: 'h', x: 'e) Gli strumenti di intelligenza artificiale' },
    ...(perEsteso
      // Nella liberatoria del partecipante l'informativa sull'IA va PER ESTESO:
      // lui non firma nessun contratto, quindi non c'è un art. 8 a cui rimandare.
      // È l'obbligo dell'art. 13 della legge 132/2025, e va assolto qui.
      ? [
          { t: 'nota', x: 'Informativa resa ai sensi dell\'art. 13 della Legge 23 settembre 2025, n. 132.' },
          { t: 'p', x: 'Nello svolgimento della mia attività mi avvalgo di strumenti di intelligenza artificiale, con funzione di supporto organizzativo e documentale: per predisporre i resoconti delle sessioni, per ordinare e conservare le informazioni del percorso, per preparare materiali di lavoro e di restituzione, e all\'interno degli strumenti digitali che ti metto a disposizione.' },
          { t: 'p', x: 'Qualunque sia lo strumento utilizzato — e posso cambiarlo o affiancarne altri nel tempo — valgono sempre queste regole:' },
        ]
      : [
          { t: 'p', x: 'Li uso come supporto organizzativo e documentale, nei termini descritti all\'art. 8 del contratto. Valgono sempre queste regole:' },
        ]),
    { t: 'li', x: 'l\'intelligenza artificiale propone, io decido e resto responsabile: niente ti viene consegnato senza la mia revisione;' },
    { t: 'li', x: 'nessuno strumento analizza o deduce il tuo stato emotivo o psicologico, né formula valutazioni sulla tua persona;' },
    { t: 'li', x: 'i tuoi dati non vengono usati per addestrare sistemi di intelligenza artificiale.' },
    { t: 'p', x: 'Puoi chiedermi in ogni momento quali strumenti sto utilizzando.' },

    { t: 'h', x: 'f) Per quanto tempo li conservo' },
    { t: 'li', x: 'I resoconti delle sessioni e i dati del percorso: 3 anni dalla fine del percorso.' },
    { t: 'li', x: 'I documenti fiscali e contabili: 10 anni, perché lo impone la legge.' },
    { t: 'li', x: 'I dati raccolti per finalità informative: 2 anni.' },
    { t: 'li', x: 'Il riassunto grezzo dello strumento automatico: cancellato appena il resoconto è approvato.' },
  ];
}

const DIRITTI = [
  { t: 'h', x: 'h) I tuoi diritti' },
  { t: 'p', x: 'Puoi chiedermi in ogni momento di accedere ai tuoi dati, correggerli, cancellarli, limitarne l\'uso, riceverli in formato leggibile oppure opporti al trattamento (artt. 15–21 GDPR).' },
  { t: 'p', x: 'Puoi revocare i consensi che hai prestato, senza che questo tolga validità a quanto fatto prima. Puoi presentare reclamo al Garante per la protezione dei dati personali.' },
  { t: 'p', x: `Per esercitare questi diritti ti basta scrivere a ${PROFESSIONISTA.email}.` },
];

const CONSENSO_INFORMATIVE = [
  { t: 'riga' },
  { t: 'nota', x: 'Una scelta in più, del tutto facoltativa. Puoi lasciarla in bianco: il percorso non cambia.' },
  { t: 'p', x: '☐ Acconsento    ☐ Non acconsento  —  a ricevere da Noesys comunicazioni informative (nuovi strumenti, contenuti, iniziative).' },
  { t: 'firma', x: 'Firma' },
];

function intestazionePrivacy(titolo) {
  return [
    { t: 'titolo', x: titolo },
    { t: 'sottotitolo', x: 'ai sensi dell\'art. 13 del Regolamento UE 2016/679 (GDPR) e del D.Lgs. 196/2003, come modificato dal D.Lgs. 101/2018' },
    { t: 'riga' },
    { t: 'forte', x: 'Chi tratta i tuoi dati' },
    { t: 'p', x: `${PROFESSIONISTA.nome}. Per ogni richiesta: ${PROFESSIONISTA.email}.` },
  ];
}

/** L'informativa che accompagna il contratto del cliente individuale. */
function letteraPrivacy() {
  return [
    ...intestazionePrivacy('Informativa sul trattamento dei dati personali'),
    { t: 'p', x: 'Questa lettera ti spiega quali tuoi dati tratto durante il percorso di coaching, perché, per quanto tempo e che cosa puoi chiedermi. È scritta per essere letta, non per essere archiviata.' },
    { t: 'riga' },
    ...puntiPrivacy({ perEsteso: false }),
    { t: 'h', x: 'g) A chi possono essere comunicati' },
    { t: 'li', x: 'A collaboratori e fornitori che mi supportano (gestionale, posta elettronica, archiviazione documenti), che trattano i dati per mio conto e su mia istruzione.' },
    { t: 'li', x: 'A ICF – International Coaching Federation, per le verifiche sull\'effettivo svolgimento delle sessioni ai fini delle mie credenziali: data, durata e nominativo. Mai i contenuti.' },
    { t: 'li', x: 'All\'Autorità Giudiziaria, quando la legge lo impone.' },
    { t: 'p', x: 'I tuoi dati non vengono venduti né ceduti a nessun altro.' },
    ...DIRITTI,
    { t: 'riga' },
    { t: 'p', x: 'Ho letto e compreso questa informativa.' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma' },
    ...CONSENSO_INFORMATIVE,
  ];
}

/**
 * LA LIBERATORIA DEL PARTECIPANTE — per i progetti interamente finanziati dal
 * Committente, che secondo Germano (27/08) sono il caso più frequente.
 * Il partecipante non firma nessun contratto: il contratto è fra Noesys e
 * l'azienda. Ma i suoi dati li tratto io, quindi l'informativa la deve avere —
 * e con dentro, per esteso, la parte sull'intelligenza artificiale.
 *
 * 🔴 LA RIGA CHE CONTA È «g)»: al Committente non va MAI un contenuto di
 *    sessione, e mai una valutazione sulla persona. Non è una cortesia: è la
 *    riservatezza ICF del contratto e il divieto dell'AI Act sulle emozioni.
 *
 * ⭐ DUE VERSIONI, e l'asse è INDIVIDUALE ↔ COLLETTIVO (Germano, 29/08).
 *    Un partecipante a un progetto `individuale`/`individuale-multiplo` ha un
 *    percorso individuale anche se sta dentro un progetto strutturato: per lui
 *    non cambia niente. In un `team`/`group` cambiano DUE cose insieme:
 *      1. al Committente NON vanno solo date, presenze e ore: vanno anche i
 *         RISULTATI del percorso — «soltanto» lì sarebbe una frase falsa;
 *      2. il partecipante non è solo tutelato, è anche OBBLIGATO: quello che
 *         sente dagli altri non esce dal gruppo.
 *    ➜ Per questo la versione collettiva cambia titolo: non è più una sola
 *      informativa, porta dentro delle regole che vincolano chi firma.
 */
function liberatoriaPartecipante({ progetto, committente } = {}) {
  const tp = tipoPercorso(progetto && progetto.tipo);
  const nomeProgetto = (progetto && progetto.titolo) || '……………………………………';
  const nomeCommittente = (committente && committente.denominazione) || '……………………………………';
  return [
    ...intestazionePrivacy(tp.collettivo
      ? 'Informativa Privacy e Regole di Riservatezza'
      : 'Informativa e consenso al trattamento dei dati personali'),
    { t: 'p', x: tp.collettivo
      ? `Partecipi a un percorso di coaching ${tp.agg} all'interno del progetto «${nomeProgetto}», promosso da ${nomeCommittente}. Il percorso è a carico dell'azienda, ma il coaching lo fai con me: questa lettera ti spiega quali tuoi dati tratto, perché, per quanto tempo, che cosa l'azienda vede e che cosa no, e quali sono le regole di riservatezza che valgono per tutti i partecipanti.`
      : `Partecipi a un percorso di coaching all'interno del progetto «${nomeProgetto}», promosso da ${nomeCommittente}. Il percorso è a carico dell'azienda, ma il coaching lo fai con me: questa lettera ti spiega quali tuoi dati tratto, perché, per quanto tempo, e che cosa l'azienda vede e che cosa no.` },
    { t: 'riga' },
    ...puntiPrivacy({ perEsteso: true }),
    { t: 'h', x: 'g) Che cosa vede l\'azienda, e che cosa no' },
    ...(tp.collettivo ? [
      { t: 'forte', x: `A ${nomeCommittente} comunico l'andamento formale della partecipazione — le date delle sessioni, la presenza e le ore svolte — e i risultati del percorso.` },
      { t: 'p', x: 'I risultati sono presentati quale esito del lavoro del gruppo e senza riferimento ai singoli partecipanti: non le posizioni individuali, non quello che ciascuno dice o scrive, né alcuna valutazione sulla persona o sul modo di lavorare. Un maggiore livello di dettaglio richiede un accordo specifico, preventivamente approvato dai partecipanti interessati.' },
    ] : [
      { t: 'forte', x: `A ${nomeCommittente} comunico soltanto l'andamento formale della partecipazione: le date delle sessioni, la presenza e le ore svolte.` },
      { t: 'p', x: 'Non comunico i contenuti delle sessioni, i tuoi obiettivi personali, quello che dici o scrivi durante il percorso, né alcuna valutazione sulla tua persona o sul tuo modo di lavorare.' },
    ]),
    { t: 'p', x: 'Nessuno strumento — mio o automatico — viene impiegato per analizzare o dedurre il tuo stato emotivo o psicologico, e nulla del genere viene riferito a chi finanzia il percorso.' },
    { t: 'p', x: 'Gli altri destinatari sono: i collaboratori e fornitori che mi supportano (gestionale, posta elettronica, archiviazione documenti), che trattano i dati per mio conto; ICF – International Coaching Federation, per le verifiche sull\'effettivo svolgimento delle sessioni ai fini delle mie credenziali (data, durata e nominativo: mai i contenuti); l\'Autorità Giudiziaria, quando la legge lo impone.' },
    ...DIRITTI,
    // ⚠️ QUI LA VOCE CAMBIA, ED È VOLUTO: la lettera spiega dandoti del «tu», il
    //    riquadro vincola e parla in forma impersonale. Non è una svista di
    //    stile: è la differenza fra ciò che ti racconto e ciò che ti impegna.
    ...(tp.collettivo ? [
      { t: 'riga' },
      { t: 'h', x: 'Le regole di riservatezza del percorso' },
      { t: 'p', x: 'Le sessioni si svolgono in forma collettiva: quanto ciascuno condivide è noto agli altri partecipanti.' },
      { t: 'forte', x: 'Quanto emerge nelle sessioni non è divulgabile all\'esterno del gruppo, se non quale risultato del lavoro del gruppo. L\'obbligo di riservatezza grava su tutti i partecipanti e permane dopo la conclusione del percorso.' },
      { t: 'p', x: 'Al Committente sono presentati i risultati del percorso, quale esito del lavoro del gruppo e senza riferimento ai singoli partecipanti. Un maggiore livello di dettaglio richiede accordo specifico, preventivamente approvato dai partecipanti interessati.' },
    ] : []),
    { t: 'riga' },
    { t: 'p', x: tp.collettivo
      ? 'Ho letto e compreso questa informativa, acconsento al trattamento dei miei dati nei termini qui descritti, compreso l\'uso di uno strumento automatico che ascolta la sessione per prepararne il resoconto scritto, senza che la sessione venga registrata, e mi impegno a osservare le regole di riservatezza del percorso sopra indicate.'
      : 'Ho letto e compreso questa informativa, e acconsento al trattamento dei miei dati nei termini qui descritti, compreso l\'uso di uno strumento automatico che ascolta la sessione per prepararne il resoconto scritto, senza che la sessione venga registrata.' },
    { t: 'campo', x: 'Nome e Cognome:' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma' },
    ...CONSENSO_INFORMATIVE,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// IL CONTRATTO DEL COMMITTENTE — persona giuridica.
// Germano, 27/08: «Per il committente c'è solo l'opzione a pacchetto, che però
// può essere integralmente a suo carico o co-finanziata dai partecipanti».
// ➜ Due versioni, e la scelta la fa l'Hub confrontando `progetti.quota_totale`
//   con `progetti.quota_committente`: nessuno la digita a mano.
// ⚠️ Qui NON c'è il recesso a 14 giorni e il Foro è quello del Professionista:
//    valgono solo verso un consumatore, e un'azienda non lo è.
// ═══════════════════════════════════════════════════════════════════════════
function personaGiuridica({ committente, progetto, nPartecipanti }) {
  const c = committente || {};
  const p = progetto || {};
  const v = (x) => (x && String(x).trim() ? String(x).trim() : null);
  const riga = (et, val) => (val ? { t: 'p', x: `${et} ${val}` } : { t: 'campo', x: et });

  const tp = tipoPercorso(p.tipo);
  const totale = p.quota_totale == null ? null : Number(p.quota_totale);
  const dalCommittente = p.quota_committente == null ? null : Number(p.quota_committente);
  const daiPartecipanti = (totale != null && dalCommittente != null) ? totale - dalCommittente : null;
  const cofinanziato = daiPartecipanti != null && daiPartecipanti > 0;
  const n = nPartecipanti == null ? '………' : String(nPartecipanti);

  const compensoBlocchi = cofinanziato
    ? [
        { t: 'p', x: `Il compenso complessivo per l'intero progetto è di € ${euro(totale)} + IVA 22%, per un percorso rivolto a ${n} partecipanti.` },
        { t: 'p', x: `Di questo importo, € ${euro(dalCommittente)} + IVA 22% sono a carico del Committente e € ${euro(daiPartecipanti)} + IVA 22% sono a carico dei partecipanti, che li corrispondono direttamente al/la Professionista secondo quanto stabilito nei rispettivi accordi individuali.` },
        { t: 'p', x: 'Il Committente risponde della sola quota a proprio carico. Il mancato pagamento della quota di un partecipante non incide sugli obblighi del Committente né su quelli degli altri partecipanti.' },
      ]
    : [
        { t: 'p', x: `Il compenso complessivo per l'intero progetto è di € ${totale == null ? '……………' : euro(totale)} + IVA 22%, per un percorso rivolto a ${n} partecipanti, ed è interamente a carico del Committente.` },
        { t: 'p', x: 'Nessun corrispettivo è dovuto dai partecipanti.' },
      ];

  return [
    { t: 'titolo', x: 'Accordo per servizi di coaching' },
    { t: 'sottotitolo', x: 'ai sensi degli artt. 2229 e seguenti del Codice Civile e della Legge 14 gennaio 2013, n. 4' },
    { t: 'riga' },
    ...boxProfessionista(),
    { t: 'vuoto', x: 8 },
    { t: 'forte', x: 'Il Committente' },
    riga('Denominazione:', v(c.denominazione)),
    riga('P. IVA / Codice fiscale:', v(c.partita_iva) || v(c.codice_fiscale)),
    riga('Sede:', [v(c.indirizzo), v(c.cap), v(c.citta), v(c.provincia) ? '(' + v(c.provincia) + ')' : null].filter(Boolean).join(', ') || null),
    riga('PEC / Codice SDI:', v(c.pec) || v(c.codice_sdi) || v(c.pec_sdi)),
    riga('Referente:', [v(c.referente), v(c.ruolo) ? '— ' + v(c.ruolo) : null].filter(Boolean).join(' ') || null),
    riga('Email del referente:', v(c.email)),
    { t: 'vuoto', x: 6 },
    { t: 'p', x: `Il Committente affida a Noesys Professional Coaching, nella persona di Germano Guerriero (di seguito il/la Professionista o il Coach), un percorso di coaching rivolto ai propri collaboratori nell'ambito del progetto «${v(p.titolo) || '……………………'}», secondo modalità conformi agli standard e al Codice Etico di ICF – International Coaching Federation.` },
    { t: 'riga' },

    { t: 'h', x: '1. Oggetto' },
    { t: 'p', x: tp.collettivo
      ? `Il/la Professionista si impegna a erogare un percorso di coaching ${tp.agg}, rivolto a ${n} partecipanti indicati dal Committente, articolato in sessioni che si svolgono con tutti i partecipanti insieme.`
      : `Il/la Professionista si impegna a erogare un percorso di coaching ${tp.agg} a ${n} partecipanti indicati dal Committente, articolato in sessioni concordate con ciascuno di essi.` },
    { t: 'p', x: 'Il Committente comunica al/la Professionista i nominativi dei partecipanti e garantisce di averli informati della propria adesione al progetto.' },

    { t: 'h', x: '2. Che cos\'è il coaching, e che cosa non è' },
    { t: 'p', x: 'Il coaching è un processo di collaborazione in cui il partecipante, guidato dal Coach, mette a fuoco i propri obiettivi e le strade per raggiungerli.' },
    { t: 'p', x: 'Non è una terapia psicologica, una consulenza specialistica né un intervento di counseling. Non è uno strumento di valutazione del personale: il/la Professionista non esprime giudizi sui partecipanti e non fornisce al Committente elementi utilizzabili a fini di valutazione, selezione o provvedimenti disciplinari.' },
    { t: 'p', x: 'Il coaching è una prestazione d\'opera intellettuale: il Coach si impegna sui mezzi, non sul risultato. Le decisioni e le azioni restano dei partecipanti e del Committente, che ne sono responsabili.' },

    { t: 'h', x: '3. Come si svolgono le sessioni' },
    { t: 'p', x: tp.collettivo
      ? 'Le sessioni si tengono negli orari concordati fra il/la Professionista, il Committente e i partecipanti, in videochiamata oppure di persona, e si svolgono con tutti i partecipanti insieme. In entrambi i casi si svolgono in un luogo riservato, senza altre persone presenti se non dichiarate.'
      : 'Le sessioni si tengono negli orari concordati con ciascun partecipante, in videochiamata oppure di persona. In entrambi i casi si svolgono in un luogo riservato, senza altre persone presenti se non dichiarate.' },
    { t: 'p', x: 'Chi non può presentarsi avvisa almeno 24 ore prima. Una sessione disdetta oltre quel termine si considera erogata.' },
    { t: 'p', x: 'Le sessioni non vengono registrate: non viene creato né conservato alcun file audio o video. È una regola che discende dal Codice Etico di ICF.' },

    { t: 'h', x: '4. Che cosa riceve il Committente' },
    // ⭐ LE DUE FACCE, e le separa `collettivo` (Germano, 29/08).
    //    In un progetto individuale/individuale-multiplo non esiste un risultato
    //    di gruppo: al Committente vanno soltanto date, presenze e ore, ed è
    //    quello che questo articolo ha sempre detto.
    //    In un team/group un output del gruppo esiste, e presentarlo È il
    //    servizio: dire «soltanto date, presenze e ore» sarebbe falso, e la
    //    stessa bugia starebbe anche nell'art. 7 del contratto del partecipante
    //    e nel punto g) della sua informativa. Le tre frasi si muovono insieme.
    ...(tp.collettivo ? [
      { t: 'forte', x: 'Il Committente riceve l\'andamento formale del progetto — le date delle sessioni, le presenze e le ore erogate — e i risultati del percorso.' },
      { t: 'p', x: 'I risultati sono presentati quale esito del lavoro del gruppo e senza riferimento ai singoli partecipanti: non le posizioni individuali, non ciò che ciascuno dice o scrive, né alcuna valutazione sulla loro persona o sul loro modo di lavorare. Un maggiore livello di dettaglio richiede accordo specifico, preventivamente approvato dai partecipanti interessati.' },
    ] : [
      { t: 'forte', x: 'Il Committente riceve l\'andamento formale del progetto: le date delle sessioni, le presenze e le ore erogate.' },
      { t: 'p', x: 'Non riceve i contenuti delle sessioni, gli obiettivi personali dei partecipanti, ciò che essi dicono o scrivono durante il percorso, né alcuna valutazione sulla loro persona o sul loro modo di lavorare.' },
      // ⚠️ QUESTA FRASE STA SOLO NEL RAMO INDIVIDUALE, e il motivo è sostanziale.
      //    Dice che le restituzioni sono «eventuali» e «concordate»: giusto dove
      //    il servizio sono le sessioni e una restituzione è un di più. In un
      //    team i risultati NON sono eventuali — sono ciò che il Committente
      //    compra — e lasciarla lì li farebbe tornare facoltativi, svuotando il
      //    paragrafo appena scritto sopra.
      { t: 'p', x: 'Eventuali restituzioni al Committente sull\'andamento complessivo del progetto sono concordate preventivamente e riguardano il progetto, non le singole persone.' },
    ]),
    { t: 'p', x: 'Nessuno strumento viene impiegato per analizzare o dedurre lo stato emotivo o psicologico dei partecipanti, e nulla del genere viene riferito al Committente.' },

    { t: 'h', x: '5. Compenso' },
    ...compensoBlocchi,
    { t: 'p', x: 'Il compenso si salda entro 15 giorni dalla data della fattura, con bonifico sul conto indicato in fattura. Il compenso non è in alcun modo condizionato all\'esito del percorso.' },

    { t: 'h', x: '6. Durata e recesso' },
    { t: 'p', x: `Il progetto ha inizio il ${p.data_inizio ? dataIt(p.data_inizio) : '………………'} e si considera concluso al termine delle sessioni previste.` },
    { t: 'p', x: 'Ai sensi dell\'art. 2237 c.c. entrambe le parti possono recedere in qualsiasi momento, con preavviso scritto.' },
    { t: 'li', x: 'Se recede il Committente, deve il compenso per le sessioni già erogate e le spese sostenute.' },
    { t: 'li', x: 'Se recede il/la Professionista, il Committente non deve nulla per le sessioni non erogate e non ha diritto ad alcun risarcimento.' },
    { t: 'p', x: 'Il/la Professionista può proporre di interrompere il percorso di un singolo partecipante quando ritiene che non stia portando beneficio: in tal caso il compenso è dovuto in proporzione alle sessioni erogate.' },

    { t: 'h', x: '7. Riservatezza e trattamento dei dati' },
    { t: 'p', x: 'Tutto ciò che i partecipanti condividono durante il percorso è riservato, nei termini dell\'art. 4.' },
    { t: 'p', x: 'Rispetto ai dati personali dei partecipanti il/la Professionista agisce come titolare autonomo del trattamento: consegna a ciascun partecipante la propria informativa e ne raccoglie i consensi. Il Committente si impegna a consentire ai partecipanti di ricevere e sottoscrivere tale informativa prima della prima sessione.' },

    { t: 'h', x: '8. Strumenti di intelligenza artificiale' },
    { t: 'nota', x: 'Informativa resa ai sensi dell\'art. 13 della Legge 23 settembre 2025, n. 132.' },
    { t: 'p', x: 'Il/la Professionista si avvale di strumenti di intelligenza artificiale con funzione di supporto organizzativo e documentale. Qualunque sia lo strumento utilizzato valgono sempre queste regole:' },
    { t: 'li', x: 'l\'intelligenza artificiale propone, il/la Professionista decide: nessun risultato viene utilizzato o consegnato senza la sua revisione;' },
    { t: 'li', x: 'la responsabilità della prestazione resta interamente del/la Professionista;' },
    { t: 'li', x: 'nessuno strumento viene impiegato per analizzare o dedurre lo stato emotivo o psicologico dei partecipanti, né per formulare valutazioni sulle persone;' },
    { t: 'li', x: 'i dati non vengono utilizzati per addestrare sistemi di intelligenza artificiale.' },

    { t: 'h', x: '9. Controversie e Foro competente' },
    { t: 'p', x: 'Per ogni controversia inerente il presente accordo è competente in via esclusiva il Foro di Como.' },

    // Stesso difetto trovato dal vivo il 29/08 sul contratto del partecipante:
    // qui l'ultima pagina si apriva con la sola riga della firma. Vedi 'tieni'.
    { t: 'tieni', x: 380 },
    { t: 'h', x: '10. Disposizioni finali' },
    { t: 'p', x: 'Il presente accordo sostituisce ogni intesa precedente, scritta o verbale, fra le parti in materia di coaching. Le modifiche sono valide solo se scritte e sottoscritte da entrambe le parti. Per quanto non previsto si rinvia agli artt. 2229–2238 c.c.' },

    { t: 'riga' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Per il Committente' },
    { t: 'firmaProf', x: 'Il/la Professionista' },

    { t: 'h', x: 'Approvazione specifica delle clausole' },
    { t: 'p', x: 'Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., il Committente dichiara di approvare espressamente le clausole: 2 (natura del servizio e limiti di responsabilità), 4 (che cosa riceve il Committente), 5 (compenso), 6 (durata e recesso), 7 (riservatezza), 9 (foro competente).' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Per il Committente' },
  ];
}

/** Una DATE del database in data italiana. ⚠️ Mai `itDate` su un timestamp. */
function dataIt(d) {
  const s = String(d).slice(0, 10);
  const [a, m, g] = s.split('-');
  return `${g}/${m}/${a}`;
}

/**
 * IL CONTRATTO DEL PARTECIPANTE A UN PROGETTO CO-FINANZIATO.
 *
 * ⭐ Regola di Germano (27/08): «nel contratto dei partecipanti a un progetto
 *    farei esplicitamente riferimento al Progetto stesso e quindi ai suoi
 *    contenuti e durata — sono tutte informazioni che vengono acquisite nelle
 *    fasi antecedenti il kick off meeting».
 * ➜ Il PERIMETRO non si ripete qui: lo definisce il progetto, e l'art. 1 ci
 *   rimanda nominandolo. Scriverlo due volte vorrebbe dire due perimetri che
 *   prima o poi divergono.
 *
 * ⚠️ Non nasce da un percorso, come quello del cliente individuale: i
 *    partecipanti a un progetto NON hanno un percorso collegato (verificato sui
 *    dati veri il 27/08). Nasce dalla PARTECIPAZIONE, che è dove vive la quota.
 *
 * ⚠️ Il partecipante è una persona fisica che firma da consumatore, anche se la
 *    maggior parte la paga la sua azienda: i 14 giorni e il foro del consumatore
 *    valgono per lui esattamente come per un cliente individuale.
 */
function partecipanteProgetto({ cliente, progetto, committente, quota }) {
  const p = progetto || {};
  const tp = tipoPercorso(p.tipo);
  const nomeProgetto = (p.titolo && String(p.titolo).trim()) || '……………………';
  const nomeCommittente = (committente && committente.denominazione) || '……………………';
  const obiettivo = (p.obiettivo_smarter && String(p.obiettivo_smarter).trim())
    || (p.obiettivi && String(p.obiettivi).trim()) || null;
  const dal = p.data_inizio ? dataIt(p.data_inizio) : null;
  const al = p.data_fine ? dataIt(p.data_fine) : (p.data_meta ? dataIt(p.data_meta) : null);

  // Contenuti e durata: si stampano se il progetto li ha. Se non li ha, il
  // contratto NON inventa un perimetro — dice dove sta scritto e chi lo comunica.
  const perimetro = [];
  if (obiettivo) {
    perimetro.push({ t: 'forte', x: 'Obiettivo del progetto' });
    perimetro.push({ t: 'p', x: obiettivo });
  }
  if (dal) {
    perimetro.push({ t: 'forte', x: 'Periodo' });
    perimetro.push({ t: 'p', x: al ? `Dal ${dal} al ${al}.` : `Dal ${dal}.` });
  }
  if (!perimetro.length) {
    perimetro.push({ t: 'p', x: 'Contenuti, obiettivi e durata del percorso sono quelli definiti dal progetto nelle fasi che precedono l\'incontro di avvio, e vengono comunicati al/la Cliente prima della prima sessione.' });
  }

  return [
    { t: 'titolo', x: 'Accordo per servizi di coaching' },
    { t: 'sottotitolo', x: 'ai sensi degli artt. 2229 e seguenti del Codice Civile e della Legge 14 gennaio 2013, n. 4' },
    { t: 'riga' },
    ...boxProfessionista(),
    { t: 'vuoto', x: 8 },
    ...boxCliente(cliente),
    { t: 'vuoto', x: 6 },
    { t: 'p', x: `Il/la sottoscritto/a (di seguito il/la Cliente) partecipa al progetto «${nomeProgetto}», promosso da ${nomeCommittente}, e affida a Noesys Professional Coaching, nella persona di Germano Guerriero (di seguito il/la Professionista o il Coach), il proprio percorso di coaching all'interno di quel progetto, secondo modalità conformi agli standard e al Codice Etico di ICF – International Coaching Federation.` },
    { t: 'riga' },

    { t: 'h', x: '1. Oggetto: il percorso previsto dal progetto' },
    { t: 'p', x: tp.collettivo
      ? `Il/la Professionista si impegna a erogare il percorso di coaching ${tp.agg} previsto dal progetto «${nomeProgetto}», di cui il/la Cliente è partecipante. Le sessioni si svolgono con tutti i partecipanti insieme.`
      : `Il/la Professionista si impegna a erogare al/la Cliente il percorso di coaching ${tp.agg} previsto dal progetto «${nomeProgetto}».` },
    { t: 'p', x: 'Contenuti, obiettivi e durata del percorso sono quelli del progetto: non vengono ridefiniti in questo accordo, che ne segue il perimetro.' },
    ...perimetro,

    { t: 'h', x: '2. Che cos\'è il coaching, e che cosa non è' },
    ...COSA_E_IL_COACHING,
    { t: 'p', x: 'Il coaching non è uno strumento di valutazione del personale: il/la Professionista non esprime giudizi sul/la Cliente e non fornisce al Committente elementi utilizzabili a fini di valutazione, selezione o provvedimenti disciplinari.' },

    { t: 'h', x: '3. Come si svolgono le sessioni' },
    ...COME_SI_SVOLGONO,

    { t: 'h', x: '4. Compenso' },
    { t: 'p', x: `La quota a carico del/la Cliente è di € ${quota == null ? '……………' : euro(quota)} + IVA 22% per l'intero percorso previsto dal progetto.` },
    { t: 'p', x: `La restante parte del compenso è a carico di ${nomeCommittente}, secondo l'accordo separato stipulato fra il/la Professionista e il Committente. Il/la Cliente non risponde di quella parte.` },
    { t: 'p', x: 'Il compenso si salda entro 15 giorni dalla data della fattura, con bonifico sul conto indicato in fattura. Il compenso non è in alcun modo condizionato all\'esito del percorso.' },

    { t: 'h', x: '5. I primi 14 giorni: il diritto di ripensamento' },
    ...ripensamento14Giorni(),

    { t: 'h', x: '6. Recesso' },
    { t: 'p', x: 'Ai sensi dell\'art. 2237 c.c. entrambe le parti possono recedere in qualsiasi momento, con preavviso scritto.' },
    { t: 'li', x: 'Se recede il/la Cliente, deve la parte di quota corrispondente alle sessioni già svolte.' },
    { t: 'li', x: 'Se recede il/la Professionista, il/la Cliente non deve nulla per le sessioni non svolte e non ha diritto ad alcun risarcimento.' },
    { t: 'p', x: 'La conclusione del progetto da parte del Committente non priva il/la Cliente delle sessioni già concordate e non ancora svolte, salvo diverso accordo scritto fra le parti.' },

    { t: 'h', x: '7. Riservatezza: che cosa vede l\'azienda, e che cosa no' },
    // 🔴 IN UN PERCORSO COLLETTIVO LA RISERVATEZZA PIENA NON ESISTE, e prometterla
    // sarebbe una frase falsa in un contratto: quello che uno dice in sessione lo
    // sentono gli altri. E non è falsa solo quella: era falso anche il «soltanto
    // date, presenze e ore», perché in un team al Committente i RISULTATI del
    // percorso si presentano — è il senso stesso del team coaching.
    // ✅ TESTO DATO DA GERMANO IL 29/08 (era una toppa mia del 28/08). Tre punti,
    //    nelle sue parole: quanto emerge in sessione non esce dalle sessioni se
    //    non come output del gruppo · al Committente i risultati vanno sempre
    //    senza entrare nello specifico dei singoli, salvo accordi presi di volta
    //    in volta e approvati dai partecipanti · l'obbligo vale anche per loro.
    // ⚠️ Registro LEGALE, non esortativo: la prima stesura diceva al partecipante
    //    «devi poterti esprimere liberamente» e Germano l'ha bocciata — quella è
    //    la RAGIONE della clausola, non la clausola.
    ...(tp.collettivo ? [
      { t: 'p', x: 'Le sessioni di questo percorso si svolgono in forma collettiva. Quanto il/la Cliente condivide durante una sessione è pertanto noto agli altri partecipanti.' },
      { t: 'forte', x: 'Quanto emerge nelle sessioni non è divulgabile all\'esterno del gruppo, se non quale risultato del lavoro del gruppo. L\'obbligo di riservatezza grava su tutti i partecipanti e permane dopo la conclusione del percorso.' },
      { t: 'p', x: 'Al Committente sono presentati i risultati del percorso, quale esito del lavoro del gruppo e senza riferimento ai singoli partecipanti: non le posizioni individuali, non ciò che ciascuno dice o scrive, né alcuna valutazione sulla persona o sul modo di lavorare. Un maggiore livello di dettaglio richiede accordo specifico, preventivamente approvato dai partecipanti interessati.' },
    ] : [
      { t: 'forte', x: 'Al Committente vengono comunicati soltanto le date delle sessioni, la presenza e le ore svolte.' },
      { t: 'p', x: 'Non vengono comunicati i contenuti delle sessioni, gli obiettivi personali del/la Cliente, ciò che dice o scrive durante il percorso, né alcuna valutazione sulla sua persona o sul suo modo di lavorare.' },
    ]),
    { t: 'p', x: tp.collettivo
      ? 'Per quanto riguarda il/la Professionista vale la riservatezza piena: non rivela ad alcuno quanto emerge nelle sessioni e non lo usa per fini propri, salvo:'
      : 'Per il resto vale la riservatezza piena: il Coach non rivela ad alcuno quanto emerge nelle sessioni e non lo usa per fini propri, salvo:' },
    { t: 'li', x: 'consenso scritto del/la Cliente;' },
    { t: 'li', x: 'obblighi di legge o richieste dell\'Autorità;' },
    { t: 'li', x: 'verifiche di ICF sull\'effettivo svolgimento delle sessioni, ai fini delle credenziali del Coach (data, durata e nominativo: mai i contenuti);' },
    { t: 'li', x: 'situazioni in cui emerga un pericolo grave e attuale per l\'incolumità di qualcuno.' },

    { t: 'h', x: '8. Strumenti di intelligenza artificiale' },
    ...INTELLIGENZA_ARTIFICIALE,

    { t: 'h', x: '9. Controversie e Foro competente' },
    { t: 'p', x: 'Per ogni controversia inerente il presente accordo è competente il Foro del luogo di residenza o di domicilio elettivo del/la Cliente, quando questi è un consumatore.' },

    // Germano, 29/08: la pagina 5 si apriva con le sole firme. L'art. 10 e tutto
    // ciò che segue viaggiano insieme: o ci stanno, o cominciano da pagina nuova.
    { t: 'tieni', x: 380 },
    { t: 'h', x: '10. Disposizioni finali' },
    { t: 'p', x: `Il presente accordo riguarda il solo rapporto fra il/la Cliente e il/la Professionista. L'accordo fra il/la Professionista e ${nomeCommittente} è separato e non attribuisce al/la Cliente obblighi ulteriori rispetto a quelli qui indicati. Le modifiche sono valide solo se scritte e sottoscritte da entrambe le parti. Per quanto non previsto si rinvia agli artt. 2229–2238 c.c. L'informativa sul trattamento dei dati personali, consegnata insieme a questo accordo, ne è parte integrante.` },

    { t: 'riga' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma del/la Cliente' },
    { t: 'firmaProf', x: 'Firma del/la Professionista' },

    { t: 'h', x: 'Approvazione specifica delle clausole' },
    { t: 'p', x: 'Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., il/la Cliente dichiara di aver preso visione dell\'intero testo e di approvare espressamente le clausole: 2 (natura del servizio e limiti di responsabilità), 3 (svolgimento e resoconto), 4 (compenso), 5 (avvio immediato), 6 (recesso), 7 (riservatezza), 8 (intelligenza artificiale).' },
    { t: 'firma', x: 'Luogo e data' },
    { t: 'firma', x: 'Firma del/la Cliente' },

    ...allegatoRecesso(),
  ];
}

module.exports = {
  personaFisica, personaGiuridica, partecipanteProgetto,
  letteraPrivacy, liberatoriaPartecipante,
  compenso, PROFESSIONISTA,
};
