// ═══════════════════════════════════════════════════════════════════════════
// L'INCASSO — FETTA C4 (18/08/2026)
//
// ⭐ L'INCASSO È UNA RIGA APPESA ALLA PROFORMA, non alla rata e non al percorso.
// È la mossa che fa valere un giro solo per tutti i casi: sotto una proforma ci
// possono stare le sessioni di un mese, la rata di un progetto o la rata di un
// pacchetto, ma i soldi arrivano sempre *per un documento*. Appendere l'incasso
// al documento vuol dire scriverlo una volta e vederlo funzionare ovunque.
//
// ⭐ LO STATO NON SI SPUNTA, SI RICAVA (il principio che regge tutta la fetta).
// Non esiste nessuna casella «incassata»: un documento è saldato **perché** gli
// incassi registrati coprono quello che c'era da pagare. Da lì scende tutto il
// resto — la rata dentro quel documento risulta incassata da sé, e togliendo un
// incasso sbagliato torna indietro da sé.
//
// ⭐ SI CONFRONTA IN CENTESIMI INTERI. Coi decimali 0,1 + 0,2 non fa 0,3, e un
// documento saldato al centesimo resterebbe «manca 0,00». Stessa precauzione
// già presa in `fiscale.quoteProgetto()`.
//
// ⚠️ DUE NUMERI CHE NON SI SOMMANO MAI. Qui si maneggiano EURO VERI, quelli che
// arrivano in banca: hanno l'IVA dentro e la ritenuta tolta. I «quattro numeri»
// delle schede sono invece IMPONIBILI. Sommare le due cose darebbe un numero che
// non è né l'uno né l'altro — è la trappola già evitata nella fetta C2.
//
// Modulo puro: niente database, niente rete. Si prova con dei numeri.
// ═══════════════════════════════════════════════════════════════════════════

// Serve solo per la scadenza di una rata: la regola «innesco + giorni» sta lì e
// non si riscrive qui.
const tranche = require('./tranche');

// I soldi si confrontano in centesimi interi, mai in euro con la virgola.
// ⚠️ Gli importi arrivano da PostgreSQL come STRINGHE ('2550.00'): Number() le
// legge, ma un `+` le concatenerebbe. Passare sempre di qui.
function cent(v) {
  return Math.round((Number(v) || 0) * 100);
}

// ⭐ 4.3: si chiamava `euro`, come fiscale.euro, e faceva il contrario (da
//    centesimi a euro, invece di formattare). Ora dice quello che fa.
function daCentesimi(centesimi) {
  return Math.round(Number(centesimi) || 0) / 100;
}

/** Quanto è stato registrato su un documento. */
function sommaIncassi(righe) {
  return daCentesimi((righe || []).reduce((s, r) => s + cent(r && r.importo), 0));
}

/**
 * A che punto è il pagamento di un documento.
 * @param {object} pf  { da_pagare, incassato }
 * @returns {'aperta'|'parziale'|'saldata'}
 * ⚠️ `da_pagare` a zero (o mancante) non vuol dire «saldata»: vuol dire che non
 * si sa quanto chiedere. Un documento senza importo resta aperto, e chi guarda
 * se ne accorge invece di vederlo sparire fra le cose fatte.
 */
function statoPagamento(pf) {
  const dovuto = cent(pf && pf.da_pagare);
  const preso = cent(pf && pf.incassato);
  if (dovuto <= 0) return 'aperta';
  if (preso >= dovuto) return 'saldata';
  return preso > 0 ? 'parziale' : 'aperta';
}

/** Quanto manca ancora. Mai negativo: un documento non si incassa all'indietro. */
function residuo(pf) {
  const manca = cent(pf && pf.da_pagare) - cent(pf && pf.incassato);
  return daCentesimi(manca > 0 ? manca : 0);
}

function saldata(pf) {
  return statoPagamento(pf) === 'saldata';
}

/**
 * ⭐ IL PASSAGGIO 4 — «incassata, e adesso la fattura».
 * Un documento saldato non è finito: finché il numero della fattura emessa in
 * SuperBill non è scritto, quel lavoro è ancora da fare. È l'unica cosa che
 * impedisce a C4 di chiudersi con uno stallo silenzioso (decisione 12).
 * ⚠️ Le annullate non chiedono niente a nessuno.
 */
function daFatturare(pf) {
  if (!pf || pf.stato === 'annullata') return false;
  return saldata(pf) && !String(pf.fattura_numero || '').trim();
}

/**
 * Il mese in cui va la fattura: quello dell'ULTIMO incasso, non quello del
 * documento. È la decisione 2 dell'11/08 — è l'incasso a far nascere la
 * fattura — e per questo la data la scrive il coach, non l'Hub.
 * @returns {string|null} 'AAAA-MM-GG'
 */
function dataChiudeIlConto(righe) {
  const date = (righe || []).map(r => String((r && r.data_incasso) || '').slice(0, 10))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return date.length ? date[date.length - 1] : null;
}

/**
 * ⭐ 18/08 — LA SCADENZA DI UN DOCUMENTO, quando dentro non c'è congelata.
 * Segnalato da Germano guardando la 2026/002 di Flamingo: «non dovrebbe essere a
 * 30 giorni? perché è segnata come fosse a rimessa diretta?». Aveva ragione — i
 * documenti nati prima di C4a hanno la casella vuota, e ripiegare sul giorno
 * dell'invio fa sembrare a rimessa diretta una rata concordata a 30 giorni.
 *
 * L'ordine è: quella congelata · quella della RATA (innesco + giorni, con la
 * regola che sta in `tranche.scadenza` e in nessun altro posto) · il giorno di
 * emissione, ma **solo per un documento di sole sessioni**, che si paga davvero
 * a rimessa diretta.
 * ⚠️ Se il documento contiene una rata e il suo giorno non si sa ancora — è il
 * caso di «metà percorso» senza data — torna **null**, e chi mostra la riga deve
 * dire che non si sa. Inventare una data qui vorrebbe dire far scattare un
 * promemoria per un ritardo che non esiste.
 * @param {object} pf   la proforma (con `scadenza` e `data_emissione`)
 * @param {object} [rata] la rata che contiene, se ne contiene una
 * @param {object} [riferimento] le date da cui si conta: {data_inizio, data_meta, data_fine}
 */
function scadenzaDocumento(pf, rata, riferimento) {
  if (pf && pf.scadenza) return String(pf.scadenza).slice(0, 10);
  if (rata) return tranche.scadenza(rata, riferimento || {});
  if (pf && pf.data_emissione) return String(pf.data_emissione).slice(0, 10);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ FETTA C4b — IL PROMEMORIA «VERIFICA SE È ARRIVATO»
//
// ✅ DECISIONE DI GERMANO, 18/08: **il promemoria parte DALLA SCADENZA**, non
// dall'invio. Su una rata a 30 giorni partire subito vorrebbe dire trenta giorni
// di promemoria quotidiano per una cosa che in ritardo non è — e un avviso che
// non chiede niente insegna a ignorare gli avvisi.
// ⚠️ Chi paga a rimessa diretta (le sessioni, la quota di un partecipante) ha la
// scadenza il giorno stesso: per loro compare subito, ed è giusto così.
// ═══════════════════════════════════════════════════════════════════════════

const GIORNI_INSISTE = 7;   // da qui in su la riga alza la voce, come le proforma ferme

/**
 * Da quanti giorni un documento è scaduto. Negativo non esiste: prima della
 * scadenza non c'è nessun ritardo, e infatti la riga non compare proprio.
 * @param {string} scadenza 'AAAA-MM-GG'
 * @param {string} oggiIso  il giorno ITALIANO (mai quello UTC del server: a
 *   mezzanotte e mezza a Roma in UTC è ancora ieri).
 * @returns {number|null} null se la scadenza non si sa.
 */
function giorniDiRitardo(scadenza, oggiIso) {
  const s = String(scadenza || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(oggiIso || '')) return null;
  return Math.round((Date.parse(oggiIso) - Date.parse(s)) / 86400000);
}

/**
 * Questo documento va messo in home fra le cose da verificare?
 * Tre condizioni, tutte necessarie: è **partito** (un documento fermo lo dice
 * già un altro gruppo, e chiederne l'incasso sarebbe assurdo) · **non è
 * saldato** · **la scadenza è arrivata**.
 * ⚠️ Scadenza sconosciuta = niente promemoria. È il caso di una rata legata a
 * «metà percorso» prima che quella data esista: non si può dire che è in ritardo
 * qualcosa che non ha ancora un termine.
 */
function daVerificare(pf, scadenza, oggiIso) {
  if (!pf || pf.stato !== 'inviata') return false;
  if (saldata(pf)) return false;
  const g = giorniDiRitardo(scadenza, oggiIso);
  return g !== null && g >= 0;
}

/** Come si scrive quel ritardo, in parole. Qui, così è identico ovunque. */
function daQuantoScaduta(giorni) {
  if (giorni === null || giorni === undefined) return '';
  if (giorni <= 0) return 'scade oggi';
  if (giorni === 1) return 'scaduta ieri';
  return `scaduta da ${giorni} giorni`;
}

/**
 * Cosa non torna in un incasso che si sta per registrare. Vuoto = si può salvare.
 * @param {object} o { importo, data, residuo }
 * ⚠️ NON si può registrare più di quanto manca. Non è pignoleria: un errore di
 * battitura (25.000 invece di 2.500) verrebbe accettato in silenzio e porterebbe
 * a fatturare una cifra che non è mai arrivata. Se davvero arrivasse di più, è
 * un fatto da guardare, non da far scivolare dentro un documento.
 */
function problemi(o) {
  const out = [];
  const imp = cent(o && o.importo);
  const manca = cent(o && o.residuo);
  if (imp <= 0) out.push('L’importo dell’incasso deve essere maggiore di zero.');
  if (manca > 0 && imp > manca) {
    out.push('Su questo documento mancano € ' + daCentesimi(manca).toLocaleString('it-IT',
      { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })
      + ': non si può registrare di più.');
  }
  if (manca <= 0) out.push('Questo documento è già saldato.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String((o && o.data) || ''))) {
    out.push('Manca il giorno in cui i soldi sono arrivati.');
  }
  return out;
}

/**
 * ⭐ LA MAPPA rata → documento che la contiene, con dentro anche l'incasso.
 * La costruiscono in tre punti diversi (scheda cliente, pagina progetto, home):
 * scritta tre volte, tre volte potrebbe divergere. Le query devono selezionare
 * le stesse colonne — c'è `SQL_COLONNE` qui sotto a dirlo.
 *
 * Il valore è un oggetto, non più una stringa: serve l'id del documento per
 * poterci appendere l'incasso dal pulsante. `tranche.statoDi()` accetta tutte e
 * due le forme, così le pagine si spostano una per volta senza rompersi.
 */
const SQL_COLONNE = `r.tranche_id, pf.id AS proforma_id, pf.numero, pf.stato,
       pf.da_pagare, pf.fattura_numero,
       COALESCE((SELECT SUM(i.importo) FROM incassi i WHERE i.proforma_id = pf.id), 0) AS incassato,
       (SELECT MAX(i.data_incasso) FROM incassi i WHERE i.proforma_id = pf.id) AS ultimo_incasso`;

/**
 * ⭐ La RATA che un documento contiene, con le date da cui si conta la sua
 * scadenza. La chiedono in due — la pagina Proforma e la home (il promemoria) —
 * e scritta due volte sarebbero due occasioni di divergere.
 * Le date sono quelle del progetto o, per un pacchetto, quelle del percorso.
 */
const SQL_RATA_DEL_DOCUMENTO = `
  SELECT r.proforma_id, t.innesco, t.giorni,
         COALESCE(prj.data_inizio, pc.data_inizio) AS data_inizio,
         COALESCE(prj.data_meta,   pc.data_meta)   AS data_meta,
         COALESCE(prj.data_fine,   pc.data_fine)   AS data_fine
    FROM proforma_righe r
    JOIN tranche_progetto t ON t.id = r.tranche_id
    LEFT JOIN partecipazioni pa ON pa.id = t.partecipazione_id
    LEFT JOIN progetti prj ON prj.id = COALESCE(t.progetto_id, pa.progetto_id)
    LEFT JOIN percorsi pc  ON pc.id = t.percorso_id
   WHERE r.tranche_id IS NOT NULL`;

/**
 * Scrive `scadenzaVera` su ogni documento, con la regola di
 * `scadenzaDocumento()`. `righeRate` sono le righe di SQL_RATA_DEL_DOCUMENTO.
 */
function conScadenza(proforme, righeRate) {
  const perProforma = new Map((righeRate || []).map(r => [r.proforma_id, r]));
  (proforme || []).forEach(p => {
    const r = perProforma.get(p.id);
    p.scadenzaVera = scadenzaDocumento(p, r ? { innesco: r.innesco, giorni: r.giorni } : null, r);
  });
  return proforme;
}

function mappaRate(rows) {
  const m = new Map();
  (rows || []).forEach(r => {
    m.set(r.tranche_id, {
      stato: r.stato,
      proformaId: r.proforma_id,
      numero: r.numero,
      daPagare: Number(r.da_pagare) || 0,
      incassato: Number(r.incassato) || 0,
      residuo: residuo({ da_pagare: r.da_pagare, incassato: r.incassato }),
      saldata: saldata({ da_pagare: r.da_pagare, incassato: r.incassato }),
      // Il giorno in cui il conto si è chiuso: è quello che va mostrato sulla
      // rata, ed è il mese in cui andrà la fattura.
      ultimoIncasso: r.ultimo_incasso ? String(r.ultimo_incasso).slice(0, 10) : null,
    });
  });
  return m;
}

module.exports = {
  cent, daCentesimi, sommaIncassi, statoPagamento, residuo, saldata,
  daFatturare, dataChiudeIlConto, scadenzaDocumento, problemi, mappaRate, SQL_COLONNE,
  GIORNI_INSISTE, giorniDiRitardo, daVerificare, daQuantoScaduta,
  SQL_RATA_DEL_DOCUMENTO, conScadenza,
};
