// ═══════════════════════════════════════════════════════════════════════════
// LO STATO DI UNA SEDUTA — in un posto solo (fetta 0.3 del riordino, 03/09/2026).
//
// La regola dell'Hub: «una sessione esiste solo se esiste il suo report», e le
// BOZZE non contano ore né sessioni ICF. Da qui discendono due stati soltanto:
//   · 'bozza'      → fissata ma non avvenuta (data nel futuro), oppure arrivata
//                    da un report e in attesa che il coach la approvi;
//   · 'confermata' → fatta, e conta.
//
// 🔴 PERCHÉ QUESTO FILE ESISTE (ricognizione indipendente, B2): la regola «data
// nel futuro = bozza» viveva in UNA rotta sola, quella che crea una sessione
// individuale. La gemella collettiva non la applicava (una sessione di team
// fissata per il mese prossimo contava già ore e sessioni), e nessuna delle
// rotte di modifica la ricalcolava quando si spostava la data. Quattro rotte
// copiate a mano avevano già divergito. Adesso chiamano tutte questa.
//
// Modulo puro: niente database. Si prova con delle date (scripts/prova-sedute.js).
// ═══════════════════════════════════════════════════════════════════════════

/** «Oggi» a Roma, come AAAA-MM-GG. Non l'ora di Greenwich: fra mezzanotte e le
 *  due, d'estate, sarebbe ancora ieri, e una sessione di oggi risulterebbe futura. */
function oggiRoma() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
}

/** La data come AAAA-MM-GG, qualunque forma abbia (stringa, stringa con l'ora, Date). */
function giorno(data) {
  if (!data) return null;
  if (data instanceof Date) return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(data);
  return String(data).slice(0, 10);
}

/**
 * Lo stato che spetta a una seduta scritta A MANO, guardando solo la data:
 * nel futuro è fissata (bozza), altrimenti è fatta (confermata). Senza data non
 * si può dire che sia nel futuro: conta.
 */
function statoDallaData(data, oggi) {
  const g = giorno(data);
  return g && g > (oggi || oggiRoma()) ? 'bozza' : 'confermata';
}

/**
 * Lo stato dopo una MODIFICA. Una riga che ha un report dietro (`sourceFileId`)
 * non segue la data: se è in bozza sta aspettando l'approvazione del coach, e
 * correggerle la data non deve approvarla al posto suo; se è già approvata,
 * resta approvata. Una riga scritta a mano segue la data.
 */
function statoDopoModifica({ data, oggi, sourceFileId, statoAttuale }) {
  if (sourceFileId) return statoAttuale || 'bozza';
  return statoDallaData(data, oggi);
}

module.exports = { oggiRoma, statoDallaData, statoDopoModifica };
