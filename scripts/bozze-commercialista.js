/**
 * LE BOZZE PER IL COMMERCIALISTA — tredici documenti, stampati in bianco e nero.
 *
 * ⭐ L'IDEA È DI GERMANO (29/08/2026): «i contratti per Adolfo li stampo in
 *    bianco e nero. Voglio che il testo sia in grigio medio e le varianti —
 *    quelle da leggere — siano in nero».
 *    Il senso: i documenti si somigliano moltissimo (in un contratto cambiano
 *    dai 3 ai 9 paragrafi su 70-95). Far rileggere tredici volte le stesse
 *    frasi è il modo migliore per far leggere male le poche che cambiano.
 *
 * 🔴 IL COLORE NON SI SCRIVE A MANO, SI CALCOLA. Se marcassi io i paragrafi uno
 *    per uno, alla prima frase che cambiamo l'evidenziazione resterebbe indietro
 *    e direbbe una bugia — e una bugia in un documento legale è peggio di
 *    nessuna evidenziazione. Qui il programma costruisce TUTTE le versioni di
 *    una famiglia, tiene per comune solo ciò che compare in ognuna, e annerisce
 *    il resto. Cambi un testo domani: l'evidenziazione si aggiorna da sola.
 *
 * ⚠️ Una famiglia con UNA SOLA versione (l'informativa del Cliente) NON si
 *    stampa in grigio: non ha varianti, quindi non c'è niente da saltare e va
 *    letta tutta. Per quelle l'interruttore resta spento.
 *
 * ⛔ Il grigio vive solo qui. Le rotte dell'Hub non passano mai
 *    `evidenziaVarianti`: il contratto che va a un cliente vero è nero su bianco.
 *
 * Uso:  node scripts/bozze-commercialista.js [cartella-di-uscita]
 */
const fs = require('fs');
const path = require('path');
const T = require('../server/contratto-testi');
const contratto = require('../server/contratto');

// ── I dati finti. Devono sembrare finti: un contratto di esempio che porta un
//    nome verosimile prima o poi viene scambiato per un contratto vero.
const CLIENTE = { nome: 'MARIO', cognome: 'ROSSI', name: 'MARIO ROSSI' };
const COMMITTENTE = { denominazione: 'AZIENDA ESEMPIO S.R.L.' };
const percorso = (modalita) => ({
  tipo: 'Individuale', modalita, prezzo: 1200, n_sessioni_previste: 8,
  data_inizio: '2026-10-01', prestazione_scambio: 'la prestazione concordata',
});
const progetto = (tipo, quotaCommittente, parametri) => ({
  tipo, titolo: 'PROGETTO ESEMPIO', data_inizio: '2026-10-01',
  quota_totale: 2000, quota_committente: quotaCommittente,
  parametri: parametri || null,
});

// I parametri di successo entrano nel contratto del Committente SOLO se definiti.
// ⭐ Perciò stanno in DUE delle quattro versioni e non in tutte e quattro: così
//    l'articolo risulta una VARIANTE e finisce in nero, invece di sembrare testo
//    comune da saltare. È un articolo che il commercialista non ha mai letto.
const PARAMETRI = '- Riduzione del turnover del reparto\n'
  + '- Riunioni più brevi e con decisioni prese\n'
  + '- Feedback tra pari almeno mensile';

// Quante sedute. Le tre forme che il contratto sa dire, tutte rappresentate:
// un percorso condiviso, percorsi individuali tutti uguali, percorsi individuali
// DIVERSI (che si elencano per nome — regola di Germano del 29/08).
const SEDUTE_CONDIVISE  = { condivise: 10 };

// Il piano delle rate. ⭐ L'innesco dice quando si EMETTE la fattura, i giorni
// sono il termine di PAGAMENTO (Germano, 30/08). Entra solo nei pacchetti e nei
// progetti strutturati: uno Standard a sessione si fattura ogni mese a rimessa
// diretta e non ha rate.
// ⚠️ Sta in DUE delle quattro versioni del contratto Committente, come i
//    parametri: così risulta una variante e finisce in NERO, invece di sembrare
//    testo comune da saltare. Il commercialista non l'ha mai letto.
const RATE_PROGETTO = [
  { etichetta: 'Acconto',       importo: 600, innesco: 'firma', giorni: 30 },
  { etichetta: 'Metà percorso', importo: 800, innesco: 'meta',  giorni: 30 },
  { etichetta: 'Saldo',         importo: 600, innesco: 'fine',  giorni: 30 },
];
const RATE_PACCHETTO = [
  { etichetta: 'Acconto', importo: 600, innesco: 'firma', giorni: 30 },
  { etichetta: 'Saldo',   importo: 600, innesco: 'fine',  giorni: 30 },
];
const RATE_QUOTA = [{ etichetta: 'Quota', importo: 500, innesco: 'firma', giorni: 30 }];
const SEDUTE_UGUALI     = { individuali: [{ nome: 'MARIO ROSSI', n: 6 }, { nome: 'ANNA BIANCHI', n: 6 }] };
const SEDUTE_DIVERSE    = { individuali: [{ nome: 'MARIO ROSSI', n: 8 }, { nome: 'ANNA BIANCHI', n: 5 }] };

// ── LE CINQUE FAMIGLIE. Una famiglia = documenti che si confrontano fra loro.
const FAMIGLIE = [
  {
    cartella: 'Persona Fisica',
    versioni: [
      ['Contratto — Standard a sessione.pdf',   () => T.personaFisica({ cliente: CLIENTE, percorso: percorso('Standard') })],
      ['Contratto — Pacchetto.pdf',             () => T.personaFisica({ cliente: CLIENTE, percorso: percorso('Pacchetto'), rate: RATE_PACCHETTO })],
      ['Contratto — Pro bono.pdf',              () => T.personaFisica({ cliente: CLIENTE, percorso: percorso('Pro bono') })],
      ['Contratto — Scambio di servizi.pdf',    () => T.personaFisica({ cliente: CLIENTE, percorso: percorso('Scambio servizi') })],
    ],
  },
  {
    cartella: 'Persona Fisica',
    versioni: [
      ['Contratto — Partecipante a progetto, percorso individuale.pdf', () => T.partecipanteProgetto({ cliente: CLIENTE, progetto: progetto('individuale-multiplo', 1500), committente: COMMITTENTE, quota: 500, nSessioni: 6, rate: RATE_QUOTA })],
      ['Contratto — Partecipante a progetto, percorso collettivo.pdf',  () => T.partecipanteProgetto({ cliente: CLIENTE, progetto: progetto('team', 1500),                committente: COMMITTENTE, quota: 500, nSessioni: 10 })],
    ],
  },
  {
    cartella: 'Persona Fisica',
    versioni: [
      ['Informativa privacy — Cliente.pdf', () => T.letteraPrivacy()],
    ],
  },
  {
    cartella: 'Persona Fisica',
    versioni: [
      ['Informativa privacy — Partecipante, percorso individuale.pdf',                        () => T.liberatoriaPartecipante({ progetto: progetto('individuale-multiplo', 1500), committente: COMMITTENTE })],
      ['Informativa Privacy e Regole di Riservatezza — Partecipante, percorso collettivo.pdf', () => T.liberatoriaPartecipante({ progetto: progetto('team', 1500),                committente: COMMITTENTE })],
    ],
  },
  {
    cartella: 'Persona Giuridica',
    versioni: [
      // ⚠️ Le combinazioni sono incrociate di proposito: parametri sì/no e sedute
      //    uguali/diverse compaiono ciascuna in due versioni, così ogni frase che
      //    un contratto vero può contenere sta almeno in un documento — e risulta
      //    una variante, quindi in NERO, invece di sembrare testo da saltare.
      ['Contratto Committente — interamente a suo carico, percorso individuale.pdf',      () => T.personaGiuridica({ committente: COMMITTENTE, progetto: progetto('individuale-multiplo', 2000, PARAMETRI), nPartecipanti: 2, sessioni: SEDUTE_UGUALI })],
      ['Contratto Committente — interamente a suo carico, percorso collettivo.pdf',       () => T.personaGiuridica({ committente: COMMITTENTE, progetto: progetto('team', 2000),                          nPartecipanti: 4, sessioni: SEDUTE_CONDIVISE, rate: RATE_PROGETTO })],
      ['Contratto Committente — co-finanziato dai partecipanti, percorso individuale.pdf', () => T.personaGiuridica({ committente: COMMITTENTE, progetto: progetto('individuale-multiplo', 1500),           nPartecipanti: 2, sessioni: SEDUTE_DIVERSE })],
      ['Contratto Committente — co-finanziato dai partecipanti, percorso collettivo.pdf',  () => T.personaGiuridica({ committente: COMMITTENTE, progetto: progetto('team', 1500, PARAMETRI),                nPartecipanti: 4, sessioni: SEDUTE_CONDIVISE, rate: RATE_PROGETTO })],
    ],
  },
];

/**
 * L'impronta di un blocco: due blocchi sono «lo stesso» se coincidono tipo e testo.
 *
 * ⚠️ CON UN'ECCEZIONE, e senza costava metà documento. Da quando il contratto del
 *    Committente ha un articolo che può non esserci (i parametri di successo), i
 *    titoli sotto cambiano NUMERO da una versione all'altra: «5. Compenso»
 *    diventa «6. Compenso». Confrontandoli com'erano risultavano tutti diversi, e
 *    tutta la seconda metà del documento finiva in nero — cioè «leggimi» — quando
 *    invece non era cambiata una parola. Visto contando: 28 blocchi evidenziati
 *    diventavano 71.
 * ➜ Per i TITOLI si confronta il testo, non il numero: quello lo mette il
 *   programma ed è una conseguenza, non una modifica.
 */
const impronta = (b) => {
  const testo = b.x == null ? '' : String(b.x);
  return b.t + ' ' + (b.t === 'h' ? testo.replace(/^\d+\.\s*/, '') : testo);
};

/**
 * Marca come `variante` ogni blocco che NON compare in tutte le versioni.
 * ⚠️ Il confronto è sull'impronta, non sulla posizione: un paragrafo che si
 *    sposta resta comune, ed è giusto — non è cambiato, si è solo spostato.
 */
function marcaVarianti(versioni) {
  const impronte = versioni.map(v => new Set(v.blocchi.map(impronta)));
  const inTutte = (b) => impronte.every(s => s.has(impronta(b)));
  for (const v of versioni) {
    for (const b of v.blocchi) {
      // I blocchi senza testo (riga, vuoto, tieni) non si evidenziano mai:
      // colorare una linea di separazione non direbbe niente a nessuno.
      if (b.x == null) continue;
      if (!inTutte(b)) b.variante = true;
    }
  }
  return versioni.reduce((n, v) => n + v.blocchi.filter(b => b.variante).length, 0);
}

/** Il cartello in cima, che spiega il grigio. Senza, il colore è un enigma. */
function legenda(quante) {
  return [
    { t: 'forte', x: `Bozza per il controllo legale. Questo documento esiste in ${quante} versioni, quasi identiche fra loro.`, variante: true },
    { t: 'forte', x: 'Le parti in NERO sono le sole che cambiano da una versione all\'altra: in ciascun documento basta leggere quelle. Tutto ciò che è in grigio è identico in tutte le versioni.', variante: true },
    { t: 'riga' },
  ];
}

(async () => {
  const uscita = process.argv[2] || path.join(__dirname, '..', 'bozze');
  let totale = 0;
  for (const fam of FAMIGLIE) {
    const versioni = fam.versioni.map(([nome, fn]) => ({ nome, blocchi: fn() }));
    const evidenzia = versioni.length > 1;
    let nVar = 0;
    if (evidenzia) nVar = marcaVarianti(versioni);
    for (const v of versioni) {
      const blocchi = evidenzia ? [...legenda(versioni.length), ...v.blocchi] : v.blocchi;
      const pdf = await contratto.costruisci(blocchi, { firmato: true, evidenziaVarianti: evidenzia });
      const dir = path.join(uscita, fam.cartella);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, v.nome), pdf);
      const q = v.blocchi.filter(b => b.variante).length;
      console.log(`  ${fam.cartella}/${v.nome}`);
      console.log(`      ${(pdf.length / 1024).toFixed(0)} KB · ${v.blocchi.length} blocchi · ${evidenzia ? q + ' in nero' : 'tutto nero (versione unica)'}`);
      totale++;
    }
    if (evidenzia) console.log(`  └─ famiglia di ${versioni.length} versioni, ${nVar} blocchi evidenziati in tutto\n`);
    else console.log('');
  }
  console.log(`✅ ${totale} bozze in ${uscita}`);
})().catch(e => { console.error('🔴', e.stack); process.exit(1); });
