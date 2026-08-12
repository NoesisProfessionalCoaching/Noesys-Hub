// ═══════════════════════════════════════════════════════════════════════════
// IL PROSSIMO APPUNTAMENTO — due sorgenti, una regola sola.
//
// Fino all'11/08/2026 l'appuntamento non era una cosa: erano due caselle in
// fondo al verbale dell'ultima sessione, scritte dall'automazione dei report
// (`sedute.scadenza` + `sedute.prossima_ora`). Funziona finché le sessioni si
// fanno: quando una salta, il report non arriva mai e la data nuova non ha
// nessun posto dove stare.
//
// Dal 12/08 le sorgenti sono DUE:
//   · il REPORT, che continua a scrivere dove scriveva (non si tocca: quel
//     campo è il verbale di quella sessione, e correggerlo sarebbe falsificarlo);
//   · la MANO del coach, nella tabella `appuntamenti`.
//
// ⭐ LA REGOLA, decisa da Germano il 12/08: **vince l'ultima notizia.**
// Quello che scrive il coach copre quello del report, ma solo finché non arriva
// un report più recente — perché un report più recente vuol dire che nel
// frattempo c'è stata un'altra sessione, e quindi che la data concordata lì è
// più aggiornata di quella scritta prima.
//
// ⚠️ `a.data IS NULL` non vuol dire «non c'è niente»: vuol dire «l'ho tolto
// io», e deve vincere lo stesso. Cancellare la riga, invece, farebbe
// riaffiorare l'appuntamento del report.
// ═══════════════════════════════════════════════════════════════════════════

const db = require('./db');

// Il cuore: per ogni percorso individuale attivo, qual è l'appuntamento buono.
// `scad` può uscire NULL — vuol dire che non ce n'è nessuno, ed è un'informazione
// utile quanto le altre (è il percorso a cui bisogna fissarne uno).
const EFFETTIVO = `
  SELECT cl.id AS client_id, cl.name, p.id AS percorso_id, p.tipo AS percorso_tipo,
         CASE WHEN a.percorso_id IS NOT NULL
               AND (u.creata IS NULL OR a.updated_at >= u.creata)
              THEN a.data ELSE u.scad END AS scad,
         CASE WHEN a.percorso_id IS NOT NULL
               AND (u.creata IS NULL OR a.updated_at >= u.creata)
              THEN a.ora ELSE u.ora END AS ora,
         CASE WHEN a.percorso_id IS NOT NULL
               AND (u.creata IS NULL OR a.updated_at >= u.creata)
              THEN 'mano' ELSE 'report' END AS fonte
    FROM percorsi p
    JOIN clients cl ON cl.id = p.client_id
    LEFT JOIN appuntamenti a ON a.percorso_id = p.id
    LEFT JOIN LATERAL (
          SELECT s.scadenza::date AS scad,
                 CASE WHEN s.prossima_ora ~ '^[0-9]{1,2}:[0-9]{2}$'
                      THEN s.prossima_ora END AS ora,
                 s.created_at AS creata
            FROM sedute s
           WHERE s.percorso_id = p.id AND s.stato = 'confermata'
             AND s.scadenza ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           ORDER BY s.data DESC NULLS LAST
           LIMIT 1) u ON TRUE
   WHERE p.stato = 'attivo'`;

/**
 * Gli appuntamenti ANCORA DA FARE, per il promemoria in home.
 *
 * ⚠️ La riga sparisce quando passa l'ORA, non a mezzanotte; senza orario si
 * tiene fino a fine giornata, che è il meglio che si possa fare.
 * ⚠️ «Adesso» è il momento ITALIANO, non quello UTC del server.
 * ⚠️ Passato quel momento la riga sparisce e basta — scelta di Germano del
 *    12/08 («se l'appuntamento non viene fatto è giusto che sparisca»),
 *    conoscendo il rovescio: un incontro saltato non lascia traccia, e a
 *    riscriverlo ci pensa lui dalla scheda del cliente.
 */
async function prossimi() {
  const r = await db.query(`
    SELECT * FROM (${EFFETTIVO}) v
     WHERE scad IS NOT NULL
       AND (scad + COALESCE(ora::time, TIME '23:59')) >= (NOW() AT TIME ZONE 'Europe/Rome')
     -- A parità di giorno conta l'ora: lpad perché l'orario è testo, e un
     -- "9:00" senza lo zero finirebbe dopo un "10:30".
     ORDER BY scad, lpad(ora, 5, '0') NULLS LAST`);
  return r.rows;
}

/**
 * Tutti i percorsi attivi di un cliente col loro appuntamento, **anche quelli
 * che non ce l'hanno e anche quelli già passati**. È da qui che si segna un
 * incontro che dai report non arriverà mai.
 */
async function perCliente(clientId) {
  const r = await db.query(
    `SELECT * FROM (${EFFETTIVO}) v WHERE client_id = $1 ORDER BY scad NULLS LAST`,
    [clientId]);
  return r.rows;
}

module.exports = { prossimi, perCliente, EFFETTIVO };
