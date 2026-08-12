// ═══════════════════════════════════════════════════════════════════════════
// COSA C'È DA CHIEDERE — una domanda sola, un posto solo.
//
// «Maturato, non ancora chiesto» serve ormai in TRE punti: il promemoria in
// home, la pagina Amministrazione → Proforma, e la scheda del cliente. Fino alla
// Tappa 2 il conto stava dentro la scheda cliente, scritto a mano su righe già
// caricate; rifarlo altre due volte vorrebbe dire dargli altre due occasioni di
// divergere — ed è esattamente l'errore che la Tappa 1 aveva già evitato coi
// conti fiscali. Quindi: una query sola, qui dentro, e chi la usa la interroga.
//
// LE REGOLE, tutte già decise, tutte in un posto solo:
//  · solo percorsi INDIVIDUALI del cliente (`p.client_id IS NOT NULL`): i soldi
//    dei percorsi condivisi vivono sul progetto, contarli qui sarebbe doppio;
//  · solo modalità Standard con un prezzo: è l'unico modo che si paga a sessione;
//  · solo sedute CONFERMATE: una bozza non è ancora un fatto;
//  · l'INTAKE VALE DUE SESSIONI (Germano, 10/08);
//  · fuori tutto ciò che sta già in una proforma VIVA — una proforma annullata
//    restituisce le sue sessioni, ed è ciò che permette di rifare una prova.
// ═══════════════════════════════════════════════════════════════════════════

const db = require('./db');

// Il filtro «è una sessione che si paga»: una riga sola, riusata da tutte e due
// le query qui sotto, così maturato e bozze non possono guardare insiemi diversi.
const SESSIONE_A_PAGAMENTO = `
  p.client_id IS NOT NULL AND s.data IS NOT NULL
  AND p.modalita = 'Standard' AND p.prezzo > 0`;

/**
 * Quanto c'è da chiedere, per cliente e per mese.
 *
 * @param {string} [clientId] se presente, guarda solo quel cliente.
 * @returns {Promise<Array>} un elemento per CLIENTE:
 *   { id, name, email, totale, nSessioni, mesi: [{mese,n,nIntake,importo}],
 *     bozze: [{mese,n}], nBozze }
 *   I mesi sono ordinati dal più recente; le bozze sono le sessioni dello stesso
 *   tipo di percorso che aspettano ancora un'approvazione — non maturano, ma
 *   vanno DETTE, altrimenti restano fuori dalla proforma in silenzio.
 */
async function daChiedere(clientId) {
  const dove = clientId ? ' AND p.client_id = $1' : '';
  const par  = clientId ? [clientId] : [];

  const [mat, boz] = await Promise.all([
    db.query(`
      SELECT p.client_id, to_char(s.data, 'YYYY-MM') AS mese,
             count(*)::int AS n,
             count(*) FILTER (WHERE s.tipo = 'Intake')::int AS n_intake,
             sum(p.prezzo * CASE WHEN s.tipo = 'Intake' THEN 2 ELSE 1 END) AS importo
        FROM sedute s JOIN percorsi p ON p.id = s.percorso_id
       WHERE ${SESSIONE_A_PAGAMENTO} AND s.stato = 'confermata'${dove}
         AND NOT EXISTS (
           SELECT 1 FROM proforma_righe r JOIN proforme pf ON pf.id = r.proforma_id
            WHERE r.seduta_id = s.id AND pf.stato <> 'annullata')
       GROUP BY 1, 2`, par),
    db.query(`
      SELECT p.client_id, to_char(s.data, 'YYYY-MM') AS mese, count(*)::int AS n
        FROM sedute s JOIN percorsi p ON p.id = s.percorso_id
       WHERE ${SESSIONE_A_PAGAMENTO} AND s.stato <> 'confermata'${dove}
       GROUP BY 1, 2`, par),
  ]);

  const per = new Map();                       // client_id → l'elemento in uscita
  const dammi = id => {
    if (!per.has(id)) {
      per.set(id, { id, name: '', email: '', totale: 0, nSessioni: 0,
        mesi: [], bozze: [], nBozze: 0 });
    }
    return per.get(id);
  };
  for (const r of mat.rows) {
    const c = dammi(r.client_id);
    c.mesi.push({ mese: r.mese, n: r.n, nIntake: r.n_intake, importo: Number(r.importo) });
    c.totale += Number(r.importo);
    c.nSessioni += r.n;
  }
  for (const r of boz.rows) {
    const c = dammi(r.client_id);
    c.bozze.push({ mese: r.mese, n: r.n });
    c.nBozze += r.n;
  }
  if (!per.size) return [];

  // I nomi si prendono dopo, in una volta sola: la query dei soldi non deve
  // portarsi dietro anche l'anagrafica per poi ripeterla su ogni riga.
  const nomi = await db.query(
    'SELECT id, name, email FROM clients WHERE id = ANY($1::text[])', [[...per.keys()]]);
  for (const r of nomi.rows) {
    const c = per.get(r.id);
    c.name = r.name || '';
    c.email = r.email || '';
  }

  const out = [...per.values()];
  for (const c of out) {
    c.mesi.sort((a, b) => b.mese.localeCompare(a.mese));
    c.bozze.sort((a, b) => b.mese.localeCompare(a.mese));
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return out;
}

// ── IL PRIMO LUNEDÌ ─────────────────────────────────────────────────────────
// Il promemoria compare dal PRIMO LUNEDÌ del mese (Germano, 12/08: «sempre il
// primo lunedì», scelto conoscendo il rischio che 3 volte su 12 cada a ridosso
// della fine del mese precedente). Prima di quel giorno non si dice niente:
// il mese è appena finito e i report dell'ultima settimana possono ancora
// arrivare.
//
// ⚠️ Il giorno è quello ITALIANO, non quello UTC del server: alle 00:30 del
// lunedì a Roma, in UTC è ancora domenica, e il promemoria non comparirebbe.

function oggiRoma() {
  // en-CA dà «AAAA-MM-GG», che è già il formato con cui confrontiamo i mesi.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

// Il giorno del mese in cui cade il primo lunedì: 1..7.
function giornoPrimoLunedi(anno, mese1a12) {
  const primo = new Date(Date.UTC(anno, mese1a12 - 1, 1)).getUTCDay(); // 0=dom
  return primo === 1 ? 1 : (primo === 0 ? 2 : 9 - primo);
}

/**
 * Il promemoria di chiusura mese: si vede o no, e per quali mesi.
 * @param {string} [iso] giorno da usare al posto di oggi (serve alle prove).
 * @returns {{attivo: boolean, meseLimite: string}} `meseLimite` è l'ultimo mese
 *   'AAAA-MM' di cui si può già chiedere il pagamento (il mese scorso).
 */
function finestraPromemoria(iso) {
  const oggi = iso || oggiRoma();
  const [a, m, g] = oggi.split('-').map(Number);
  const attivo = g >= giornoPrimoLunedi(a, m);
  const meseLimite = m === 1
    ? (a - 1) + '-12'
    : a + '-' + String(m - 1).padStart(2, '0');
  return { attivo, meseLimite };
}

module.exports = { daChiedere, finestraPromemoria, giornoPrimoLunedi, oggiRoma };
