// ═══════════════════════════════════════════════════════════════════════════
// L'IMPAGINAZIONE DEL DOCUMENTO DI CHIUSURA.
//
// ⚠️ Il vestito NON si reinventa: il foglio di stile è ESATTAMENTE quello del
// modello che Germano ha approvato il 21/08/2026 (`server/assets/documento/
// stile.css`, estratto dal file di lavoro), pittogramma di sfondo compreso, con
// le misure che ha scelto lui fra tre provini. Qui si generano solo le slide.
//
// Due versioni nello stesso file, come da modello:
//  · «da sessione» → si vedono le TRACCE per il coach e le FONTI dei contenuti;
//  · «da consegnare» → tracce e fonti spariscono e le domande diventano IMPEGNI
//    in prima persona. Le regole stanno nel CSS (body.sessione / body.consegna).
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'assets', 'documento');
const CSS = fs.readFileSync(path.join(DIR, 'stile.css'), 'utf8');
const LOGO = fs.readFileSync(path.join(DIR, 'img1.b64'), 'utf8').trim();

const esc = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── LA TARGA DI OGNI TESTO ───────────────────────────────────────────────────
// Ogni pezzo modificabile porta il suo SENTIERO dentro il documento
// ('filo.titolo', 'momenti.2.punti.0'): è la chiave con cui la correzione del coach
// viene salvata e ritrovata, anche se intorno il documento viene rigenerato.
// ⚠️ La targa si mette QUI, mentre si disegna. Il 21/08 uno script che le aggiungeva
// dopo, all'HTML già fatto, ha modificato anche il JavaScript della pagina e ha
// rotto i pulsanti: non si torna a fare così.
let MODIFICABILE = false;
const ed = (sentiero, testo) => MODIFICABILE
  ? `<span data-k="${sentiero}" contenteditable="false">${testo}</span>`
  : testo;

// ── GLI ELENCHI CHE IL COACH PUÒ RIFARE ─────────────────────────────────────
// Un elenco porta la sua targa sul contenitore; ogni voce si può riscrivere,
// TOGLIERE o AGGIUNGERE. Al salvataggio parte l'elenco INTERO, non il singolo
// pezzo: è l'unico modo perché «ho tolto il terzo punto» arrivi fino al database.
const lista = (sentiero, voci) => MODIFICABILE
  ? `<div data-lista="${sentiero}">${voci}<button class="aggiungi" type="button">+ aggiungi</button></div>`
  : `<div>${voci}</div>`;
const voce = (dentro) => MODIFICABILE
  ? `<div data-voce>${dentro}<button class="togli" type="button" title="Togli questo punto">✕</button></div>`
  : dentro;

const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
function dataLunga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${Number(m[3])} ${MESI[Number(m[2]) - 1]}`;
}

// ── La ruota ────────────────────────────────────────────────────────────────
// Un settore per area, raggio proporzionale al valore: è la stessa forma dello
// strumento che compila il cliente. I colori seguono la scala di Noesys.
const COLORI = ['199,170,55','165,161,72','130,152,89','96,143,106','73,129,114','62,109,113','51,89,127','34,59,110'];

// ⚠️ MISURE PRESE DAL MODELLO APPROVATO, non a occhio: viewBox -472 -400 944 800,
// raggio = 22.5 + 25.75 × valore, nomi delle aree a corpo 22 e valore "n/10" a 19.
// Il 21/08 le avevo rifatte più piccole «di mio» e Germano se n'è accorto subito:
// le etichette non si leggevano più. Se un giorno vanno cambiate, si cambiano con lui.
function ruotaSvg(aree, { max = 10 } = {}) {
  if (!aree || !aree.length) return '';
  const R = v => 22.5 + 25.75 * Number(v || 0);
  const n = aree.length, passo = (Math.PI * 2) / n;
  const F = 'Manrope,sans-serif';

  const settori = aree.map((a, i) => {
    const r = R(a.value);
    const da = -Math.PI / 2 + i * passo, a2 = da + passo;
    const p = (ang) => `${(Math.cos(ang) * r).toFixed(1)},${(Math.sin(ang) * r).toFixed(1)}`;
    return `<path d="M0,0 L${p(da)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${p(a2)} Z" fill="rgba(${COLORI[i % COLORI.length]},0.72)"/>`;
  }).join('');

  const griglia = [2, 4, 6, 8, 10].map(v =>
    `<circle cx="0" cy="0" r="${R(v).toFixed(1)}" fill="none" stroke="#c8d2dd" stroke-width="1.6"/>` +
    `<text x="${(-R(v) * 0.33).toFixed(1)}" y="${(-R(v) * 0.94).toFixed(1)}" text-anchor="middle" font-size="20" font-weight="700" fill="#9aa5b1" font-family="${F}">${v}</text>`).join('');

  const etichette = aree.map((a, i) => {
    const ang = -Math.PI / 2 + (i + 0.5) * passo;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const rr = 348;   // la ruota arriva a 280: qui c'è aria fra i settori e i nomi
    const x = cx * rr, y = cy * rr;
    const anc = cx > 0.35 ? 'start' : (cx < -0.35 ? 'end' : 'middle');
    const righe = String(a.name).split(/\n|\s{2,}/).map(t => t.trim()).filter(Boolean);
    const su = cy < 0;
    const yBase = y - (su ? (righe.length - 1) * 34 : 0);
    const nomi = righe.map((r, k) =>
      `<text x="${x.toFixed(1)}" y="${(yBase + k * 34).toFixed(1)}" text-anchor="${anc}" font-size="30" font-weight="700" fill="rgb(${COLORI[i % COLORI.length]})" font-family="${F}">${esc(r)}</text>`).join('');
    const yVal = yBase + righe.length * 34 + 4;
    return nomi + `<text x="${x.toFixed(1)}" y="${yVal.toFixed(1)}" text-anchor="${anc}" font-size="26" font-weight="400" fill="#8a95a1" font-family="${F}">${esc(a.value)}/10</text>`;
  }).join('');

  return `<svg viewBox="-472 -400 944 800" role="img" aria-label="Ruota">${griglia}${settori}${etichette}</svg>`;
}

// ── Le slide ────────────────────────────────────────────────────────────────
const slide = (dentro, n, extra = '') => `<section class="slide${extra ? ' ' + extra : ''}">${dentro}<div class="num">${n}</div></section>`;
const occhiello = (t, oro) => `<div class="occhiello">${esc(t)}${oro ? ` · <span>${esc(oro)}</span>` : ''}</div>`;
const traccia = t => t ? `<div class="traccia"><b>Traccia.</b> ${esc(t)}</div>` : '';
const fonte = t => t ? `<div class="fonte">${esc(t)}</div>` : '';

function slideMomento(m, n, idx) {
  const punti = lista(`momenti.${idx}.punti`,
    (m.punti || []).map(p => voce(`<span class="punto" data-campo>${esc(p)}</span>`)).join(''));
  return slide(`
    ${occhiello(dataLunga(m.data), m.etichetta)}
    <h2>${ed(`momenti.${idx}.titolo`, esc(m.titolo))}</h2>
    <div class="split">
      <div>
        <div class="punti">${punti}</div>
        ${m.considerazioni ? `<p class="spieg">${ed(`momenti.${idx}.considerazioni`, esc(m.considerazioni))}</p>` : ''}
        ${fonte(m.fonte)}
      </div>
      <div class="portato">
        <div class="lab">Portato dal Cliente</div>
        <div class="q">«${esc(m.portatoCitazione)}»</div>
        <div class="f">${ed(`momenti.${idx}.portatoSpiegazione`, esc(m.portatoSpiegazione))}</div>
      </div>
    </div>
    ${traccia(m.traccia)}`, n);
}

function slideRuote(ruote, n) {
  if (!ruote || (!ruote.intake && !ruote.final)) return '';
  // 🔴 LE DUE RUOTE STANNO SEMPRE AFFIANCATE, anche quando ce n'è una sola: la metà
  // vuota È IL POSTO della ruota che si fa durante la Final. Non è spazio sprecato,
  // è spazio prenotato — non allargare la prima per riempirlo.
  const una = (r, titolo) => `<div class="rw">
      <div class="cap"><span>${esc(titolo)}</span> ${r ? esc(dataLunga(r.quando)) : 'si fa in sessione'}</div>
      ${r ? ruotaSvg(r.aree) : '<div class="attesa">Qui entra la ruota della Final, appena la salvate nello strumento.</div>'}
    </div>`;
  const v = ruote.variazioni;
  const numeri = v ? `<p class="spieg">${v.salite} aree salite · ${v.scese} scese · ${v.ferme} ferme. Media da ${v.mediaPrima} a ${v.mediaDopo}.` +
      (v.maggiore ? ` La variazione più grande: ${esc(v.maggiore.area)}, da ${v.maggiore.prima} a ${v.maggiore.dopo}.` : '') +
      (v.areeNonConfrontabili && v.areeNonConfrontabili.length ? ` <span style="color:#9aa5b1">Aree non confrontabili: ${esc(v.areeNonConfrontabili.join(', '))}.</span>` : '') + '</p>'
    : `<p class="spieg" style="color:#9aa5b1">${ruote.final && !ruote.intake
        ? "Manca la ruota d'intake nello strumento: senza quella il confronto non si può fare."
        : 'La ruota della Final si fa in sessione: comparirà qui da sola, con le variazioni.'}</p>`;
  return slide(`
    ${occhiello('Le stesse domande', 'a distanza di tempo')}
    <h2 style="margin-bottom:10px;max-width:none;font-size:27px">Le tue ruote a confronto</h2>
    <div class="ruote">${una(ruote.intake, 'Intake')}${una(ruote.final, 'Final')}</div>
    ${numeri}
    ${traccia('Le variazioni non le commento io: chiedi a lui cosa gli dicono.')}`, n);
}

// 🔴 LE TRE SLIDE DI CHIUSURA. Nella versione DA SESSIONE sono la traccia del
// coach — i punti del percorso che gli servono per condurre. Nella versione DA
// CONSEGNARE quei punti spariscono e al loro posto ci vanno LE PAROLE DEL CLIENTE,
// prese dal report della Final. Finché quel report non c'è, lo spazio dice che
// aspetta: ⚠️ NON è uno spazio da riempire, è uno spazio prenotato.
function slidePunti(sez, n, occ, chiave) {
  if (!sez || !(sez.punti || []).length) return '';
  const punti = lista(`${chiave}.punti`, sez.punti.map(p => voce(`
    <div class="filo"><div class="filo-n"></div><div>
      <b data-campo="titolo">${esc(p.titolo)}</b><p><span data-campo="testo">${esc(p.testo)}</span>${p.riferimento ? ` <span style="color:#9aa5b1" data-campo="riferimento">${esc(p.riferimento)}</span>` : ''}</p>
    </div></div>`)).join(''));
  return slide(`
    ${occhiello(occ)}
    <h2 style="margin-bottom:12px">${ed(`${chiave}.titolo`, esc(sez.titolo))}</h2>
    <div class="q-ses">${punti}</div>
    <div class="q-con">${paroleAttese(sez.parole)}</div>
    ${traccia('Non elencarglieli: sono la tua traccia. Chiedi a lui, e le sue parole prenderanno questo posto nel documento da consegnare.')}`, n);
}

// Le domande di chiusura: in sessione la domanda con le righe su cui scrivere,
// nel documento da consegnare la risposta del Cliente sotto il suo titoletto.
function slideDomande(dom, n) {
  if (!dom || !dom.length) return '';
  const righe = dom.map((d, i) => `
    <div class="qa">
      <b class="q-ses">${ed(`daQuiInAvanti.${i}.domanda`, esc(d.domanda))}</b>
      <div class="q-ses"><div class="riga"></div><div class="riga"></div></div>
      <div class="q-con"><b>${esc(d.etichetta)}</b>${paroleAttese(d.parole)}</div>
    </div>`).join('');
  return slide(`
    ${occhiello('Le domande di chiusura', 'quello che mi sono dato')}
    <h2 style="margin-bottom:12px">Da qui in avanti</h2>
    ${righe}
    ${traccia('Qui si scrive insieme: quello che dice adesso vale più di quello che ha detto prima.')}`, n);
}

const paroleAttese = p => p
  ? `<p>${esc(p)}</p>`
  : `<p style="color:#9aa5b1">Prende il posto delle parole del Cliente, dal report della Final.</p>`;

// ── Il documento intero ─────────────────────────────────────────────────────
function renderDocumento({ contenuti, cliente, ruote, soloCorpo = false, modificabile = false, azioni = '', versione = 'final' }) {
  MODIFICABILE = !!modificabile;
  const d = contenuti || {};
  const nome = (cliente && (cliente.name || cliente.nome)) || (d.chiusura && d.chiusura.titolo) || '';
  let n = 0;
  const pezzi = [];

  pezzi.push(slide(`
    <img class="logo-tl" alt="Noesys Professional Coaching" src="${LOGO}">
    <div class="claim">${esc(nome)}</div>
    <h2 style="max-width:26ch">${ed('copertina.titolo', esc(d.copertina ? d.copertina.titolo : ''))}</h2>
    <div class="meta">${esc(d.copertina ? d.copertina.periodo : '')}</div>`, ++n, 'cover'));

  if (d.filo) pezzi.push(slide(`
    ${occhiello('Il filo del percorso')}
    <h2>${ed('filo.titolo', esc(d.filo.titolo))}</h2>
    ${(d.filo.corpo || []).map((p, i) => `<p class="spieg">${ed(`filo.corpo.${i}`, esc(p))}</p>`).join('')}`, ++n));

  (d.momenti || []).forEach((m, i) => pezzi.push(slideMomento(m, ++n, i)));

  const sr = slideRuote(ruote, n + 1); if (sr) { n++; pezzi.push(sr); }

  // 🔴 QUESTA PAGINA È IL CONFRONTO FRA I NUMERI DELLE DUE RUOTE (Germano, 21/08).
  // Finché la seconda ruota non c'è, un confronto NON PUÒ ESISTERE: la pagina si
  // mostra dichiarandosi da completare, e i numeri che il Cliente si è dato nei
  // report restano lì come materiale, senza nessun paragone inventato.
  if ((d.numeri || []).length) {
    const dueRuote = !!(ruote && ruote.intake && ruote.final && ruote.variazioni);
    const conf = dueRuote
      ? `<div class="numeri" style="flex:1;align-content:center">${ruote.variazioni.aree.map(a =>
          `<div class="n"><div class="k">${esc(a.area)}</div><div class="v"><s>${a.prima}</s> <em>${a.dopo}</em></div>` +
          `<div class="d">${a.variazione > 0 ? '+' + a.variazione : (a.variazione || 'invariata')}</div></div>`).join('')}</div>`
      : `<div class="attesa" style="margin:8px 0 14px">Il confronto si completa quando arriva la ruota della Final: qui compariranno i valori di allora accanto a quelli di oggi.</div>`;
    pezzi.push(slide(`
      ${occhiello('I numeri', dueRuote ? 'come sono cambiati' : 'da completare dopo la Final')}
      <h2 style="margin-bottom:12px">I numeri sono tuoi, non miei</h2>
      ${conf}
      ${fonte('I numeri che si è dato nei report, per ora senza confronto: ' + d.numeri.map(x => esc(x.etichetta) + ' ' + esc(x.valore) + ' (' + esc(x.quando) + ')').join(' · '))}
      ${traccia(dueRuote ? 'Non li commentare tu: chiedigli cosa gli dicono questi spostamenti.' : 'Questa pagina si riempie da sola dopo la ruota della Final.')}`, ++n));
  }

  const sp = slidePunti(d.portiVia, n + 1, 'Cosa ti porti', 'portiVia'); if (sp) { n++; pezzi.push(sp); }
  // 🔴 IL DOCUMENTO PER LA FINAL FINISCE QUI (Germano, 22/08).
  // «Come non tornare indietro», «Da qui in avanti», le parole del coach e la
  // chiusura NON servono in sessione: nasceranno da quello che il Cliente dice, e
  // il documento da consegnare le riempirà leggendo il report della Final. Averle
  // qui vorrebbe dire mettergli in mano l'elenco delle domande che gli farai —
  // e fargli pensare che le stai leggendo.
  if (versione === 'consegna') {
    const sn = slidePunti(d.nonTornareIndietro, n + 1, 'Come non tornare indietro', 'nonTornareIndietro'); if (sn) { n++; pezzi.push(sn); }
    const sd = slideDomande(d.daQuiInAvanti, n + 1); if (sd) { n++; pezzi.push(sd); }
  }

  if (versione === 'consegna' && d.paroleDelCoach) pezzi.push(slide(`
    ${occhiello('Le parole del coach')}
    <h2 style="margin-bottom:12px">${esc(d.paroleDelCoach.titolo)}</h2>
    ${(d.paroleDelCoach.corpo || []).map((p, i) => `<p class="spieg coach-t">${ed(`paroleDelCoach.corpo.${i}`, esc(p))}</p>`).join('')}
    ${fonte('Bozza costruita dalle note conclusive dei report: da riscrivere con parole tue.')}`, ++n));

  if (versione === 'consegna' && d.chiusura) pezzi.push(slide(`
    ${occhiello('Chiusura')}
    <h2 style="margin-bottom:20px;max-width:24ch">${esc(d.chiusura.titolo)}</h2>
    <p class="chiu ultima">${ed('chiusura.messaggio', esc(d.chiusura.messaggio))}</p>
    <div class="coda"><b>Noesys Professional Coaching</b><br>${esc(nome)}</div>`, ++n, 'chiusura'));

  const corpo = `<div class="doc">${barra(azioni)}${pezzi.join('')}</div>`;
  if (soloCorpo) return corpo;
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(nome)} — chiusura del percorso</title>
<style>${CSS}</style></head>
<body class="sessione fonti">${corpo}${script()}</body></html>`;
}

const barra = (extra) => `<div class="barra">
  <button id="b-ses" class="on">Versione da sessione</button>
  <button id="b-con">Versione da consegnare</button>
  <span class="sep"></span>
  <button id="b-fon" class="on">Fonti e note</button>
  ${extra || ''}
</div>`;

// Il minimo indispensabile: i due interruttori. (La modifica e il salvataggio
// vivono nella pagina dell'Hub, dove c'è dove salvare.)
const script = () => `<script>
(function(){
  var b = document.body, ses = document.getElementById('b-ses'), con = document.getElementById('b-con'), fon = document.getElementById('b-fon');
  ses.onclick = function(){ b.classList.add('sessione'); b.classList.remove('consegna'); ses.classList.add('on'); con.classList.remove('on'); };
  con.onclick = function(){ b.classList.add('consegna'); b.classList.remove('sessione'); con.classList.add('on'); ses.classList.remove('on'); };
  fon.onclick = function(){ b.classList.toggle('fonti'); fon.classList.toggle('on'); };
})();
</script>`;

module.exports = { renderDocumento, ruotaSvg, dataLunga, CSS };
