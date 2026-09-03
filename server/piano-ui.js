// ═══════════════════════════════════════════════════════════════════════════
// LA FINESTRELLA DEL PIANO DI PAGAMENTO — una sola, per due pagine.
//
// Nasce il 15/08/2026 con la fetta C. Fino a ieri questa roba stava scritta
// dentro la pagina del progetto; il pacchetto ha bisogno della stessa identica
// cosa, e Germano l'ha detto chiaro: **riusarla, non riscriverla**.
// Il motivo non è l'eleganza: due copie della stessa finestrella sono due
// occasioni di divergere, ed è esattamente il guaio che abbiamo appena finito
// di riparare fra la scheda del progetto e quella del cliente.
//
// Qui dentro c'è SOLO ciò che è uguale per tutti:
//   · il disegno della finestrella (markup)
//   · le funzioni che la fanno vivere (ricalcolo, aggiungi/togli rata, scadenze)
//   · la tabella di SOLA LETTURA che sta sulla scheda
// Restano alla pagina le cose che cambiano davvero: chi sono i pagatori, dove
// si salva, e che comandi ha ogni riga.
//
// ⚠️ DUE LEZIONI DEL 15/08 CHE QUESTO FILE DEVE PROTEGGERE:
// 1. **Dentro la finestrella il DOM è la verità mentre scrivi.** Si aggiornano
//    solo i TESTI derivati (percentuale, somme, verifica, scadenza) e non si
//    tocca MAI l'HTML degli input: rifarli a ogni tasto distruggeva il campo e
//    buttava il cursore sul body (22 campi su 22). Toccare il DOM è ammesso solo
//    su un CLIC esplicito, dove nessuno sta scrivendo.
// 2. **Niente apici inclinati nei commenti** del blocco JS restituito da `js()`:
//    chiudono la template literal e la pagina non compila più. Presa due volte.
// ═══════════════════════════════════════════════════════════════════════════

const tranche = require('./tranche');
const fiscale = require('./fiscale');

/**
 * Il disegno della finestrella.
 * @param {object} o
 * @param {string} o.labelValore  come si chiama la cifra totale in questa pagina
 *   («Valore del progetto» per un progetto, «Prezzo del pacchetto» per un percorso).
 * @param {number|null} o.valore
 * @param {string} o.dataMeta   'AAAA-MM-GG' o ''
 * @param {string} o.dataFine   'AAAA-MM-GG' o ''
 * @param {string} o.sottotitolo
 * @param {boolean} o.mostraDividi  «Dividi in parti uguali» ha senso solo dove i
 *   pagatori sono più di uno: su un pacchetto paga una persona sola.
 */
function modale(o) {
  const val = o.valore != null ? o.valore : '';
  return `
    ${/* La larghezza è 860px FISSA e non un massimo: il 14/08 avevo scritto
          max-width credendo di allargarla, ma .modal-box ha gia' una width, e
          un massimo piu' grande non allarga niente. Restava da 520 mentre la
          tabella dentro ne chiedeva 718 — 198px fuori dal bordo. */ ''}
    <div class="modal-overlay" id="modal-piano">
      <div class="modal-box" style="width:860px">
        <h3 style="margin-top:0">Il piano di pagamento</h3>
        <p style="font-size:12.5px;color:var(--muted);margin-top:-6px">${o.sottotitolo}</p>

        <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div class="form-group" style="margin:0"><label id="q-totale-label">${o.labelValore} €</label>
            <input id="q-totale" type="number" step="1" min="0" value="${val}"
                   placeholder="es. 1200" oninput="ricalcolaPiano()" style="width:130px"></div>
          <div class="form-group" style="margin:0"><label>Metà percorso</label>
            <input id="pi-meta" type="date" value="${o.dataMeta || ''}"
                   oninput="ricalcolaPiano()" style="width:150px"></div>
          <div class="form-group" style="margin:0"><label>Fine prevista</label>
            <input id="pi-fine" type="date" value="${o.dataFine || ''}"
                   oninput="ricalcolaPiano()" style="width:150px"></div>
        </div>
        ${/* ⚠️ Quando la cifra e le date appartengono a un'altra pagina, i campi
              si MOSTRANO SPENTI invece di sparire: servono a capire da dove
              escono le scadenze. Un campo spento senza spiegazione però è solo
              un dispetto, quindi qui sotto c'è scritto dove si cambiano.
              Chi spegne e chi accende è il JS, al momento in cui si apre: la
              stessa finestrella serve un pacchetto (dove il prezzo si scrive) e
              la quota di un progetto (dove no). */ ''}
        <div id="piano-nota" style="display:none;font-size:11.5px;color:var(--hint);margin:-8px 0 12px"></div>

        <div id="piano-pagatori"></div>

        <div id="piano-verifica" style="margin-top:10px;font-size:12.5px"></div>
        <div id="piano-error" style="display:none;margin-top:8px" class="flash-error"></div>

        <div class="modal-actions" style="margin-top:16px">
          ${o.mostraDividi ? `<button onclick="dividiEqui()" class="btn btn-neutral btn-sm">Dividi in parti uguali</button>` : ''}
          <span style="flex:1"></span>
          <button onclick="chiudiPiano()" class="btn btn-neutral">Annulla</button>
          <button onclick="salvaTutto()" class="btn btn-primary">Salva il piano</button>
        </div>
      </div>
    </div>`;
}

/**
 * La finestrella «È arrivato il pagamento» — FETTA C4.
 * ⭐ Non era un ponte da buttare: è il posto dove si fa l'unico gesto che
 * l'Hub non può fare da solo, cioè dire che i soldi sono arrivati (la banca non
 * la vede). Quello che è cambiato è dove finisce il fatto: prima spuntava una
 * casella sulla rata, adesso registra un incasso sul DOCUMENTO — e da lì lo
 * stato si ricava, per le rate come per le sessioni.
 * ⭐ Propone l'intero residuo e lascia scrivere di meno: è così che si registra
 * un acconto (Fase 4), e più incassi possono stare sullo stesso documento.
 * La data si CHIEDE: scriverci «oggi» d'ufficio metterebbe la fattura nel mese
 * sbagliato, ed è il difetto D3 corretto il 15/08.
 */
function modaleIncasso() {
  return `
    <div class="modal-overlay" id="modal-incasso">
      <div class="modal-box" style="max-width:440px">
        <h3 style="margin-top:0">È arrivato il pagamento</h3>
        <p id="incasso-che" style="font-size:13px;color:var(--muted);margin-top:-6px"></p>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div class="form-group"><label>Quanto è arrivato €</label>
            <input id="incasso-importo" type="number" step="0.01" min="0" style="width:150px"></div>
          <div class="form-group"><label>Quando è arrivato</label>
            <input id="incasso-data" type="date" style="width:170px"></div>
        </div>
        <p id="incasso-manca" style="font-size:11.5px;color:var(--hint);margin-top:-4px"></p>
        <p style="font-size:11.5px;color:var(--hint)">
          Non è il giorno in cui lo segni: è il giorno in cui i soldi sono arrivati davvero.
          È da questa data che dipende in quale mese va la fattura.</p>
        <div class="modal-actions">
          <button onclick="chiudiIncasso()" class="btn btn-neutral">Annulla</button>
          <button onclick="confermaIncasso()" class="btn btn-primary">Registra l’incasso</button>
        </div>
      </div>
    </div>`;
}

/**
 * Le funzioni che fanno vivere finestrella e tabella. Da mettere dentro il
 * <script> della pagina.
 * @param {object} o
 * @param {Array} o.piani       [{key, pid, nome, ruolo, quota, tipo, righe:[...]}]
 * @param {string} o.dataFirma  la data da cui si contano le rate «alla firma»
 * @param {boolean} o.quotaPerPagatore  true dove ogni pagatore ha una sua quota
 *   (progetto). false dove il pagatore è uno solo e la sua quota È il totale
 *   (pacchetto): lì un secondo campo direbbe la stessa cosa due volte, e due
 *   campi che dicono la stessa cosa prima o poi si contraddicono.
 * ⚠️ La pagina deve definire per conto suo: `azioniPagatore(pg)` (i comandi
 * della riga di gruppo) e `salvaTutto()` (dove si salva).
 */
function js(o) {
  const inneschiOpt = Object.entries(tranche.INNESCHI)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  return `
    // ── Il piano di pagamento — parte condivisa (piano-ui.js) ──
    // Si salvano gli EURO; la percentuale è solo un modo di scriverli, e si
    // ricalcola sempre da importo/quota (regola del 27/07).
    var PIANI = ${JSON.stringify(o.piani).replace(/</g, '\\u003c')};
    var DATA_FIRMA = ${JSON.stringify(o.dataFirma || '')};
    var INNESCHI_OPT = ${JSON.stringify(inneschiOpt).replace(/</g, '\\u003c')};
    var STATI = ${JSON.stringify(tranche.STATI).replace(/</g, '\\u003c')};
    var QUOTA_PER_PAGATORE = ${o.quotaPerPagatore ? 'true' : 'false'};

    function scadenzaTranche(t) {
      var base = t.innesco === 'firma' ? DATA_FIRMA
               : t.innesco === 'meta'  ? (document.getElementById('pi-meta') || {}).value
               : (document.getElementById('pi-fine') || {}).value;
      if (!base) return null;
      var d = new Date(base + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + (Number(t.giorni) || 0));
      return d.toISOString().slice(0, 10);
    }
    function itData(iso) {
      if (!iso) return '';
      var q = iso.split('-');
      return q[2] + '/' + q[1] + '/' + q[0];
    }
    function pianoDi(key) {
      for (var i = 0; i < PIANI.length; i++) if (PIANI[i].key === key) return PIANI[i];
      return null;
    }
    function esc2(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    // ⚠️ Gemella di fiscale.euroIntero(), ma per il BROWSER: qui il modulo del
    // server non si puo chiamare. Stesse opzioni, cosi lo stesso importo si
    // scrive uguale in pagina e nei messaggi che arrivano dal server.
    // useGrouping always = il punto delle migliaia anche sotto le 5 cifre
    // (scelta di Germano del 17/08, contro il default italiano).
    function eur2(n) { return (Math.round(Number(n)||0)).toLocaleString('it-IT', { useGrouping: 'always' }); }

    // ═══════════════════════════════════════════════════════════════════════
    // LA TABELLA — SOLA LETTURA. Nessun campo da scrivere: quelli stanno tutti
    // nella finestrella. Mostra cio che e SALVATO, non le proposte: una rata
    // proposta non e un impegno, e vederla qui faceva credere che ci fosse un
    // piano dove non c era.
    // ═══════════════════════════════════════════════════════════════════════
    function disegnaPiano() {
      var body = document.getElementById('amm-righe');
      if (!body) return;
      var html = '';
      PIANI.forEach(function (pg) {
        var salvate = pg.righe.filter(function (t) { return t.id; });
        html += '<tr style="background:#f7f9fb">'
          + '<td><strong>' + esc2(pg.nome || '—') + '</strong>'
          + ' <span style="font-size:11px;color:var(--hint)">' + pg.ruolo + '</span></td>'
          + '<td><strong>' + (pg.quota ? '€ ' + eur2(pg.quota) : '<span style="color:var(--hint)">quota da scrivere</span>') + '</strong></td>'
          + '<td colspan="2" style="font-size:12px;color:var(--hint)">'
          + (salvate.length ? salvate.length + (salvate.length === 1 ? ' rata' : ' rate') : 'nessun piano salvato')
          + '</td>'
          + '<td style="text-align:right;white-space:nowrap">' + azioniPagatore(pg) + '</td></tr>';

        if (!salvate.length && pg.quota) {
          html += '<tr><td colspan="5" style="padding-left:26px;font-size:12.5px;color:var(--hint)">'
            + 'Il piano non è ancora salvato — apri «Modifica il piano».</td></tr>';
        }
        salvate.forEach(function (t) {
          var perc = pg.quota ? Math.round(t.importo / pg.quota * 100) : null;
          var scad = scadenzaTranche(t);
          var st = STATI[t.stato] || STATI.da_chiedere;
          // C3b — da qui si chiede il pagamento della singola rata. Lo stato
          // arriva gia RICAVATO dal server: chiesta = sta in una proforma viva.
          // ⭐ C4 — «È arrivato» ha cambiato mestiere: non spunta più una casella
          // sulla rata, registra un incasso SUL DOCUMENTO che la contiene. Il
          // gesto per chi lo preme è identico; cambia dove finisce il fatto, e
          // da lì lo stato della rata si ricava invece di essere scritto.
          var d = t.doc || {};
          var comando = t.stato === 'da_chiedere'
            ? '<button onclick="chiediRata(\\'' + t.id + '\\',\\'' + esc2(t.etichetta) + ', € ' + eur2(t.importo) + '\\')" class="btn btn-primary btn-sm">Chiedi il pagamento</button>'
            : t.stato === 'da_mandare'
            ? '<a href="/dashboard/amministrazione/proforma" class="btn btn-primary btn-sm">Rileggi e manda</a>'
            : t.stato === 'incassata'
            ? '<span style="font-size:11.5px;color:var(--hint)">' + (t.data_incasso ? 'il ' + itData(t.data_incasso) : '') + '</span>'
              // Un incasso si disfa da dove è stato registrato — dal documento.
              // Il pulsante «Annulla» resta solo dove non c'è nessun documento:
              // le rate segnate a mano prima di C4, che altrimenti resterebbero
              // prigioniere di una colonna che non scrive più nessuno.
              + (d.proformaId
                 ? ' <a href="/dashboard/amministrazione/proforma" style="font-size:11.5px;color:var(--muted)">n. ' + esc2(d.numero) + '</a>'
                 : ' <button onclick="segnaStato(\\'' + t.id + '\\',\\'da_chiedere\\')" class="btn btn-neutral btn-sm" title="Torna indietro">Annulla</button>')
            : d.proformaId
            ? '<button onclick="apriIncasso(\\'' + d.proformaId + '\\',\\'' + esc2(pg.nome) + ' — ' + esc2(t.etichetta) + '\\',' + (Number(d.residuo) || 0) + ')" class="btn btn-neutral btn-sm">È arrivato</button>'
            : '';
          html += '<tr>'
            + '<td style="padding-left:26px">' + esc2(t.etichetta)
            + (perc !== null ? ' <span style="font-size:11px;color:var(--hint)">' + perc + '%</span>' : '') + '</td>'
            + '<td style="white-space:nowrap">€ ' + eur2(t.importo) + '</td>'
            + '<td style="font-size:12px;white-space:nowrap;color:' + (scad ? 'var(--ink)' : 'var(--hint)') + '">'
            + (scad ? itData(scad) : '—') + '</td>'
            + '<td style="white-space:nowrap"><span class="badge" style="background:' + st.bg + ';color:' + st.c + '">' + st.label + '</span></td>'
            + '<td style="text-align:right;white-space:nowrap">' + comando + '</td>'
            + '</tr>';
        });
      });
      if (!PIANI.length) html = '<tr><td colspan="5" class="empty">Nessun pagatore: apri «Modifica il piano».</td></tr>';
      body.innerHTML = html;
      if (typeof dopoDisegnaPiano === 'function') dopoDisegnaPiano();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LA FINESTRELLA — qui si scrive, e QUI GLI INPUT NON SI RIDISEGNANO MAI
    // mentre digiti. Era quello il difetto: ogni tasto rifaceva la tabella con
    // innerHTML, il campo spariva sotto le dita e il cursore finiva sul body.
    // Adesso il DOM e la verita finche la finestrella e aperta: si aggiornano
    // solo i TESTI derivati (la percentuale, le somme, la verifica).
    // ═══════════════════════════════════════════════════════════════════════
    // ⭐ FETTA 0.1 (03/09/2026) — una rata che sta gia in un documento, o che
    // risulta incassata, e FERMA: i suoi campi si vedono spenti, non ha il
    // cestino, e al posto del cestino dice in che stato e e in quale proforma.
    // Il server rifiuta comunque di toccarla (la regola vera sta li, in
    // tranche.riconcilia): qui si evita solo di far scrivere a vuoto.
    // Ogni riga porta il suo id in data-id: e cosi che il server la riconosce.
    function rataFerma(t) { return !!(t && t.id && t.stato && t.stato !== 'da_chiedere'); }
    function rigaPianoHtml(key, t) {
      var ferma = rataFerma(t);
      var off = ferma ? ' disabled' : '';
      var st = ferma ? (STATI[t.stato] || STATI.da_chiedere) : null;
      var doc = (t && t.doc) || {};
      var coda = ferma
        ? '<span class="badge" style="background:' + st.bg + ';color:' + st.c + '" title="Questa rata sta gia in un documento: non si cambia e non si toglie. Si cambiano le altre.">'
          + st.label + (doc.numero ? ' · n. ' + esc2(doc.numero) : '') + '</span>'
        : '<button onclick="togliRiga(this)" class="btn btn-danger btn-sm" title="Togli la rata">🗑</button>';
      return '<tr data-key="' + key + '"' + (t && t.id ? ' data-id="' + esc2(t.id) + '"' : '') + (ferma ? ' data-ferma="1"' : '') + '>'
        + '<td><input class="pr-et" value="' + esc2(t.etichetta) + '" style="width:120px"' + off + '></td>'
        + '<td style="white-space:nowrap"><input class="pr-imp" type="number" step="1" min="0" value="' + (Math.round(Number(t.importo)||0)) + '" oninput="ricalcolaPiano()" style="width:96px"' + off + '>'
        + ' <span class="pr-perc" style="font-size:11px;color:var(--hint)"></span></td>'
        + '<td><select class="pr-inn" onchange="ricalcolaPiano()" style="width:140px"' + off + '>' + INNESCHI_OPT + '</select></td>'
        + '<td><input class="pr-gg" type="number" step="1" min="0" value="' + (Number(t.giorni)||0) + '" oninput="ricalcolaPiano()" style="width:56px"' + off + '></td>'
        + '<td class="pr-scad" style="font-size:12px;white-space:nowrap;color:var(--hint)"></td>'
        + '<td style="text-align:right">' + coda + '</td>'
        + '</tr>';
    }
    function costruisciFinestrella() {
      var box = document.getElementById('piano-pagatori');
      if (!box) return;
      var html = '';
      PIANI.forEach(function (pg) {
        // Dove il pagatore e uno solo, la sua quota E il totale: niente secondo
        // campo. Il riquadro lo dichiara con data-quota-totale e quotaDi() va a
        // leggere il totale, cosi il resto del codice non cambia di una riga.
        var intestazione = QUOTA_PER_PAGATORE
          ? '<span style="margin-left:auto;display:flex;align-items:center;gap:8px">'
            + '<label style="margin:0;text-transform:none;letter-spacing:0;font-size:12px;color:var(--muted)">Quota €</label>'
            + (pg.tipo === 'committente'
               ? '<input id="q-comm" type="number" step="1" min="0" value="' + (pg.quota || '') + '" oninput="ricalcolaPiano()" placeholder="€" style="width:110px">'
               : '<input class="q-coachee" data-part="' + pg.pid + '" type="number" step="1" min="0" value="' + (pg.quota || '') + '" oninput="ricalcolaPiano()" placeholder="€" style="width:110px">')
            + '<button onclick="aggiungiRiga(\\'' + pg.key + '\\')" class="btn btn-neutral btn-sm">+ rata</button>'
            + '</span>'
          : '<span style="margin-left:auto">'
            + '<button onclick="aggiungiRiga(\\'' + pg.key + '\\')" class="btn btn-neutral btn-sm">+ rata</button>'
            + '</span>';
        html += '<div class="pg-box" data-key="' + pg.key + '"' + (QUOTA_PER_PAGATORE ? '' : ' data-quota-totale="1"')
          + ' style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px">'
          + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'
          + '<strong>' + esc2(pg.nome || '—') + '</strong>'
          + '<span style="font-size:11px;color:var(--hint)">' + pg.ruolo + '</span>'
          + intestazione + '</div>'
          + '<div style="overflow-x:auto">'
          + '<table style="width:100%"><thead><tr>'
          + '<th style="text-align:left;font-size:11px;color:var(--muted)">Rata</th>'
          + '<th style="text-align:left;font-size:11px;color:var(--muted)">Importo €</th>'
          + '<th style="text-align:left;font-size:11px;color:var(--muted)">Quando</th>'
          + '<th style="text-align:left;font-size:11px;color:var(--muted)">Giorni</th>'
          + '<th style="text-align:left;font-size:11px;color:var(--muted)">Scade il</th>'
          + '<th></th></tr></thead>'
          + '<tbody class="pg-righe">' + pg.righe.map(function (t) { return rigaPianoHtml(pg.key, t); }).join('') + '</tbody></table></div>'
          + '<div class="pg-check" style="font-size:12px;margin-top:6px"></div>'
          + '</div>';
      });
      if (!PIANI.length) html = '<div class="empty">Nessun pagatore.</div>';
      box.innerHTML = html;
      // Le tendine si riempiono DOPO: il markup delle opzioni e uguale per tutte
      // e il valore scelto si perderebbe.
      PIANI.forEach(function (pg) {
        var righe = box.querySelectorAll('.pg-box[data-key="' + pg.key + '"] .pg-righe tr');
        pg.righe.forEach(function (t, i) {
          var sel = righe[i] && righe[i].querySelector('.pr-inn');
          if (sel) sel.value = t.innesco;
        });
      });
      ricalcolaPiano();
    }
    function leggiRiga(tr) {
      return {
        // ⭐ 0.1 — l'id viaggia con la riga: senza, il server non puo sapere che
        // questa e la rata ferma e la tratterebbe come tolta. (Un campo spento si
        // legge lo stesso: disabled toglie la scrittura, non il valore.)
        id: tr.getAttribute('data-id') || null,
        etichetta: tr.querySelector('.pr-et').value,
        importo: Math.round(Number(tr.querySelector('.pr-imp').value) || 0),
        innesco: tr.querySelector('.pr-inn').value,
        giorni: Number(tr.querySelector('.pr-gg').value) || 0,
      };
    }
    function quotaDi(box) {
      if (box.getAttribute('data-quota-totale')) {
        return Math.round(Number((document.getElementById('q-totale') || {}).value) || 0);
      }
      var q = box.querySelector('#q-comm') || box.querySelector('.q-coachee');
      return Math.round(Number(q ? q.value : 0) || 0);
    }
    // ⭐ NON tocca l HTML degli input: aggiorna solo i testi che dipendono da
    // quello che hai appena scritto. E la riga che rende la scheda scrivibile.
    function ricalcolaPiano() {
      var totale = Math.round(Number((document.getElementById('q-totale') || {}).value) || 0);
      var somma = 0;
      document.querySelectorAll('#piano-pagatori .pg-box').forEach(function (box) {
        var quota = quotaDi(box);
        somma += quota;
        var sommaRate = 0;
        box.querySelectorAll('.pg-righe tr').forEach(function (tr) {
          var r = leggiRiga(tr);
          sommaRate += r.importo;
          tr.querySelector('.pr-perc').textContent = quota ? '= ' + Math.round(r.importo / quota * 100) + '%' : '';
          var s = scadenzaTranche(r);
          tr.querySelector('.pr-scad').textContent = s ? itData(s) : '—';
        });
        var diff = quota - sommaRate;
        var c = box.querySelector('.pg-check');
        c.innerHTML = !quota ? '<span style="color:var(--hint)">Scrivi la cifra concordata.</span>'
          : (diff === 0 ? '<span style="color:#4F8B73">Le rate tornano: € ' + eur2(quota) + '.</span>'
             : '<span style="color:#b45309">' + (diff > 0 ? 'Mancano € ' + eur2(diff) : '€ ' + eur2(-diff) + ' di troppo')
               + ' — le rate fanno € ' + eur2(sommaRate) + ' su € ' + eur2(quota) + '.</span>');
      });
      var v = document.getElementById('piano-verifica');
      if (v) {
        // Dove il pagatore e uno solo, il riquadro sopra dice gia tutto: una
        // seconda riga che ripete lo stesso conto e solo rumore.
        v.innerHTML = !QUOTA_PER_PAGATORE ? ''
          : (!totale ? '<span style="color:var(--hint)">Scrivi il valore del progetto.</span>'
             : (somma === totale ? '<span style="color:#4F8B73">Le quote coprono € ' + eur2(totale) + ' — torna.</span>'
                : '<span style="color:#b45309">Le quote sommano € ' + eur2(somma) + ' su € ' + eur2(totale)
                  + (totale - somma > 0 ? ': mancano € ' + eur2(totale - somma) : ': € ' + eur2(somma - totale) + ' di troppo') + '.</span>'));
      }
    }
    // Prepara la finestrella per un caso o per l'altro. bloccati = la cifra e
    // le date appartengono a un altra pagina: si vedono ma non si toccano.
    // (⚠️ niente apici inversi qui dentro: chiudono la template literal.)
    function preparaPiano(etichetta, bloccati, nota) {
      var lab = document.getElementById('q-totale-label');
      if (lab) lab.textContent = etichetta + ' €';
      ['q-totale', 'pi-meta', 'pi-fine'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = !!bloccati;
      });
      var n = document.getElementById('piano-nota');
      if (n) { n.textContent = nota || ''; n.style.display = nota ? 'block' : 'none'; }
    }
    function apriPiano() { document.getElementById('modal-piano').style.display = 'flex'; ricalcolaPiano(); }
    function chiudiPiano() { document.getElementById('modal-piano').style.display = 'none'; }
    // ⭐ La rata nuova nasce con quello che MANCA, non con zero: prima nasceva a
    // 0 € e faceva scattare subito due errori insieme (una rata a zero e le
    // rate non tornano), bloccando il salvataggio. Il pulsante creava un guasto.
    function aggiungiRiga(key) {
      var box = document.querySelector('#piano-pagatori .pg-box[data-key="' + key + '"]');
      if (!box) return;
      var quota = quotaDi(box), somma = 0;
      box.querySelectorAll('.pg-righe tr').forEach(function (tr) { somma += leggiRiga(tr).importo; });
      var manca = Math.max(quota - somma, 0);
      var tb = box.querySelector('.pg-righe');
      var n = tb.querySelectorAll('tr').length + 1;
      tb.insertAdjacentHTML('beforeend', rigaPianoHtml(key,
        { etichetta: 'Rata ' + n, importo: manca, innesco: 'fine', giorni: 30 }));
      // ⚠️ La tendina nasce senza niente di scelto: le opzioni sono nel markup,
      // ma il valore va messo DOPO averla inserita. Senza questa riga una rata
      // nuova diceva sempre Alla firma, qualunque cosa volesse il codice — e
      // una rata con l innesco sbagliato ha la scadenza sbagliata.
      var ultime = tb.querySelectorAll('tr');
      var sel = ultime[ultime.length - 1].querySelector('.pr-inn');
      if (sel) sel.value = 'fine';
      ricalcolaPiano();
    }
    function togliRiga(btn) { var tr = btn.closest('tr'); tr.parentNode.removeChild(tr); ricalcolaPiano(); }

    // Legge la finestrella e restituisce, per ogni pagatore, quota e righe.
    // ⚠️ Si legge dai CAMPI, non da PIANI: e il DOM la verita mentre si scrive.
    function leggiFinestrella() {
      var perKey = {};
      document.querySelectorAll('#piano-pagatori .pg-box').forEach(function (box) {
        var key = box.getAttribute('data-key');
        var righe = [];
        box.querySelectorAll('.pg-righe tr').forEach(function (tr, i) {
          var r = leggiRiga(tr);
          r.ordine = i;
          righe.push(r);
        });
        var pg = pianoDi(key) || {};
        perKey[key] = { quota: quotaDi(box), righe: righe, pid: pg.pid || null, tipo: pg.tipo };
      });
      return perKey;
    }

    async function segnaStato(id, stato, dataIncasso) {
      try {
        var r = await fetch('/dashboard/tranche/' + id + '/stato', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stato: stato, data_incasso: dataIncasso || null }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
    // C3b — la proforma di UNA rata. Il numero che nasce non si riusa, quindi
    // si conferma nominando la rata e non con un generico sei sicuro.
    async function chiediRata(id, che) {
      if (!confirm('Creo la proforma per ' + che + '?\\n\\nIl numero che le viene assegnato non potra essere riusato.')) return;
      try {
        var r = await fetch('/dashboard/tranche/' + id + '/proforma', { method: 'POST' });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(d.error || ('Errore ' + r.status)); return; }
        // ⭐ 17/08 — il documento e CREATO, non mandato. Germano, provando:
        // «non c e stato nessun passaggio di verifica e invio mail… non ho
        // ricevuto la mail». Il passaggio esiste, ma nessuno lo portava li.
        // La pagina VA dove si rilegge e si manda: una riga che chiede di fare
        // una cosa deve portare dove la si fa.
        // 🔴 18/08 — QUI C ERA ANCORA window.open(...pdf, '_blank'), cioe la
        // scheda nuova senza via d uscita. La correzione del PDF aveva coperto
        // i punti dove si APRE un documento gia esistente, non il momento in
        // cui NASCE — e Germano l ha trovato in un minuto sulla seconda rata di
        // Flamingo. ➜ Lezione: quando si cambia il modo di aprire una cosa,
        // cercare TUTTI i modi in cui quella cosa si apre, compresi quelli che
        // scattano da soli dopo un altra azione.
        // Adesso l id viaggia fino alla pagina di destinazione, che apre la
        // finestrella da sola: si rilegge subito, e si chiude.
        try { sessionStorage.setItem('pdf-appena-nata',
          JSON.stringify({ id: d.id, titolo: 'Proforma n. ' + d.numero })); } catch (e) {}
        alert('Creata la proforma n. ' + d.numero + '.\\n\\nNon e ancora partita: adesso va riletta e mandata.');
        window.location = '/dashboard/amministrazione/proforma';
      } catch (ex) { alert('Errore di rete: ' + ex.message); }
    }
    ${jsIncasso()}`;
}

/**
 * ⭐ C4 — IL JS DELLA FINESTRELLA DELL'INCASSO, in un posto solo.
 * Lo usano due pagine diverse: le schede col piano di pagamento (di qui) e la
 * pagina Proforma, dove sta la fila dei documenti in attesa. Scriverlo due volte
 * vorrebbe dire due modi di registrare la stessa cosa — ed è esattamente
 * l'errore che questa fetta sta togliendo.
 * ⚠️ Va insieme a `modaleIncasso()`: uno è il markup, l'altro lo fa vivere.
 */
function jsIncasso() {
  return `
    // L'incasso si appende al DOCUMENTO, non alla rata: è la mossa che fa
    // valere lo stesso giro per le sessioni, le rate di progetto e i pacchetti.
    var INCASSO_PF = null;
    function apriIncasso(proformaId, che, residuo) {
      INCASSO_PF = proformaId;
      document.getElementById('incasso-che').textContent = che;
      // Proposto l'intero residuo, correggibile: scrivendo meno si registra un
      // acconto e il documento resta aperto per quello che manca.
      document.getElementById('incasso-importo').value = (Number(residuo) || 0).toFixed(2);
      document.getElementById('incasso-manca').textContent =
        'Su questo documento mancano € ' + eur2Cent(residuo) + '. Se ne è arrivata solo una parte, scrivi quella.';
      document.getElementById('incasso-data').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
      document.getElementById('modal-incasso').style.display = 'flex';
    }
    function chiudiIncasso() { document.getElementById('modal-incasso').style.display = 'none'; }
    // Gli incassi hanno i CENTESIMI (è l'IVA a produrli), le rate no: per questo
    // non basta la eur2() delle rate. Stesse opzioni di fiscale.euro() sul
    // server, così lo stesso importo si scrive uguale di qua e di là.
    function eur2Cent(n) {
      return (Number(n) || 0).toLocaleString('it-IT',
        { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
    }
    async function confermaIncasso() {
      var d = document.getElementById('incasso-data').value;
      var imp = document.getElementById('incasso-importo').value;
      if (!d) { alert('Scrivi quando è arrivato il pagamento.'); return; }
      if (!(Number(imp) > 0)) { alert('Scrivi quanto è arrivato.'); return; }
      try {
        var r = await fetch('/dashboard/proforma/' + INCASSO_PF + '/incasso', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importo: Number(imp), data_incasso: d }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        // Se manca ancora qualcosa lo si dice subito: il documento resta aperto
        // e il promemoria continuerà a chiederlo.
        if (!j.saldata) {
          alert('Registrato. Sul documento n. ' + j.numero + ' mancano ancora € ' + eur2Cent(j.residuo) + '.');
        }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }`;
}

/**
 * I quattro numeri in cima all'Amministrazione. Stessi nomi e stessi colori
 * ovunque: «chiesto ma non ancora pagato» è lo stato in cui si vive per
 * settimane, e senza una casella sua sparirebbe dentro «da incassare».
 * @param {object} t4 il risultato di `tranche.totali()`
 * @param {boolean} conPiano  se esiste già un piano salvato
 */
function quattroNumeri(t4, conPiano) {
  const eur = fiscale.euro;
  const n = (label, id, valore, bg, cLab, cVal) => `
          <div class="amm-num" style="background:${bg};border-radius:8px;padding:9px 11px">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:${cLab}">${label}</div>
            <div id="${id}" class="amm-num-v" style="font-size:17px;font-weight:700;color:${cVal}">€ ${eur(valore)}</div>
          </div>`;
  return `
        ${/* 🔴 NON `repeat(4, 1fr)`: quattro colonne fisse a 375px sbordano di 17px
              e fanno scivolare di lato TUTTA la pagina (misurato il 31/08 sulla
              scheda cliente). La pagina progetto aveva già la sua toppa in una
              media query; la scheda cliente no. ⭐ Corretto QUI, dove i numeri
              nascono, invece di copiare la toppa: due elenchi scritti a mano
              divergono sempre. `auto-fit` va a capo da solo quando non ci sta. */ ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px">
          ${n('Concordato',  'amm-atteso',     t4.concordato, '#f4f7fa', '#9AA0AA', 'var(--ink)')}
          ${n('Da chiedere', 'amm-dachiedere', t4.daChiedere, '#f7f9fb', '#6B7280', '#4a5568')}
          ${n('Chiesto',     'amm-chiesto',    t4.chiesto,    '#fdf6ec', '#b7791f', '#7a5c00')}
          ${n('Incassato',   'amm-incassato',  t4.incassato,  '#eafaf1', '#4F8B73', '#065f46')}
        </div>
        ${!conPiano ? `<div style="font-size:11.5px;color:var(--hint);margin-top:4px">Gli ultimi tre restano a zero finché non salvi il piano.</div>` : ''}`;
}

/**
 * Le righe di un pagatore, pronte per la finestrella: quelle SALVATE se ci
 * sono, altrimenti la proposta dell'Hub. La proposta non si salva da sola —
 * finché non premi Salva non è un impegno con nessuno.
 */
function righeDi(salvate, quota, tipo, chieste) {
  if (salvate && salvate.length) {
    return salvate.map(t => ({
      id: t.id, etichetta: t.etichetta, importo: Math.round(Number(t.importo)),
      innesco: t.innesco, giorni: Number(t.giorni),
      // ⭐ C3 — lo stato che arriva alla pagina è quello RICAVATO: «chiesta» vuol
      // dire «sta in una proforma viva», e lo decide `tranche.statoDi()` in un
      // posto solo. La pagina non deve saperne niente.
      stato: tranche.statoDi(t, chieste),
      // ⭐ C4 — la rata si porta dietro il DOCUMENTO che la contiene: senza, il
      // pulsante «È arrivato» non saprebbe su cosa appendere l'incasso.
      doc: (chieste && chieste.get ? chieste.get(t.id) : null) || null,
      // La data dell'incasso viene dal documento; quella sulla colonna vale solo
      // all'indietro, per chi era stato segnato col pulsante-ponte prima di C4.
      data_incasso: (chieste && chieste.get && (chieste.get(t.id) || {}).ultimoIncasso)
        || (t.data_incasso ? String(t.data_incasso).slice(0, 10) : null),
    }));
  }
  return quota > 0
    ? tranche.pianoProposto(quota, tipo).map(r => ({ ...r, id: null, stato: 'da_chiedere', data_incasso: null }))
    : [];
}

module.exports = { modale, modaleIncasso, js, jsIncasso, quattroNumeri, righeDi };
