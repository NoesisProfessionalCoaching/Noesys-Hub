/**
 * LE DATE, IN UN POSTO SOLO — fetta 4.3 del riordino (04/09/2026).
 *
 * Fino al 04/09 c'erano quattro modi di dire «oggi a Roma» (maturato, sedute,
 * routes, e una riga in una pagina), tre «data italiana» con due nomi uguali e
 * uscite diverse, e due righe che usavano l'ora di Greenwich proprio dove si
 * datano e numerano le proforma: fra mezzanotte e le due, d'estate, una
 * proforma usciva datata al giorno prima, e la notte di Capodanno avrebbe preso
 * l'anno vecchio. Qui c'è UNA versione di ognuna; gli altri moduli la chiamano.
 *
 * ⚠️ Le tre trappole di sempre:
 *   · `dataIt` vale per una DATE (AAAA-MM-GG) o per l'inizio di una stringa ISO:
 *     su un timestamp taglia l'ora e prende il giorno di Greenwich. Per un
 *     momento nel tempo si usa `dataOraIt`.
 *   · `oggiRoma` è il giorno ITALIANO: non toISOString(), che fino alle 2 di
 *     notte (d'estate) è ancora ieri.
 *   · Non si usa `toLocaleDateString('en-CA')`: dà lo stesso risultato di
 *     `sv-SE` ma dipende dai dati di locale del sistema; sv-SE è quello che
 *     usavano già sedute.js e routes.js.
 */

/** Oggi a Roma, come AAAA-MM-GG. */
function oggiRoma() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
}

/** Una DATE (o l'inizio di una ISO) in italiano: 2026-09-04 → 04/09/2026. Vuoto → ''. */
function dataIt(d) {
  if (!d) return '';
  const s = String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Una DATE in italiano per esteso: 2026-09-04 → «4 settembre 2026». Vuoto → ''. */
function dataEstesa(d) {
  if (!d) return '';
  const [a, m, g] = String(d).slice(0, 10).split('-');
  const mese = MESI[Number(m) - 1];
  return mese ? `${Number(g)} ${mese} ${a}` : dataIt(d);
}

/** Un MOMENTO (timestamp) in ora italiana: «04/09/2026 alle 14:26». Vuoto → '—'. */
function dataOraIt(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(dt).replace(', ', ' alle ');
}

module.exports = { oggiRoma, dataIt, dataEstesa, dataOraIt, MESI };
