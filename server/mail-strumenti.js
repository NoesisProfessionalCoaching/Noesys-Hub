// LA MAIL CHE ACCOMPAGNA IL LINK DI UNO STRUMENTO — modulo puro (15/09/2026).
//
// L'Hub manda il link di uno strumento con una mail che il coach può ritoccare
// prima dell'invio (finestrella «Manda uno strumento» nella scheda cliente).
// Fino al 15/09 il testo era uno per tutti gli strumenti. Da qui ogni strumento
// può avere il suo: la Matrice dell'Identità ha le parole scritte da Germano
// (mail del 15/09/2026), gli altri tengono il testo di sempre.
//
// I segnaposto: {NOME} il nome del cliente · {LINK} il collegamento ·
// {SCADENZA} la frase sulla durata del link (la compone la pagina, perché
// dipende dalla durata scelta e dalla data della prossima sessione) ·
// {STRUMENTO} il nome dello strumento.
//
// La pagina del cliente riceve questi testi come JSON e fa le sostituzioni nel
// browser; qui `componi()` fa la stessa cosa in Node, per le prove.

const GENERICO = {
  subject: '{STRUMENTO}',
  body: 'Ciao {NOME},\n\n' +
    'qui sotto trovi il collegamento per lavorare sulla {STRUMENTO}: puoi aprirlo quando vuoi e riprenderlo più volte, quello che scrivi resta salvato.\n' +
    '{SCADENZA}\n\n{LINK}\n\nA presto,\nGermano',
};

const TESTI = {
  'matrice-identita': {
    subject: 'La Matrice dell\'Identità — il lavoro per la prossima sessione',
    body: 'Ciao {NOME},\n\n' +
      'al link trovi la Matrice dell\'Identità, l\'esercizio di cui abbiamo parlato. Sono sei domande sull\'idea che ti sei fatto/a di te: cosa sei, cosa potresti diventare, cosa credi che non sarai mai. Serve a mettere in parole convinzioni che di solito restano implicite, e che proprio per questo continuano a lavorare su di te senza che tu le abbia mai guardate in faccia.\n\n' +
      '{LINK}\n\n' +
      'Come compilarla\n\n' +
      '1. Prenditi tempo. Non è un esercizio da mezz\'ora. Scrivi in più momenti, anche in giorni diversi: {SCADENZA}\n\n' +
      '2. Muoviti come preferisci. I riquadri si aprono nell\'ordine, da 1 a 6: non è casuale, e cambia quello che riesci a vedere. Ma non serve aver scritto per andare avanti: se un riquadro non ti dice niente e ti viene un\'idea per il successivo, passa oltre e non perderla. Puoi tornare su quello che hai già scritto quante volte vuoi.\n\n' +
      '3. Vai a fondo. Ogni riquadro ha una domanda principale, in grassetto, e alcune domande di appoggio. Non devi rispondere a tutte: due risposte scritte in profondità valgono più di quattro risposte di superficie. Se una domanda non ti dice niente, saltala.\n\n' +
      '4. Chiudi ogni riquadro con una metafora. Un\'immagine che riassuma quello che hai scritto: un oggetto, un animale, un paesaggio, una figura. Non una definizione, un\'immagine. Scrivila dopo aver risposto, non prima: nasce da quello che hai già messo per iscritto, ed è la parte che useremo di più in sessione.\n\n' +
      '5. Se un riquadro ti mette in difficoltà, lascialo in sospeso e riprendilo, oppure lascialo vuoto e dimmelo. Non è un obbligo, ed è un\'informazione utile anche così.\n\n' +
      'Ultima cosa: ogni riquadro ha anche un nome, che vedrai solo quando ne parleremo insieme. Non te lo mostro ora perché il nome tende a orientare la risposta prima ancora della domanda.\n\n' +
      'Non c\'è una risposta giusta e non c\'è nessun punteggio. Quello che scrivi resta tuo: lo leggeremo insieme nella prossima sessione, ed è lì che l\'esercizio dà il suo risultato.\n\n' +
      'A presto,\nGermano',
    // Per la Matrice il permesso «fino alla prossima sessione» finisce alla
    // mezzanotte che APRE il giorno della sessione (Germano, 15/09), non a fine
    // giornata come per gli altri: in sessione la Matrice si guarda dall'Hub.
    scadenza: {
      sessioneConData:  'il link resta attivo fino alla mezzanotte prima della nostra sessione, {DATA}.',
      sessioneSenzaData: 'il link resta attivo fino alla mezzanotte prima della nostra prossima sessione.',
      ore: 'il link resta attivo per {ORE} ore da quando lo apri.',
    },
    // La Matrice chiude prima della sessione: lo dice anche la finestrella dei permessi.
    chiudePrimaDellaSessione: true,
  },
};

/** I testi che la pagina inietta nel browser (JSON). */
function testiPerPagina() { return { generico: GENERICO, perStrumento: TESTI }; }

/** Il testo di uno strumento, o quello generico. */
function testoDi(tool) { return TESTI[tool] || GENERICO; }

/** La frase sulla scadenza. `durata`: 'ore' | 'sessione'; `data` in lettere, o vuota. */
function fraseScadenza(tool, durata, data, ore) {
  const t = TESTI[tool];
  if (t && t.scadenza) {
    if (durata !== 'sessione') return t.scadenza.ore.replace('{ORE}', String(ore));
    return data ? t.scadenza.sessioneConData.replace('{DATA}', data) : t.scadenza.sessioneSenzaData;
  }
  if (durata !== 'sessione') return 'Resta attivo per ' + ore + ' ore da quando lo apri.';
  return data
    ? 'Resta attivo fino alla nostra prossima sessione, ' + data + ', così lo guardiamo insieme.'
    : 'Resta attivo fino alla nostra prossima sessione: appena fissiamo la data lo guardiamo insieme.';
}

/** Oggetto e corpo, con i segnaposto sostituiti. */
function componi(tool, { nome, strumento, link, scadenza }) {
  const t = testoDi(tool);
  const sost = s => s.replace(/\{NOME\}/g, nome || '').replace(/\{STRUMENTO\}/g, strumento || '')
                     .replace(/\{LINK\}/g, link || '').replace(/\{SCADENZA\}/g, scadenza || '');
  return { subject: sost(t.subject), body: sost(t.body) };
}

/** Vero se, per questo strumento, «fino alla prossima sessione» finisce la mezzanotte prima. */
function chiudePrimaDellaSessione(tool) { return !!(TESTI[tool] && TESTI[tool].chiudePrimaDellaSessione); }

module.exports = { GENERICO, TESTI, testiPerPagina, testoDi, fraseScadenza, componi, chiudePrimaDellaSessione };
