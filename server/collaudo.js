/**
 * I DATI DI COLLAUDO — fetta 1.4 del riordino (04/09/2026).
 *
 * `clients`, `committenti` e `progetti` hanno una colonna `di_collaudo`
 * (nata in `db.js` il 20/08): TRUE = record di prova, FALSE = vero,
 * NULL = mai classificato. Fino al 04/09 nessuna pagina la leggeva: home,
 * Estratto ICF, anomalie e i numeri dell'Amministrazione contavano anche i
 * clienti inventati. Germano, 20/08: «hai inserito un numero di clienti falso».
 *
 * ⭐ LE TRE DECISIONI DI GERMANO (04/09/2026, «1a, 2a, 3a»):
 *   1. I record di collaudo escono dai NUMERI E DAI TOTALI (contatori in home,
 *      incassato, Estratto ICF, i conteggi dell'Amministrazione). Restano nelle
 *      LISTE DI LAVORO (da chiedere, proforme ferme, da verificare, anomalie)
 *      con un cartellino: i dati finti servono a provare i flussi.
 *   2. Un record mai classificato (NULL) conta come VERO, e la home lo dice con
 *      un cartello: così un cliente vero conta da subito senza che nessuno
 *      debba ricordarsi niente, e un record di prova nuovo si fa notare.
 *   3. Si classifica DALL'HUB: un interruttore sulla scheda del cliente, sulla
 *      pagina del progetto e sulla riga del committente. Prima lo scrivevo io
 *      in `db.js` a ogni record nuovo, e da ottobre Germano lavora da solo.
 *
 * ⛔ La regola sta qui, in un posto solo. Le pagine la usano, non la riscrivono.
 */

/** Il pezzo di WHERE che tiene fuori i record di collaudo. NULL passa (decisione 2). */
function filtro(alias) {
  return `COALESCE(${alias}.di_collaudo, FALSE) = FALSE`;
}

/** Le tre tabelle, dalla parola usata nelle pagine. */
const TABELLE = { cliente: 'clients', committente: 'committenti', progetto: 'progetti' };

/** Il cartellino da mettere accanto a un nome. Vuoto se il record è vero o non classificato. */
function badge(valore) {
  if (valore !== true) return '';
  return '<span class="badge" style="background:#fdf6e3;color:#8a6d1e" title="Record di collaudo: non entra nei numeri">⚗️ di collaudo</span>';
}

/**
 * L'interruttore con cui Germano classifica un record (decisione 3).
 * ⚠️ La pagina che lo mette deve includere `js()` una volta sola.
 * Gli id sono uuid generati dal database: non hanno bisogno di jsStr().
 */
function interruttore(tipo, id, valore) {
  const link = (v, testo) =>
    `<button onclick="segnaCollaudo('${tipo}','${id}',${v})" style="background:none;border:none;padding:0;font-size:12px;color:var(--muted);text-decoration:underline;cursor:pointer">${testo}</button>`;
  if (valore === true)  return `${badge(true)} ${link(false, 'è un record vero')}`;
  if (valore === false) return link(true, '⚗️ segna come di collaudo');
  return `<span class="badge" style="background:#eef1f5;color:#7a8089" title="Nato dopo l'ultima classificazione: conta come vero finché non dici il contrario">non classificato</span> ${link(false, 'è vero')} · ${link(true, 'è di collaudo')}`;
}

/** Lo script della pagina: chiama la rotta e ricarica. */
function js() {
  return `
    async function segnaCollaudo(tipo, id, valore) {
      const r = await fetch('/dashboard/collaudo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipo, id: id, di_collaudo: valore }) });
      const d = await r.json().catch(function () { return {}; });
      if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); return; }
      location.reload();
    }`;
}

/**
 * Il cartello della home. Dice quanti record di collaudo sono tenuti fuori dai
 * numeri e quanti non sono ancora classificati. Vuoto se non c'è niente da dire.
 * @param {{collaudo:{clienti:number,committenti:number,progetti:number}, nonClassificati:{clienti:number,committenti:number,progetti:number}}} n
 */
function cartello(n) {
  const somma = (o) => (o.clienti || 0) + (o.committenti || 0) + (o.progetti || 0);
  const dett = (o) => [[o.clienti, 'clienti', 'cliente'], [o.committenti, 'committenti', 'committente'], [o.progetti, 'progetti', 'progetto']]
    .filter(([k]) => k > 0).map(([k, pl, sg]) => `${k} ${k === 1 ? sg : pl}`).join(' · ');
  const c = somma(n.collaudo || {}), b = somma(n.nonClassificati || {});
  if (!c && !b) return '';
  const righe = [];
  if (c) righe.push(`<div>⚗️ <strong>${c} ${c === 1 ? 'record' : 'record'} di collaudo</strong> (${dett(n.collaudo)}) ${c === 1 ? 'non entra' : 'non entrano'} nei numeri qui sopra.</div>`);
  if (b) righe.push(`<div style="color:#a4342a">🔴 <strong>${b} ${b === 1 ? 'record non ancora classificato conta' : 'record non ancora classificati contano'} come ${b === 1 ? 'vero' : 'veri'}</strong> (${dett(n.nonClassificati)}): apri la scheda e dì se ${b === 1 ? 'è vero o di prova' : 'sono veri o di prova'}.</div>`);
  return `<div class="card" id="cartello-collaudo" style="font-size:12.5px;color:var(--muted);display:grid;gap:4px">${righe.join('')}</div>`;
}

module.exports = { filtro, TABELLE, badge, interruttore, js, cartello };
