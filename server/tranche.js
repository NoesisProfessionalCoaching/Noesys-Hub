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

// I tre momenti che fanno scattare una tranche. `data` dice da dove si prende
// il giorno di riferimento: sono tutti dati che stanno già sul progetto, tranne
// «metà percorso», che l'Hub non ha modo di dedurre e che scrive il coach.
const INNESCHI = {
  firma: { label: 'Alla firma',        campo: 'data_inizio' },
  meta:  { label: 'A metà percorso',   campo: 'data_meta'   },
  fine:  { label: 'Alla fine',         campo: 'data_fine'   },
};

const PROPOSTA = [
  { etichetta: 'Acconto',        quota: 0.30, innesco: 'firma' },
  { etichetta: 'Metà percorso',  quota: 0.40, innesco: 'meta'  },
  { etichetta: 'Saldo',          quota: 0.30, innesco: 'fine'  },
];

/**
 * Il piano che l'Hub PROPONE quando non ce n'è ancora uno.
 * @param {number} totale la quota del committente.
 * @returns {Array} [{ordine, etichetta, importo, innesco, giorni}]
 */
function pianoProposto(totale) {
  const t = Math.round(Number(totale) || 0);
  const righe = PROPOSTA.map((r, i) => ({
    ordine: i, etichetta: r.etichetta, innesco: r.innesco, giorni: 30,
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
    out.push('Le tranche sommano € ' + somma.toLocaleString('it-IT')
      + ' invece di € ' + t.toLocaleString('it-IT') + '.');
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

module.exports = { INNESCHI, pianoProposto, percentuale, problemi, scadenza };
