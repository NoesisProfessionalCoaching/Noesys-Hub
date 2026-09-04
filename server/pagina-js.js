/**
 * IL JAVASCRIPT COMUNE DELLE PAGINE — fetta 4.4 del riordino (04/09/2026).
 *
 * La scheda cliente, la pagina del progetto e la home avevano ognuna la PROPRIA
 * copia delle stesse funzioni (apriApp/scriviApp/togliApp, oreAuto/editSeduta/
 * saveSeduta/delSeduta/approvaSeduta, muoviContratto, copyLink/showToast) — e
 * le copie avevano già preso strade diverse (B9 della ricognizione: il progetto
 * chiedeva conferma al congelamento, la scheda no). Qui ogni gruppo è scritto
 * UNA volta; le differenze legittime fra pagine sono parametri, non copie.
 * Come già `piano-ui.js` per la finestrella del piano.
 *
 * ⚠️ Le stringhe qui dentro finiscono in una pagina: valgono le trappole del
 *    repo (\\' per l'apostrofo, \\d nelle regex, niente backtick nei commenti).
 *    La sintassi di ogni generatore la controlla `prova-js-pagine`.
 */

/** showToast(msg) e copyLink(url): un solo avviso leggero, uguale ovunque. */
function toast() {
  return `
    function showToast(msg) {
      var t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg || 'Link copiato!';
      t.style.display = 'block';
      setTimeout(function () { t.style.display = 'none'; }, 2000);
    }
    function copyLink(url) { navigator.clipboard.writeText(url).then(function () { showToast('Link copiato!'); }); }`;
}

/**
 * La finestrella dell'appuntamento (home e scheda cliente).
 * @param {{conChi?:boolean, confermaTogli:string}} o  conChi: la home mostra anche il nome
 */
function appuntamento({ conChi = false, confermaTogli }) {
  return `
    function apriApp(pid${conChi ? ', chi' : ''}, data, ora) {
      appPercorso = pid;${conChi ? `
      document.getElementById('ap-chi').textContent = chi;` : ''}
      document.getElementById('ap-data').value = data || '';
      document.getElementById('ap-ora').value = /^\\d{1,2}:\\d{2}$/.test(ora || '') ? ora : '';
      document.getElementById('ap-error').style.display = 'none';
      document.getElementById('modal-app').style.display = 'flex';
    }
    async function scriviApp(data, ora) {
      var err = document.getElementById('ap-error');
      var btn = document.getElementById('ap-salva');
      btn.disabled = true; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/percorsi/' + appPercorso + '/appuntamento', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data, ora: ora }) });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block'; btn.disabled = false; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; btn.disabled = false; }
    }
    function salvaApp() {
      scriviApp(document.getElementById('ap-data').value, document.getElementById('ap-ora').value);
    }
    function togliApp() {
      if (!confirm(${JSON.stringify(confermaTogli)})) return;
      scriviApp('', '');
    }`;
}

/**
 * La finestrella della sessione (scheda cliente e pagina progetto).
 * @param {{
 *   oreTipo:string,            nome della mappa tipo→ore già in pagina (ORE_TIPO / ORE_TIPO_COLL)
 *   richiedePercorso:boolean,  la scheda cliente ha la tendina #s-percorso; il progetto no
 *   basePercorso:string,       espressione JS che, dato pid, dà la base della rotta
 *   pidSalvataggio:string,     espressione JS del percorso su cui salvare
 *   ricarica:string,           istruzione JS che ricarica (location.reload() / ricaricaConservando())
 *   confermaElimina:string, confermaApprova:string
 * }} o
 */
function sedute({ oreTipo, richiedePercorso, basePercorso, pidSalvataggio, ricarica, confermaElimina, confermaApprova }) {
  return `
    function oreAuto() {
      const t = document.getElementById('s-tipo').value;
      const auto = ${oreTipo}[t];
      const ore = document.getElementById('s-ore'), hint = document.getElementById('s-ore-hint');
      ore.readOnly = false;
      if (auto != null) { ore.value = auto; hint.textContent = '(preimpostate per ' + t + ', modificabili)'; }
      else { hint.textContent = '(Final: a mano)'; }
    }
    function editSeduta(sid) {
      const s = SEDUTE[sid]; if (!s) return;
      document.getElementById('seduta-title').textContent = 'Modifica sessione';
      document.getElementById('s-id').value = s.id;${richiedePercorso ? `
      document.getElementById('s-percorso').value = s.percorso_id;` : ''}
      document.getElementById('s-tipo').value = s.tipo;
      document.getElementById('s-data').value = s.data ? String(s.data).slice(0, 10) : '';
      document.getElementById('s-obiettivo').value = s.obiettivo || '';
      document.getElementById('s-argomenti').value = s.argomenti || '';
      document.getElementById('s-attivita').value = s.attivita || '';
      document.getElementById('s-scadenza').value = s.scadenza || '';
      document.getElementById('s-ora').value = /^\\d{1,2}:\\d{2}$/.test(s.prossima_ora || '') ? s.prossima_ora : '';
      document.getElementById('s-eseguita').value = s.eseguita || '';
      document.getElementById('s-note').value = s.note || '';
      oreAuto();
      document.getElementById('s-ore').value = s.ore;
      document.getElementById('modal-seduta').style.display = 'flex';
    }
    async function saveSeduta() {
      const pid = ${pidSalvataggio};${richiedePercorso ? `
      if (!pid) { alert('Serve un percorso'); return; }` : ''}
      const sid = document.getElementById('s-id').value;
      const g = id => document.getElementById(id).value;
      const body = { tipo: g('s-tipo'), data: g('s-data') || null, ore: g('s-ore') || 0, obiettivo: g('s-obiettivo'), argomenti: g('s-argomenti'), attivita: g('s-attivita'), scadenza: g('s-scadenza'), prossima_ora: g('s-ora'), eseguita: g('s-eseguita'), note: g('s-note') };
      const url = ${basePercorso} + '/sedute' + (sid ? ('/' + sid) : '');
      if (!await chiamaHub(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) return;
      ${ricarica};
    }
    async function delSeduta(sid, pid) {
      if (!confirm(${JSON.stringify(confermaElimina)})) return;
      if (!await chiamaHub(${basePercorso} + '/sedute/' + sid, { method: 'DELETE' })) return;
      ${ricarica};
    }
    async function approvaSeduta(sid, pid) {
      if (!confirm(${JSON.stringify(confermaApprova)})) return;
      const r = await fetch(${basePercorso} + '/sedute/' + sid + '/approva', { method: 'POST' });
      let d = {}; try { d = await r.json(); } catch (e) {}
      // Era la Final e il percorso risulta ancora aperto: lo si fa notare qui, che
      // e' il momento in cui te ne accorgi. L'approvazione e' gia' avvenuta: se la
      // chiusura viene rifiutata lo si dice, ma si ricarica lo stesso.
      if (d.proponiChiusura && confirm('Questa era la sessione Final. Chiudo anche il percorso, con data ' + d.dataFineIt + '?')) {
        await chiamaHub(${basePercorso} + '/chiudi',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_fine: d.dataFine }) });
      }
      ${ricarica};
    }`;
}

/**
 * Lo stato della bozza di contratto: una rotta per i tre tipi.
 * @param {{confermaCongelamento:boolean, ricarica:string}} o  solo il progetto chiede conferma
 *   quando il contratto del Committente torna firmato (congela le specifiche)
 */
function muoviContratto({ confermaCongelamento, ricarica }) {
  return `
    async function muoviContratto(tipo, soggetto, stato) {${confermaCongelamento ? `
      if (tipo === 'committente' && stato === 'approvata'
          && !confirm("Il contratto del Committente risulta firmato.\\n\\nDa questo momento le specifiche del progetto si congelano: tipologia, partecipanti, sessioni e valore non si cambiano piu'.\\n\\nProcedo?")) return;` : ''}
      const r = await fetch('/dashboard/contratti/stato', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipo, soggetto_id: soggetto, stato: stato }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); return; }
      ${ricarica};
    }`;
}

module.exports = { toast, appuntamento, sedute, muoviContratto };
