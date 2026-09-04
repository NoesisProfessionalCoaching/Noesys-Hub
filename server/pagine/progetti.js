/**
 * I PROGETTI — committenti, elenco progetti, pagina del progetto e le sue card.
 * Fetta 4.1 del riordino (04/09/2026): spostato da routes.js così com'era.
 */
const chiamaUi = require('../chiama-ui');
const collaudo = require('../collaudo');
const contrattiStato = require('../contratti-stato');
const contratto = require('../contratto');
const fiscale = require('../fiscale');
const paginaJs = require('../pagina-js');
const pianoUi = require('../piano-ui');
const statoUi = require('../stato-ui');
const tranche = require('../tranche');
const { STRUMENTI, baseStyle, esc, fmtOre, headerNoesys, itDate, renderSedutaRow, sezionePieghevole } = require('./comune');

function committentiPage(committenti, req) {
  const TIPO_CFG = {
    azienda: { label: 'Azienda',  bg: '#e7f1ec', color: '#2e6b52' },
    persona: { label: 'Persona',  bg: '#e8f4fd', color: '#1A5280' },
  };

  function renderRow(k) {
    const tc = TIPO_CFG[k.tipo] || TIPO_CFG.azienda;
    const fatt = [k.partita_iva ? 'P.IVA '+esc(k.partita_iva) : '', k.codice_fiscale ? 'CF '+esc(k.codice_fiscale) : '']
      .filter(Boolean).join(' · ');
    // Il verdetto «pronto per fatturare» (11/08). Come per i clienti, compare solo
    // dove ci sono soldi veri in gioco: un committente senza quota da pagare non
    // ha niente da fatturare, quindi non ha niente da segnalare.
    const st = fiscale.statoFatturabilita(fiscale.daCommittente(k));
    const STILE = {
      pronto:        { bg:'#e7f1ec', color:'#2e6b52', segno:'✅ ' },
      incompleto:    { bg:'#fdf6e3', color:'#8a6d1a', segno:'⚠️ ' },
      da_verificare: { bg:'#e8f4fd', color:'#1A5280', segno:'⚠️ ' },
    }[st.stato];
    const verdetto = Number(k.quota_totale) > 0
      ? `<div style="margin-top:5px"><span style="display:inline-block;padding:3px 8px;border-radius:4px;background:${STILE.bg};color:${STILE.color};font-size:11px;line-height:1.5">${STILE.segno}${esc(st.messaggio)}</span></div>`
      : '';
    return `<tr>
      <td><strong>${esc(k.denominazione)}</strong>
        ${k.referente ? `<br><span style="font-size:11px;color:#aaa">${esc(k.referente)}${k.ruolo ? ' — '+esc(k.ruolo) : ''}</span>` : ''}
        <div style="margin-top:4px">${collaudo.interruttore('committente', k.id, k.di_collaudo)}</div>
      </td>
      <td><span class="badge" style="background:${tc.bg};color:${tc.color}">${tc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">
        ${k.email ? esc(k.email) : ''}${k.email && k.telefono ? '<br>' : ''}${k.telefono ? `<span style="color:#aaa">${esc(k.telefono)}</span>` : ''}${!k.email && !k.telefono ? '<span style="color:#ccc">—</span>' : ''}
      </td>
      <td style="font-size:12px;color:#aaa">${fatt || '—'}${verdetto}</td>
      <td style="white-space:nowrap">
        <button onclick='editComm(${JSON.stringify(k).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <span style="display:inline-block;width:10px"></span>
        <button onclick="deleteComm('${k.id}')" class="btn btn-danger btn-sm" title="Elimina il committente">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Committenti</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'committenti' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Committenti</h1><p style="color:#aaa;font-size:13px">${committenti.length} ${committenti.length===1?'committente':'committenti'}</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo committente</button>
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Chi commissiona o paga un percorso (azienda o persona). Non ha accesso all'Hub.</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca committente (nome, referente, email…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow-x:auto">
      <table>
        <thead><tr><th>Committente</th><th>Tipo</th><th>Contatto</th><th>Fatturazione</th><th></th></tr></thead>
        <tbody>
          ${committenti.length ? committenti.map(renderRow).join('') : `<tr><td colspan="5" class="empty">Nessun committente. Crea il primo con il pulsante qui sopra.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div id="modal-comm" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:16px" id="modal-comm-title">Nuovo committente</h2>
      <input type="hidden" id="c-id">
      <div style="display:grid;grid-template-columns:150px 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="c-tipo"><option value="azienda">Azienda</option><option value="persona">Persona</option></select></div>
        <div class="form-group"><label id="c-denom-label">Ragione sociale *</label><input id="c-denominazione" type="text"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Referente</label><input id="c-referente" type="text" placeholder="persona di contatto"></div>
        <div class="form-group"><label>Ruolo</label><input id="c-ruolo" type="text" placeholder="es. HR, dirigente, genitore"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="c-email" type="email"></div>
        <div class="form-group"><label>Telefono</label><input id="c-tel" type="tel"></div>
      </div>
      <h2 style="font-size:13px;margin:6px 0 12px;color:var(--muted)">Dati fatturazione</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Partita IVA</label><input id="c-piva" type="text"></div>
        <div class="form-group"><label>Codice fiscale</label><input id="c-cf" type="text"></div>
      </div>
      ${/* 11/08 — l'indirizzo era una riga sola e PEC e codice destinatario stavano
            in un campo unico. Per fatturare servono separati. Il vecchio campo
            `pec_sdi` resta nel database e non si tocca: il suo contenuto è già
            finito nel campo giusto (chi ha la chiocciola è una PEC). */ ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Regime fiscale</label>
          <select id="c-regime">
            <option value="">— non indicato —</option>
            <option value="ordinario">Ordinario</option>
            <option value="forfettario">Forfettario</option>
          </select></div>
        <div class="form-group"><label>Natura giuridica</label>
          <select id="c-natura">
            <option value="">— dal tipo —</option>
            <option value="persona_fisica">Persona fisica</option>
            <option value="persona_giuridica">Persona giuridica</option>
          </select></div>
      </div>
      <div class="form-group"><label>Indirizzo di fatturazione</label><input id="c-indirizzo" type="text" placeholder="es. Via Roma 12"></div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr 0.8fr;gap:12px">
        <div class="form-group"><label>CAP</label><input id="c-cap" type="text"></div>
        <div class="form-group"><label>Città</label><input id="c-citta" type="text"></div>
        <div class="form-group"><label>Prov.</label><input id="c-provincia" type="text" maxlength="4" placeholder="MI"></div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>PEC</label><input id="c-pec" type="email"></div>
        <div class="form-group"><label>Codice destinatario SDI</label><input id="c-sdi" type="text" maxlength="7"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px">
        <div class="form-group"><label>Paese</label><input id="c-paese" type="text" maxlength="2" placeholder="IT" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Identificativo fiscale estero</label><input id="c-idestero" type="text"></div>
      </div>
      <div class="form-group"><label>Note</label><input id="c-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeCommModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveComm()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    ${statoUi.js()}
    ${collaudo.js()}
    ${chiamaUi.js()}
    const F = ['tipo','denominazione','referente','ruolo','email','telefono','codice_fiscale','partita_iva','indirizzo','note',
               'regime','natura_giuridica','cap','citta','provincia','pec','codice_sdi','paese','identificativo_estero'];
    const ID = { tipo:'c-tipo', denominazione:'c-denominazione', referente:'c-referente', ruolo:'c-ruolo',
      email:'c-email', telefono:'c-tel', codice_fiscale:'c-cf', partita_iva:'c-piva',
      indirizzo:'c-indirizzo', note:'c-note',
      regime:'c-regime', natura_giuridica:'c-natura', cap:'c-cap', citta:'c-citta',
      provincia:'c-provincia', pec:'c-pec', codice_sdi:'c-sdi', paese:'c-paese',
      identificativo_estero:'c-idestero' };
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function syncDenomLabel() {
      document.getElementById('c-denom-label').textContent =
        document.getElementById('c-tipo').value === 'persona' ? 'Nome e cognome *' : 'Ragione sociale *';
    }
    document.getElementById('c-tipo').addEventListener('change', syncDenomLabel);
    function openNew() {
      document.getElementById('modal-comm-title').textContent = 'Nuovo committente';
      document.getElementById('c-id').value = '';
      Object.values(ID).forEach(id => document.getElementById(id).value = '');
      document.getElementById('c-tipo').value = 'azienda';
      document.getElementById('c-paese').value = 'IT';
      syncDenomLabel();
      document.getElementById('modal-comm').style.display = 'flex';
    }
    function editComm(k) {
      document.getElementById('modal-comm-title').textContent = 'Modifica committente';
      document.getElementById('c-id').value = k.id;
      F.forEach(f => document.getElementById(ID[f]).value = k[f] || '');
      syncDenomLabel();
      document.getElementById('modal-comm').style.display = 'flex';
    }
    function closeCommModal() { document.getElementById('modal-comm').style.display = 'none'; }
    async function saveComm() {
      const denominazione = document.getElementById('c-denominazione').value.trim();
      if (!denominazione) { alert('Denominazione obbligatoria'); return; }
      const payload = {};
      F.forEach(f => payload[f] = document.getElementById(ID[f]).value);
      const id = document.getElementById('c-id').value;
      const url = id ? '/dashboard/committenti/'+id : '/dashboard/committenti';
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    async function deleteComm(id) {
      if (!confirm('Eliminare questo committente?')) return;
      const r = await fetch('/dashboard/committenti/'+id, { method:'DELETE' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    document.getElementById('modal-comm').addEventListener('click', e => { if (e.target === document.getElementById('modal-comm')) closeCommModal(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// PAGINA PROGETTI (Fase 2)
// ═══════════════════════════════════════════════════════
function progettiPage(progetti, committenti, req) {
  const STATO_CFG = {
    'attivo':   { label:'Attivo',   bg:'#d1fae5', color:'#065f46' },
    'in pausa': { label:'In pausa', bg:'#fff8dc', color:'#7a5c00' },
    'concluso': { label:'Concluso', bg:'#eef1f5', color:'#7a8089' },
  };
  const TIPO_LABEL = { individuale:'Individuale', 'individuale-multiplo':'Individuale per più Clienti', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };

  const noComm = committenti.length === 0;
  const commOptions = committenti.map(c => `<option value="${c.id}">${esc(c.denominazione)}</option>`).join('');

  function renderRow(p) {
    const sc = STATO_CFG[p.stato] || STATO_CFG['attivo'];
    const ac = AREA_COL[p.area] || '#1A5280';
    const n = Number(p.n_coachee) || 0;
    return `<tr onclick="location.href='/dashboard/progetti/${p.id}'" style="cursor:pointer">
      <td><strong>${esc(p.titolo)}</strong> ${collaudo.badge(p.di_collaudo)}
        <br><span style="font-size:11px;color:#aaa">${esc(p.committente_nome)}</span>
      </td>
      <td><span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span></td>
      <td style="font-size:12px;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
      <td style="font-size:12px;color:#4a5568">${n > 0 ? `${n} ${n===1?'cliente':'clienti'}` : '<span style="color:#ccc">—</span>'}</td>
      <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}</td>
      <td style="white-space:nowrap" onclick="event.stopPropagation()">
        <button onclick='editProg(${JSON.stringify(p).replace(/'/g, "&#39;")})' class="btn btn-neutral btn-sm">Modifica</button>
        <span style="display:inline-block;width:10px"></span>
        <button onclick="deleteProg('${p.id}')" class="btn btn-danger btn-sm" title="Elimina il progetto">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — Progetti Strutturati</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'progetti' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:12px">
      <div><h1>Progetti Strutturati</h1><p style="color:#aaa;font-size:13px">${progetti.length} ${progetti.length===1?'progetto':'progetti'}</p></div>
      ${noComm
        ? `<a href="/dashboard/committenti" class="btn btn-primary">+ Crea prima un committente</a>`
        : `<button onclick="openNew()" class="btn btn-primary">+ Nuovo progetto</button>`}
    </div>
    <p style="color:var(--muted);font-size:12.5px;margin-bottom:16px">Il percorso commissionato da un committente, che lo paga in tutto o in parte (ambito Business o Young). Lo stato segue la relazione: attivo · in pausa · concluso.</p>

    <input id="cerca" type="search" placeholder="🔍 Cerca progetto (titolo, committente…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow-x:auto">
      <table>
        <thead><tr><th>Progetto</th><th>Area</th><th>Tipo</th><th>Stato</th><th>Clienti</th><th>Inizio</th><th></th></tr></thead>
        <tbody>
          ${progetti.length ? progetti.map(renderRow).join('') : `<tr><td colspan="7" class="empty">Nessun progetto. ${noComm ? 'Crea prima un committente.' : 'Crea il primo con il pulsante qui sopra.'}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div id="modal-prog" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:16px" id="modal-prog-title">Nuovo progetto</h2>
      <input type="hidden" id="p-id">
      <div class="form-group"><label>Committente *</label>
        <select id="p-committente"><option value="">— scegli —</option>${commOptions}</select></div>
      <div class="form-group"><label>Titolo *</label><input id="p-titolo" type="text" placeholder="es. Percorso team vendite — Rossi SpA"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label>
          <select id="p-area"><option value="Business">Business</option><option value="Young">Young</option></select></div>
        <div class="form-group"><label>Tipo</label>
          <select id="p-tipo"><option value="individuale">Individuale</option><option value="individuale-multiplo">Individuale per più Clienti</option><option value="team">Team</option><option value="group">Group</option></select></div>
        <div class="form-group"><label>Stato</label>
          <select id="p-stato"><option value="attivo">Attivo</option><option value="in pausa">In pausa</option><option value="concluso">Concluso</option></select></div>
      </div>
      <div class="form-group"><label>Referente del progetto</label>
        <select id="p-ref-modo" onchange="toggleRef()">
          <option value="sponsor">Lo stesso committente</option>
          <option value="altra">Un'altra persona</option>
        </select></div>
      <div id="ref-extra" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Nome referente</label><input id="p-ref-nome" type="text" placeholder="Nome Cognome"></div>
          <div class="form-group"><label>Ruolo</label><input id="p-ref-ruolo" type="text" placeholder="es. HR, dirigente, genitore"></div>
        </div>
        <div class="form-group"><label>Email referente</label><input id="p-ref-email" type="email" placeholder="referente@azienda.it"></div>
      </div>
      <div class="form-group"><label>Data inizio</label><input id="p-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="p-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeProgModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveProg()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <script>
    ${statoUi.js()}
    const F = ['committente_id','titolo','area','tipo','stato','data_inizio','note','referente_modo','referente_nome','referente_ruolo','referente_email'];
    const ID = { committente_id:'p-committente', titolo:'p-titolo', area:'p-area', tipo:'p-tipo',
      stato:'p-stato', data_inizio:'p-data', note:'p-note',
      referente_modo:'p-ref-modo', referente_nome:'p-ref-nome', referente_ruolo:'p-ref-ruolo', referente_email:'p-ref-email' };
    function toggleRef() {
      var m = document.getElementById('p-ref-modo').value;
      document.getElementById('ref-extra').style.display = (m === 'altra') ? 'block' : 'none';
    }
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function openNew() {
      document.getElementById('modal-prog-title').textContent = 'Nuovo progetto';
      document.getElementById('p-id').value = '';
      Object.values(ID).forEach(id => document.getElementById(id).value = '');
      document.getElementById('p-committente').value = '';
      document.getElementById('p-area').value = 'Business';
      document.getElementById('p-tipo').value = 'individuale';
      document.getElementById('p-stato').value = 'attivo';
      document.getElementById('p-ref-modo').value = 'sponsor';
      toggleRef();
      document.getElementById('modal-prog').style.display = 'flex';
    }
    function editProg(p) {
      document.getElementById('modal-prog-title').textContent = 'Modifica progetto';
      document.getElementById('p-id').value = p.id;
      F.forEach(f => document.getElementById(ID[f]).value = (f==='data_inizio' && p[f]) ? String(p[f]).slice(0,10) : (p[f] || ''));
      document.getElementById('p-ref-modo').value = p.referente_modo || 'sponsor';
      toggleRef();
      document.getElementById('modal-prog').style.display = 'flex';
    }
    function closeProgModal() { document.getElementById('modal-prog').style.display = 'none'; }
    async function saveProg() {
      const committente_id = document.getElementById('p-committente').value;
      const titolo = document.getElementById('p-titolo').value.trim();
      if (!committente_id) { alert('Scegli un committente'); return; }
      if (!titolo) { alert('Titolo obbligatorio'); return; }
      const payload = {};
      F.forEach(f => payload[f] = document.getElementById(ID[f]).value);
      payload.data_inizio = payload.data_inizio || null;
      const id = document.getElementById('p-id').value;
      const url = id ? '/dashboard/progetti/'+id : '/dashboard/progetti';
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    async function deleteProg(id) {
      if (!confirm('Eliminare questo progetto?')) return;
      const r = await fetch('/dashboard/progetti/'+id, { method:'DELETE' });
      const d = await r.json();
      if (d.ok) location.reload(); else alert(d.error || 'Errore');
    }
    document.getElementById('modal-prog').addEventListener('click', e => { if (e.target === document.getElementById('modal-prog')) closeProgModal(); });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// PAGINA DETTAGLIO PROGETTO (Fase 3a) — dati + coachee collegati
// ═══════════════════════════════════════════════════════
/**
 * SPECIFICHE DI PROGETTO — Fetta 1: SOLA LETTURA.
 *
 * ⭐ Modello di Germano (28/08): il centro del progetto. «Un unico luogo» vuol
 *    dire una sola SCHERMATA, non una seconda copia dei dati: qui non si scrive
 *    niente e non nasce nessun archivio parallelo. Ogni riga dice dove si
 *    corregge oggi.
 * ⛔ Nessuna colonna nuova (è la Fetta 2), nessuna modifica all'Amministrazione
 *    (è la Fetta 4).
 *
 * Lo STATO si RICAVA dai fatti invece di essere una colonna: se l'Intake col
 * Committente è registrata, i numeri sono affidabili. È l'asse dato da Germano:
 * provvisorio nelle Pre-Intake, valorizzato dopo l'Intake col Committente,
 * definitivo dopo la firma — e il terzo gradino arriva con la Fetta 6, perché
 * oggi l'Hub non sa se un contratto è stato firmato.
 */
/**
 * L'AVVISO PRIMA DEL KICK-OFF — Fetta 6c.
 * Compare solo se il Kick-Off è stato messo in calendario (è facoltativo: molti
 * progetti non ne hanno uno) e il contratto del Committente non è firmato.
 * ⛔ Non blocca niente: è un cartello. Sbarrare la strada renderebbe l'Hub un
 *    ostacolo il giorno che il cliente chiede di anticipare.
 */
function avvisoKickOff(p, fasi, statoContratto) {
  if (statoContratto === 'approvata') return '';
  const ko = (fasi || []).filter(f => f.tipo === 'kick-off' && f.stato !== 'bozza');
  if (!ko.length) return '';
  const avvenuto = ko.find(f => f.fatta);
  const previsto = ko.find(f => f.data && !f.fatta) || ko[0];
  const et = contrattiStato.stato(statoContratto).label.toLowerCase();
  const quando = (f) => f && f.data ? ' del ' + itDate(f.data) : '';
  return avvenuto
    ? `<div class="card" style="margin-bottom:18px;border-left:5px solid #a4342a;background:#fdf2f0">
         <div style="font-size:17px;font-weight:700;color:#a4342a;margin-bottom:6px">🔴 Il Kick-Off si è svolto senza contratto firmato</div>
         <div style="font-size:14px;color:#7a2b23">Il Kick-Off${quando(avvenuto)} risulta avvenuto, ma il contratto del Committente è ancora <strong>${et}</strong>.
         Il progetto sta camminando senza che nessuno abbia sottoscritto quanto costa, quante sedute sono e che cosa viene riferito al Committente.</div>
         <div style="font-size:13px;color:#7a2b23;margin-top:8px">Si sistema dalla card <strong>Contratti</strong>, qui sotto.</div>
       </div>`
    : `<div class="card" style="margin-bottom:18px;border-left:5px solid #b45309;background:#fdf8ef">
         <div style="font-size:17px;font-weight:700;color:#b45309;margin-bottom:6px">⚠️ Kick-Off in calendario, contratto non ancora firmato</div>
         <div style="font-size:14px;color:#7a5a1e">Il Kick-Off${quando(previsto)} è previsto, e il contratto del Committente è <strong>${et}</strong>.
         Prima di cominciare davanti a tutti, quel contratto andrebbe firmato.</div>
         <div style="font-size:13px;color:#7a5a1e;margin-top:8px">Lo prepari e lo segui dalla card <strong>Contratti</strong>, qui sotto. Nessuno ti impedisce di procedere: questo è un promemoria, non un blocco.</div>
       </div>`;
}

function specificheCard({ p, coachee, percorsi, fasi, qTot, qComm, quoteGuaste, congelato, nSedute }) {
  // ⚠️ `eur` qui NON esiste: è un aiuto locale di progettoDettaglioPage, e questa
  // funzione sta fuori. Alla prima prova la pagina rispondeva «Errore» proprio per
  // questo — e `npm run prova` non l'ha visto, perché controlla il JS che gira nel
  // BROWSER, non il codice del server che disegna la pagina.
  const eur = fiscale.euro;
  const TIPI = {
    'individuale': 'Individuale', 'individuale-multiplo': 'Individuale per più Clienti',
    'team': 'Team', 'group': 'Group',
  };
  const collettivo = p.tipo === 'team' || p.tipo === 'group';
  const condiviso = (percorsi || []).find(x => !x.client_id) || null;
  const individuali = (percorsi || []).filter(x => x.client_id);
  const nPart = (coachee || []).length;

  // 🔴 UNA FASE REGISTRATA NON È UNA FASE AVVENUTA. Le fasi si scrivono anche in
  // anticipo — data futura, «fatta» non spuntato — ed è così che si pianifica.
  // Alla prima stesura contavo la sola esistenza della riga: un Intake soltanto
  // PREVISTO faceva passare il progetto a «Valorizzato», cioè l'Hub diceva che si
  // poteva redigere il contratto prima ancora di aver fatto l'incontro.
  // Non l'avevo visto perché nel progetto di prova l'Intake l'avevo registrata già
  // spuntata come fatta: la prova non toccava mai il caso «prevista».
  // ⚠️ Una fase in BOZZA non conta: è una proposta dell'automazione che aspetta il
  //    coach, non un fatto.
  const avvenuta = (f) => !!f && !!f.fatta && f.stato !== 'bozza';
  const intakeComm = (fasi || []).find(f => f.tipo === 'intake-sponsor' && avvenuta(f));
  const valorizzato = !!intakeComm;

  // Che cosa manca perché i contratti si possano scrivere. Non è un elenco di
  // desideri: sono le cose senza le quali un contratto esce con un buco.
  const manca = [];
  if (!nPart) manca.push('nessun partecipante');
  if (qTot == null) manca.push('il valore del progetto');
  if (collettivo && !condiviso) manca.push('il percorso condiviso');
  if (condiviso && !condiviso.n_sessioni_previste) manca.push('il numero di sessioni del percorso');
  if (!collettivo && !individuali.length) manca.push('i percorsi dei partecipanti');
  if (quoteGuaste) manca.push('le quote non tornano');

  const voce = (etichetta, valore, dove) => `<tr>
    <td style="font-size:12px;color:var(--muted);white-space:nowrap;vertical-align:top;padding-right:14px">${etichetta}</td>
    <td style="font-size:13px;vertical-align:top">${valore}</td>
    <td style="text-align:right;white-space:nowrap;vertical-align:top">${dove || ''}</td>
  </tr>`;
  const vuoto = '<span style="color:#aaa">— non ancora indicato</span>';

  const sessioni = condiviso
    ? `<strong>${Number(condiviso.n_sessioni_previste) || '—'}</strong> previste · ${Number(condiviso.n_sessioni_fatte) || 0} fatte`
    : individuali.length
      ? `${individuali.length} ${individuali.length === 1 ? 'percorso individuale' : 'percorsi individuali'}`
      : vuoto;

  // Le fasi obbligatorie secondo le regole date da Germano il 28/08. Kick-Off e
  // Chiusura Open sono facoltative e non entrano in questo conto.
  const OBBLIGATORIE = [
    ['intake-sponsor', 'Intake col Committente'],
    ['chiusura-sponsor', 'Chiusura col Committente'],
  ];
  const faseFatte = OBBLIGATORIE.map(([tp, label]) => {
    const righe = (fasi || []).filter(f => f.tipo === tp);
    if (righe.some(avvenuta)) return `<span class="az-fatto">✓ ${label}</span>`;
    const prevista = righe.find(f => f.data);
    if (prevista) return `<span style="color:#8a6d1e">${label} — prevista il ${itDate(prevista.data)}</span>`;
    if (righe.length) return `<span style="color:#8a6d1e">${label} — prevista</span>`;
    return `<span style="color:#aaa">${label} — non ancora</span>`;
  }).join(' · ');
  const nPre = (fasi || []).filter(f => f.tipo === 'pre-intake' && avvenuta(f)).length;
  const nSessComm = (fasi || []).filter(f => f.tipo === 'sessione-committente').length;

  // La sezione si apre da sola finché il progetto non è a posto: provvisorio,
  // oppure manca ancora qualcosa perché i contratti escano completi. Quando è
  // valorizzato e non manca niente, riposa chiusa.
  return sezionePieghevole(
    `<h2 style="margin:0">Specifiche di Progetto</h2>
     <span class="badge" style="background:${valorizzato ? '#eaf5ee' : '#fdf6e3'};color:${valorizzato ? '#2f6b46' : '#8a6d1e'}">
       ${valorizzato ? 'Valorizzato' : 'Provvisorio'}
     </span>`,
    `
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
        ${valorizzato
          ? 'L\'Intake col Committente è registrata: da qui i numeri sono affidabili e si può redigere la bozza di contratto.'
          : '<strong style="color:#8a6d1e">Finché l\'Intake col Committente non è registrata, questi numeri sono provvisori</strong> e non basta averli per redigere un contratto.'}
      </div>

      ${congelato ? `<div style="margin-bottom:14px;padding:11px 13px;border-radius:8px;background:#eaf5ee;border-left:3px solid #4F8B73">
        <strong style="color:#2f6b46">🔒 Specifiche congelate.</strong>
        <span style="font-size:13px;color:#2f6b46">Il contratto del Committente è firmato, quindi tipologia, partecipanti, sessioni, valore, quote, parametri e piano dei pagamenti non si cambiano più — sono quello che il Committente ha sottoscritto.</span>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">Per riaprirle: <strong>«Modifica contratto approvato»</strong> nella card Contratti, qui sotto. Riporta il contratto a «da inviare», perché andrà rifatto e rimandato.</div>
      </div>` : ''}
      ${manca.length && !congelato ? `<div class="flash-error" style="margin-bottom:12px">Perché i contratti escano completi manca ancora: <strong>${manca.map(esc).join(' · ')}</strong>.</div>` : ''}

      <div style="overflow-x:auto"><table style="width:100%">
        <tbody>
          ${/* Fetta 6b — la tipologia si cambia da qui, con due lucchetti: il
                contratto firmato e — più severo — le sedute già registrate.
                Regola di Germano: «non si può modificare da collettivo a
                individuale un percorso già cominciato». */ ''}
          ${voce('Tipologia', `<strong>${TIPI[p.tipo] || esc(p.tipo)}</strong>${collettivo ? ' <span style="color:var(--muted)">— sessioni con tutti insieme</span>' : ''}`,
            congelato
              ? '<span style="font-size:12px;color:#2f6b46">🔒 congelata dal contratto</span>'
              : nSedute
                ? `<span style="font-size:12px;color:var(--muted)" title="Cambiare tipologia cambia la struttura dei percorsi, e le sessioni resterebbero senza casa">🔒 il percorso è cominciato</span>`
                : `<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
                     ${/* ⚠️ max-width: senza, la tendina è larga quanto «Individuale per
                           più Clienti» e sotto gli 850px spinge il pulsante Salva fuori
                           dallo schermo. Visto sulla pagina vera, non nel codice. */ ''}
                     <select id="sp-tipo" style="padding:4px 6px;font-size:13px;max-width:145px">
                       ${Object.entries(TIPI).map(([k, et]) => `<option value="${k}"${k === p.tipo ? ' selected' : ''}>${et}</option>`).join('')}
                     </select>
                     <button onclick="salvaTipo()" class="btn btn-neutral btn-sm">Salva</button>
                   </span>`)}
          ${voce('Sessioni del percorso', sessioni, congelato
            ? '<span style="font-size:12px;color:#2f6b46">🔒 congelate dal contratto</span>'
            : condiviso
            ? `<span style="white-space:nowrap">
                 <input id="sp-previste" type="number" min="1" max="100" step="1"
                        value="${Number(condiviso.n_sessioni_previste) || ''}"
                        style="width:64px;padding:4px 6px;font-size:13px;text-align:right">
                 <button onclick="salvaPreviste()" class="btn btn-neutral btn-sm">Salva</button>
               </span>`
            : '<span style="font-size:12px;color:#aaa">card «Percorsi», qui sotto</span>')}
          ${voce('Fasi col Committente', `${faseFatte}${nPre ? ` · <span style="color:var(--muted)">${nPre} Pre-Intake</span>` : ''}${nSessComm ? ` · <span style="color:var(--muted)">${nSessComm} ${nSessComm === 1 ? 'sessione intermedia' : 'sessioni intermedie'}</span>` : ''}`,
            '<span style="font-size:12px;color:#aaa">card «Fasi», in fondo</span>')}
          ${voce('Partecipanti', nPart
              ? `<strong>${nPart}</strong> — ${coachee.map(k => esc(k.name || '—')).join(' · ')}`
              : vuoto,
            congelato ? '<span style="font-size:12px;color:#2f6b46">🔒 congelati dal contratto</span>'
                      : `<button onclick="openAdd()" class="btn btn-neutral btn-sm">+ Aggiungi</button>`)}
          ${voce('Valore del progetto', qTot != null ? `<strong>€ ${eur(qTot)}</strong>` : vuoto,
            congelato ? '<span style="font-size:12px;color:#2f6b46">🔒 congelato dal contratto</span>'
                      : `<button onclick="apriPiano()" class="btn btn-neutral btn-sm">Modifica il piano</button>`)}
          ${voce('Forma di pagamento', qTot == null || qComm == null ? vuoto
              : (Number(qComm) >= Number(qTot)
                  ? 'interamente a carico del Committente'
                  : `co-finanziato — € ${eur(qComm)} il Committente, € ${eur(Number(qTot) - Number(qComm))} i partecipanti`), '')}
          ${voce('Parametri di successo', p.parametri ? esc(String(p.parametri).slice(0, 160)) : vuoto,
            '<span style="font-size:12px;color:#aaa">arrivano dall\'Intake</span>')}
          ${voce('Termini', [
              p.data_inizio ? 'inizio ' + itDate(p.data_inizio) : null,
              p.data_meta ? 'meta ' + itDate(p.data_meta) : null,
              p.data_fine ? 'fine ' + itDate(p.data_fine) : null,
            ].filter(Boolean).join(' · ') || vuoto,
            congelato ? '<span style="font-size:12px;color:#2f6b46">🔒 congelati dal contratto</span>'
                      : `<button onclick="apriPiano()" class="btn btn-neutral btn-sm">Modifica il piano</button>`)}
        </tbody>
      </table></div>

      <div style="margin-top:12px;font-size:12px;color:var(--muted)">
        Da qui si scrive quello che ha un campo o un pulsante qui a destra; il resto si corregge dove nasce,
        e i pulsanti ti ci portano. ${condiviso ? 'Il numero di sessioni previste si cambia direttamente qui: prima non si poteva cambiare da nessuna parte.' : ''}
      </div>`,
    !valorizzato || manca.length > 0);
}

function progettoDettaglioPage(p, coachee, req, disponibili, percorsi, fasi, seduteColl, piano, rateChieste, statiContratti) {
  // Fetta 6a — «da redigere» è l'assenza della riga, quindi la mappa non ce l'ha
  // e il valore di riserva è proprio quello.
  statiContratti = statiContratti || new Map();
  // Fetta «sezioni pieghevoli» (30/08): lo stesso meccanismo della scheda cliente.
  const sezione = sezionePieghevole;
  const statoContr = (tipo, id) => statiContratti.get(tipo + ':' + id) || 'da_redigere';
  // Una sezione si apre da sola quando ha qualcosa in sospeso. Per i contratti,
  // «in sospeso» vuol dire che qualcuno non ha ancora firmato: il Committente,
  // o uno dei partecipanti che mette una quota.
  const contrattiDaSeguire = statoContr('committente', p.id) !== 'approvata'
    || (coachee || []).some(k => Number(k.quota_coachee) > 0
         && statoContr('partecipante', k.part_id) !== 'approvata');
  // La cella «A che punto è»: il pallino, il passo avanti, e — se c'è — l'azione
  // di modifica. ⚠️ Il pulsante dice cosa STAI DICHIARANDO, non a quale stato
  // stai passando: «l'ho inviata» è la stessa cosa detta dalla parte di chi lavora.
  // La firma dell'INFORMATIVA. Non è uno stato del contratto: è la casella
  // `consenso_privacy` dell'anagrafica, che esiste da sempre ed è già quello che
  // le Anomalie controllano. Qui si LEGGE e si dice dove si spunta — non si
  // duplica, o diventerebbero due verità sulla stessa firma.
  const cellaConsenso = (k) => k.consenso_privacy
    ? `<div style="font-size:11px;color:#2f6b46;margin-top:5px">✓ informativa firmata${k.consenso_data ? ' il ' + itDate(k.consenso_data) : ''}</div>`
    : `<div style="font-size:11px;color:#8a6d1e;margin-top:5px">informativa non ancora firmata — <a href="/dashboard/clients/${k.client_id}" style="color:inherit">si spunta in anagrafica ↗</a></div>`;
  const cellaStato = contrattiStato.cella;

  // ⭐ C3 — l'insieme delle rate gia dentro una proforma viva: da qui esce lo
  // stato «Chiesta». Se non arriva, `statoDi` ripiega sulla colonna salvata.
  rateChieste = rateChieste || new Map();
  // Fetta B (Mattone 2) — il percorso CONDIVISO (team/group) e le sue sessioni collettive.
  seduteColl = seduteColl || [];
  const percCond = (percorsi || []).find(x => !x.client_id) || null;
  // Come nella Scheda Cliente: il percorso finisce il giorno dell'ultima sessione
  // confermata, e quella data si propone alla chiusura.
  const ultimaColl = seduteColl
    .filter(s => s.stato === 'confermata' && s.data)
    .map(s => new Date(s.data)).sort((a, b) => b - a)[0];
  const collFineIso = ultimaColl ? ultimaColl.toISOString().slice(0, 10) : '';
  const collFineIt  = ultimaColl ? itDate(ultimaColl.toISOString()) : '';
  const collCard = !percCond ? '' : (() => {
    const hasDrive = !!(percCond.drive_url && percCond.drive_url.trim());
    const body = seduteColl.length === 0
      ? `<div style="font-size:13px;color:var(--muted)">Nessuna sessione ancora. Salva i report (file "Report… .docx") nelle sottocartelle Intake/Ongoing/Final della cartella del percorso, poi premi "Cerca nuovi report".</div>`
      : `<div style="overflow-x:auto">
          <table class="scheda-cliente">
            <thead><tr><th>Data</th><th>Sessione</th><th>Obiettivo</th><th>Argomenti trattati</th><th>Attività concordate</th><th>Scadenza</th><th>Eseg.</th><th>Note</th><th></th></tr></thead>
            <tbody>${seduteColl.map(renderSedutaRow).join('')}</tbody>
          </table>
        </div>`;
    // ⚠️ I pulsanti stanno nel <summary>: senza `event.stopPropagation()` premerli
    //    chiuderebbe la sezione invece di fare quello che dicono.
    return sezionePieghevole(
      `<h2 style="margin:0">Scheda ${percCond.tipo === 'Group' ? 'del Gruppo' : 'del ' + esc(percCond.tipo)} <span style="font-weight:400;font-size:13px;color:#aaa">(${(Number(percCond.n_sessioni_fatte)||0)} ${(Number(percCond.n_sessioni_fatte)||0)===1?'sessione confermata':'sessioni confermate'} · ${fmtOre(percCond.ore_fatte)} h)</span></h2>`,
      `${!hasDrive ? `<div style="font-size:12px;color:#b45309;margin-bottom:10px">Crea prima la cartella Drive del percorso (colonna "Cartella sessioni" qui sopra) per l'automazione dei report.</div>` : ''}
      ${body}`,
      // Aperta se c'è una bozza da approvare: quello è lavoro che aspetta te.
      seduteColl.some(x => x.stato === 'bozza'),
      `${hasDrive ? `<button id="scan-coll-btn" onclick="event.stopPropagation(); scanCollettivo()" class="btn btn-gold btn-sm" title="Legge i report Word nuovi dalla cartella del percorso e ne crea la bozza">⟳ Cerca nuovi report</button>` : ''}
       ${percCond.stato === 'attivo'
         ? `<button onclick="event.stopPropagation(); chiudiPercorsoColl()" class="btn btn-neutral btn-sm" title="Concludi il percorso di gruppo">Chiudi il percorso</button>`
         : `<span class="badge badge-inactive">Percorso concluso</span>`}`);
  })();
  // Fase 3a — le tappe con lo sponsor. La card parte VUOTA: si aggiungono a mano da
  // una tendina ("+ Aggiungi fase"). In futuro l'automazione (report nella cartella
  // Drive del progetto) le riconoscerà e le spunterà da sola, come già per le sessioni
  // dei percorsi individuali. FASI_CFG = tipi previsti, in ordine; ORDER dà l'ordine
  // di visualizzazione anche se aggiunte in un ordine diverso.
  const FASI_CFG = [
    { tipo:'pre-intake',       label:'Pre-Intake',           opt:false },
    // Etichette a schermo con la terminologia bloccata: si dice COMMITTENTE, non
    // "Sponsor". I `tipo` nel database restano quelli di prima (intake-sponsor,
    // chiusura-sponsor): cambia solo la parola che si legge.
    { tipo:'intake-sponsor',   label:'Intake con il Committente',   opt:false },
    // Il Kick-Off è FACOLTATIVO, e si decide se farlo entro l'Intake col
    // Committente (Germano, 28/08). Era segnato obbligatorio: l'etichetta diceva
    // il falso su una cosa che il coach decide caso per caso.
    { tipo:'kick-off',         label:'Kick-Off',                    opt:true  },
    // Facoltativa e RIPETIBILE: se ne registrano quante ne servono, come per il
    // Pre-Intake. Nessun vincolo nel database lo impedisce.
    { tipo:'sessione-committente', label:'Sessione col Committente', opt:true },
    { tipo:'chiusura-open',    label:'Chiusura Open',               opt:true  },
    { tipo:'chiusura-sponsor', label:'Chiusura con il Committente', opt:false },
  ];
  const FASE_LABELS = {}, FASE_ORDER = {};
  FASI_CFG.forEach((c, i) => { FASE_LABELS[c.tipo] = c.label; FASE_ORDER[c.tipo] = i; });

  // Voci del report per ciascun tipo di fase (mattone 2). key = campo nella scatola
  // JSON `contenuto`; label = etichetta mostrata; proj = voce che è verità di PROGETTO
  // (Intake) e va su `progetti`, non nel contenuto. Comuni a tutte: Partecipanti · Note.
  const VOCI_FASE = {
    'pre-intake': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti discussi' },
      { key:'obiettivo_grezzo', label:'Obiettivo grezzo (pre-SMARTER)' },
      { key:'ipotesi_partecipanti', label:'Ipotesi n° partecipanti e caratteristiche' },
      { key:'richieste', label:'Eventuali richieste specifiche' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'intake-sponsor': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti discussi' },
      { key:'obiettivo_smarter', label:'Obiettivo di progetto (SMARTER)', proj:'obiettivo_smarter' },
      { key:'parametri', label:'Parametri di verifica del successo', proj:'parametri' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'sessione-committente': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti discussi' },
      { key:'decisioni', label:'Decisioni prese' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'kick-off': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti presentati (Committente/Coach)' },
      { key:'interventi', label:'Interventi importanti dei partecipanti' },
      { key:'next_steps', label:'Next steps' },
      { key:'note', label:'Note' },
    ],
    'chiusura-open': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti trattati' },
      { key:'traguardi', label:'Traguardi celebrati' },
      { key:'note', label:'Note' },
    ],
    'chiusura-sponsor': [
      { key:'partecipanti', label:"Partecipanti all'incontro" },
      { key:'argomenti', label:'Argomenti trattati' },
      { key:'feedback_sponsor', label:'Feedback del Committente' },
      { key:'note', label:'Note' },
    ],
  };
  // Pre-Intake: dal #2 in poi due voci cambiano etichetta (conferma/modifica).
  const PRE_SUCC_LABELS = {
    obiettivo_grezzo: 'Obiettivo grezzo (conferma/modifica)',
    ipotesi_partecipanti: 'Conferma/modifica n° partecipanti e caratteristiche',
  };
  const projVals = { obiettivo_smarter: p.obiettivo_smarter || '', parametri: p.parametri || '' };
  const faseDetail = (tipo, contenuto, isPrimoPre) => {
    const voci = VOCI_FASE[tipo] || [];
    const c = contenuto || {};
    return voci.map(v => {
      let label = v.label;
      if (tipo === 'pre-intake' && !isPrimoPre && PRE_SUCC_LABELS[v.key]) label = PRE_SUCC_LABELS[v.key];
      const val = v.proj ? (projVals[v.proj] || '') : (c[v.key] != null ? c[v.key] : '');
      return `<div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;font-weight:600;color:#4a5568;margin-bottom:3px">${esc(label)}${v.proj ? ' <span style="color:#2563eb;font-weight:400">· obiettivo di progetto</span>' : ''}</label>
        <textarea class="f-voce" data-key="${esc(v.key)}"${v.proj ? ` data-proj="${esc(v.proj)}"` : ''} rows="2" style="width:100%;font-size:13px;resize:vertical">${esc(String(val))}</textarea>
      </div>`;
    }).join('');
  };
  const faseRow = (tipo, f, isPrimoPre, num) => {
    const fid  = f ? f.id : '';
    const data = f && f.data ? f.data : '';
    const fatta = f ? !!f.fatta : false;
    const stato = f ? (f.stato || 'confermata') : 'confermata';
    const contenuto = f ? (f.contenuto || {}) : {};
    const ord = FASE_ORDER[tipo] != null ? FASE_ORDER[tipo] : 9;
    const label = (FASE_LABELS[tipo] || tipo) + (tipo === 'pre-intake' && num ? ' #' + num : '');
    const isBozza = stato === 'bozza';
    return `<div class="fase-block" data-tipo="${tipo}" data-fid="${esc(fid)}" data-order="${ord}" style="padding:10px 0;border-top:1px solid #eef1f5">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <span class="fase-label" style="min-width:150px;font-weight:600;font-size:13px;color:var(--ink)">${esc(label)}</span>
        ${isBozza ? `<span style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 7px;border-radius:6px">bozza</span>` : ''}
        <input type="date" class="f-data" value="${esc(data)}" style="width:150px">
        <label style="font-size:12px;color:#4a5568;display:flex;align-items:center;gap:5px;flex:0 0 auto;white-space:nowrap;text-transform:none;letter-spacing:0;font-weight:500;margin:0"><input type="checkbox" class="f-fatta" style="width:auto;margin:0" ${fatta ? 'checked' : ''}> fatta</label>
        <button type="button" onclick="toggleDettaglio(this)" class="btn btn-neutral btn-sm">Dettaglio ▾</button>
        ${isBozza ? `<button type="button" onclick="approvaFase(this)" class="btn btn-sm" style="background:#e7f1ec;color:#2e6b52" title="Approva la fase in bozza">✓ Approva</button>` : ''}
        <button type="button" onclick="salvaFase(this)" class="btn btn-neutral btn-sm">Salva</button>
        <span style="display:inline-block;width:14px"></span>
        <button type="button" onclick="delFase(this)" class="btn btn-danger btn-sm" title="Elimina la fase">🗑</button>
      </div>
      <div class="fase-dettaglio" style="display:none;margin-top:10px;padding:10px;background:#f9fafb;border-radius:8px">
        ${faseDetail(tipo, contenuto, isPrimoPre)}
      </div>
    </div>`;
  };
  const fasiSorted = (fasi || []).slice().sort((a, b) =>
    (FASE_ORDER[a.tipo] != null ? FASE_ORDER[a.tipo] : 9) - (FASE_ORDER[b.tipo] != null ? FASE_ORDER[b.tipo] : 9));
  let preN = 0;
  const fasiRows = fasiSorted.map(f => {
    let num = 0, isPrimo = true;
    if (f.tipo === 'pre-intake') { preN += 1; num = preN; isPrimo = (preN === 1); }
    return faseRow(f.tipo, f, isPrimo, num);
  }).join('');
  const fasiMenuItems = FASI_CFG.map(c =>
    `<button type="button" onclick="addFase('${c.tipo}')" style="display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;font-size:13px;color:var(--ink);cursor:pointer">${c.label}${c.opt ? ' <span style="color:#aaa;font-size:11px">(facoltativa)</span>' : ''}</button>`
  ).join('');
  // Obbligatorie secondo le regole di Germano del 28/08: Intake e Chiusura col
  // Committente. Kick-Off e Chiusura Open sono facoltative e non contano.
  const fasiDaSeguire = ['intake-sponsor', 'chiusura-sponsor'].some(t =>
      !(fasi || []).some(f => f.tipo === t && f.fatta && f.stato !== 'bozza'))
    || (fasi || []).some(f => f.stato === 'bozza');
  // ⚠️ Il pulsante finisce nel <summary>: senza `event.stopPropagation()` premerlo
  //    chiuderebbe la sezione invece di cercare i report.
  const fasiCard = sezionePieghevole(
    `<h2 style="margin:0">Fasi del progetto <span style="font-weight:400;font-size:13px;color:#aaa">(${fasiSorted.length})</span></h2>`,
    `<div id="fasi-list">${fasiRows}</div>
      <div id="fasi-empty" style="display:${fasiSorted.length ? 'none' : 'block'};font-size:13px;color:var(--muted);padding:6px 0">Nessuna fase ancora. Aggiungila con il pulsante qui sotto.</div>
      <div style="position:relative;margin-top:12px">
        <button type="button" onclick="toggleFaseMenu()" class="btn btn-primary btn-sm">+ Aggiungi fase ▾</button>
        <div id="fase-menu" style="display:none;position:absolute;left:0;top:100%;margin-top:4px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);min-width:220px;z-index:50;overflow:hidden">
          ${fasiMenuItems}
        </div>
      </div>`,
    // Aperta se una fase OBBLIGATORIA non è ancora avvenuta, o se una bozza
    // dell'automazione aspetta di essere approvata.
    fasiDaSeguire,
    `${p.drive_url
          ? `<button id="scan-fasi-btn" onclick="event.stopPropagation(); scanProgetto()" class="btn btn-gold btn-sm" title="Legge i report nuovi dalle sottocartelle di fase su Drive e ne crea la riga in bozza">⟳ Cerca nuovi report</button>`
          : `<span style="font-size:12px;color:var(--muted)">crea la cartella Drive per l'automazione</span>`}`);
  const STATO_CFG = {
    'attivo':   { label:'Attivo',   bg:'#d1fae5', color:'#065f46' },
    'in pausa': { label:'In pausa', bg:'#fff8dc', color:'#7a5c00' },
    'concluso': { label:'Concluso', bg:'#eef1f5', color:'#7a8089' },
  };
  const TIPO_LABEL = { individuale:'Individuale', 'individuale-multiplo':'Individuale per più Clienti', team:'Team', group:'Group' };
  const AREA_COL   = { Business:'#4F8B73', Young:'#D8AE2E' };
  const sc = STATO_CFG[p.stato] || STATO_CFG['attivo'];
  const ac = AREA_COL[p.area] || '#1A5280';

  // Clienti esistenti (non ancora in questo progetto) da collegare senza doppioni.
  disponibili = disponibili || [];
  const nDisponibili = disponibili.length;
  const opzioniClienti = disponibili.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name || c.cognome || 'Senza nome')}${c.area ? ' — ' + esc(c.area) : ''}</option>`
  ).join('');

  // Fase 3B — quota del progetto (pg restituisce i NUMERIC come stringa).
  const qTot     = p.quota_totale      != null ? Number(p.quota_totale)      : null;
  const qComm    = p.quota_committente != null ? Number(p.quota_committente) : null;
  // Senza il valore del progetto non c'è niente da riepilogare: i quattro numeri
  // restano nascosti e la scheda lo dice.
  const ammQuoteSet = qTot != null && qTot > 0;
  // 🔴 Le quote tornano? totale = quota del committente + somma dei partecipanti.
  // Serve alla card dei contratti: finché non torna, i contratti non si preparano.
  // Il conto lo fa `fiscale.quoteProgetto`, che nell'Hub esiste già: scriverne un
  // secondo vorrebbe dire due risposte alla stessa domanda.
  const quoteGuaste = (() => {
    if (qTot == null) return 'Il valore del progetto non è ancora stato impostato.';
    const somma = coachee.reduce((s, k) => s + (Number(k.quota_coachee) || 0), 0);
    const q = fiscale.quoteProgetto({ quota_totale: qTot, quota_committente: qComm, somma_coachee: somma });
    if (q.quadra) return null;
    return q.scarto > 0
      ? `Le quote non tornano: mancano € ${fiscale.euro(q.scarto)} all'appello.`
      : `Le quote non tornano: superano il valore del progetto di € ${fiscale.euro(-q.scarto)}.`;
  })();
  const eur = fiscale.euro;

  // ── IL PIANO DI PAGAMENTO DEL COMMITTENTE (12/08) ───────────────────────
  // Un committente non paga il totale in una volta. Finché non c'è un piano,
  // «chiedi la quota» chiederebbe tutti i 7.000 in un colpo — che non è mai
  // quello che succede. Qui il piano si propone (30/40/30 a 30 giorni) e si
  // corregge; quello che si salva sono gli EURO, la percentuale è solo un modo
  // di scriverli.
  const pianoSalvato = piano || [];
  const inneschiOpt = Object.entries(tranche.INNESCHI)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  // Chi paga, in ordine: prima il committente, poi i partecipanti che hanno una
  // quota loro. Un progetto senza quote dei partecipanti mostra solo il primo —
  // niente sezioni vuote da saltare con gli occhi.
  const pagatori = [];
  if (qComm) {
    pagatori.push({ key: 'comm', pid: null, nome: p.committente_nome,
      ruolo: 'committente', quota: Math.round(qComm), tipo: 'committente' });
  }
  // ⚠️ TUTTI i partecipanti, anche quelli senza quota: e' da questa riga che la
  // quota si scrive, e un partecipante che non compare non si puo' compilare.
  coachee.forEach(k => {
    pagatori.push({ key: k.part_id, pid: k.part_id, nome: k.name, email: k.email || '',
      client_id: k.client_id,
      ruolo: 'partecipante', quota: k.quota_coachee != null ? Math.round(Number(k.quota_coachee)) : 0,
      tipo: 'partecipante' });
  });

  const piani = pagatori.map(pg => {
    const suoi = pianoSalvato.filter(t => (t.partecipazione_id || null) === pg.pid);
    return { ...pg, nuovo: !suoi.length,
      righe: pianoUi.righeDi(suoi, pg.quota, pg.tipo, rateChieste) };
  });

  // ⭐ I QUATTRO NUMERI si contano dalle tranche SALVATE, non dalle proposte:
  // una proposta non è un impegno con nessuno.
  const tot4 = tranche.totali(pianoSalvato, qTot, rateChieste);

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub — ${esc(p.titolo)}</title>${baseStyle()}
  <style>
    /* ⭐ AMMINISTRAZIONE COMPATTA (12/08). Germano: «dovrebbe potersi leggere
       tutta la scheda in un'unica schermata… è tutto troppo grande».
       ⚠️ Solo da 1025px in su. Sotto restano intatte le misure per il dito
       (44px / 16px / 11px), che valgono fino a 1024px e non si toccano: le due
       richieste non si contraddicono, riguardano schermi diversi. */
    @media (min-width: 1025px) {
      #amm { padding: 14px 18px; }
      #amm h2 { font-size: 14px; margin-bottom: 4px; }
      #amm th { padding: 4px 10px; font-size: 10px; }
      #amm td { padding: 3px 10px; font-size: 12.5px; }
      /* Gli ultimi 47 pixel per far stare la scheda in una schermata: sono
         venuti da qui e dal margine in alto della pagina, non da altri tagli
         al contenuto. */
      .container { padding-top: 16px; }
      #amm input, #amm select { padding: 5px 9px; font-size: 12.5px; border-radius: 7px; }
      #amm .btn-sm { padding: 4px 10px; font-size: 11.5px; }
      #amm .badge { padding: 2px 8px; font-size: 10px; }
      #amm .form-group { margin-bottom: 8px; }
      #amm label { font-size: 10px; margin-bottom: 2px; }
      #amm .amm-num { padding: 8px 10px; }
      /* ⚠️ Col dito, la finestrella del piano deve stare dentro lo schermo.
         La regola generale delle finestrelle sotto i 768px è width:auto, e
         "auto" con dentro una TABELLA vuol dire «larga quanto la tabella»: il
         riquadro sbordava di 4px e faceva scorrere di lato TUTTA la pagina.
         Qui si fissa al 100% dello spazio disponibile, così è la tabella a
         scorrere dentro il suo riquadro (che ha overflow-x) invece della
         pagina. Regola mirata a questa sola finestrella: le altre non hanno
         tabelle dentro e non vanno toccate. */
      #amm .amm-num-v { font-size: 15px; }
      #amm #q-riepilogo { padding: 6px 10px; font-size: 12px; margin-top: 8px; }
      #amm p { font-size: 12px; }
    }
    ${/* ⚠️ QUESTO BLOCCO STA FUORI da quello qui sopra, e ci deve restare.
          L'avevo scritto dentro `@media (min-width: 1025px)`: «sopra 1025 E
          insieme sotto 768» non è mai vero, quindi la regola non si applicava
          mai e la misura non cambiava di un pixel. Prima di dire che una regola
          non funziona, guardare dentro quale media query è finita. */ ''}
    @media (max-width: 768px) {
      /* Col dito la finestrella del piano deve stare nello schermo: la regola
         generale delle finestrelle è width:auto, e "auto" con dentro una
         TABELLA vuol dire «larga quanto la tabella». */
      #modal-piano .modal-box { width: 100% !important; }
      /* 🔴 IL VERO COLPEVOLE dello scorrimento laterale su telefono — e non era
         la finestrella: i QUATTRO NUMERI stanno in quattro colonne fisse e a
         375px sbordavano di 36px, trascinandosi dietro tutta la pagina,
         finestrella compresa (un overlay si misura sul documento). Difetto che
         c'era già dal 12/08. Sotto i 768px vanno su due righe da due. */
      #amm-body > div { grid-template-columns: repeat(2, 1fr) !important; }
      #amm .amm-num { min-width: 0; }
    }
  </style></head><body>
  ${headerNoesys({ mondo: 'progetti', sub: 'progetti', briciole: [
    { label: 'Progetti Strutturati', href: '/dashboard/progetti' },
    { label: p.titolo },
  ] })}
  <div class="container">
    <div style="margin-bottom:18px">
      <h1>${esc(p.titolo)}</h1>
      <div style="margin:2px 0 6px">${collaudo.interruttore('progetto', p.id, p.di_collaudo)}</div>
      <p style="color:#aaa;font-size:13px">Committente: <strong style="color:var(--ink)">${esc(p.committente_nome)}</strong>${p.committente_email ? ` · ${esc(p.committente_email)}` : ''}</p>
      <p style="color:#aaa;font-size:13px">Referente: <strong style="color:var(--ink)">${
        (p.referente_modo || 'sponsor') === 'altra'
          ? `${esc(p.referente_nome || '—')}`
          : `${esc(p.committente_nome)}`
      }</strong>${
        (p.referente_modo || 'sponsor') === 'altra'
          ? `${p.referente_ruolo ? ` · ${esc(p.referente_ruolo)}` : ''}${p.referente_email ? ` · ${esc(p.referente_email)}` : ''}`
          : ` <span style="color:#aaa">(il committente stesso)</span>`
      }</p>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <span class="badge" style="background:${ac}18;color:${ac}">${esc(p.area)}</span>
        <span class="badge" style="background:#eef1f5;color:#4a5568">${TIPO_LABEL[p.tipo] || esc(p.tipo)}</span>
        <span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
        ${p.data_inizio ? `<span class="badge" style="background:#eef1f5;color:#7a8089">Inizio ${itDate(p.data_inizio)}</span>` : ''}
      </div>
      ${p.drive_url
        ? `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><a href="${esc(p.drive_url)}" target="_blank" style="font-size:13px;word-break:break-all">${esc(p.drive_url)}</a></div>`
        : `<div style="margin-top:10px"><div class="field-label">Cartella Drive</div><button id="drive-folders-btn" onclick="creaCartelleProgetto()" class="btn btn-neutral btn-sm">🔄 Crea cartelle Drive</button><span id="drive-folders-msg" style="font-size:12px;color:#6B7280;margin-left:8px"></span></div>`}
    </div>

    ${(p.obiettivo_smarter || p.parametri || p.note) ? `<div class="card">
      ${p.obiettivo_smarter ? `<div style="margin-bottom:10px"><div class="field-label">Obiettivo di progetto (SMARTER)</div><div class="field-value" style="white-space:pre-wrap">${esc(p.obiettivo_smarter)}</div></div>` : ''}
      ${p.parametri ? `<div style="margin-bottom:10px"><div class="field-label">Parametri di verifica del successo</div><div class="field-value" style="white-space:pre-wrap">${esc(p.parametri)}</div></div>` : ''}
      ${p.note ? `<div><div class="field-label">Note</div><div class="field-value" style="white-space:pre-wrap">${esc(p.note)}</div></div>` : ''}
    </div>` : ''}

    ${/* ═══ SPECIFICHE DI PROGETTO — Fetta 1 (28/08/2026) ═══════════════════
          ⭐ Il modello è di Germano: «un centro del progetto in cui le
             informazioni vengono inserite e monitorate, e delle succursali che
             quelle informazioni le ricevono e le utilizzano».
          ⚠️ QUESTA È LA FETTA 1: SOLA LETTURA. Non si scrive niente da qui, non
             c'è nessuna colonna nuova, non si tocca l'Amministrazione. Mostra
             ciò che l'Hub SA GIÀ e, accanto a ogni voce, dove si corregge oggi.
             Serve a far vedere a Germano cosa manca DAVVERO, invece di dedurlo
             da una conversazione.
          ⛔ «Un unico luogo» vuol dire UNA SOLA SCHERMATA, non una seconda copia
             dei dati: qui non nasce nessun archivio parallelo.
          Piano completo: iCloud/Noesys/Piattaforma/PIANO — Specifiche di Progetto.md */ ''}
    ${/* ═══ FETTA 6c — L'AVVISO PRIMA DEL KICK-OFF (30/08) ═════════════════
          Il Kick-Off è il momento in cui il progetto comincia davanti a tutti.
          Farlo senza il contratto firmato è un rischio vero: si lavora senza che
          nessuno abbia sottoscritto quanto costa, quante sedute sono, cosa si
          può dire al Committente.
          ⛔ AVVISO, NON PORTA CHIUSA — deciso da Germano: «un blocco vero mi
             farebbe combattere col gestionale il giorno che anticipo un Kick-Off
             su richiesta del cliente». Qui si grida, non si sbarra.
          ⚠️ E grida DI PIÙ se il Kick-Off è già avvenuto: lì non è più un
             promemoria, è una cosa da sistemare. */ ''}
    ${avvisoKickOff(p, fasi, statoContr('committente', p.id))}
    ${specificheCard({ p, coachee, percorsi, fasi, qTot, qComm, tot4, quoteGuaste,
       congelato: statoContr('committente', p.id) === 'approvata',
       nSedute: (seduteColl || []).length })}

    ${/* ═══ UNA SOLA TABELLA (12/08, secondo ripensamento) ═══════════════
          Germano, misurando: «dovrebbe potersi leggere tutta la scheda in
          un'unica schermata». Misurata: era alta 1376px su una finestra di 900.
          E il problema NON era la dimensione dei caratteri — quelli erano già
          stretti: erano **tre tabelle separate, una per pagatore, ognuna con la
          sua intestazione**, 623px per cinque righe di dati; più i nomi dei
          pagatori scritti due volte, nelle quote e di nuovo nel piano.
          Qui c'è una tabella sola: ogni pagatore è una RIGA DI GRUPPO con la sua
          quota, e sotto stanno le sue rate. Le intestazioni si scrivono una
          volta, e la tabella delle quote sparisce perché la quota è diventata
          una colonna di questa. */ ''}
    ${/* ⚠️ Il riquadro conserva id="amm": ci puntano i collegamenti che arrivano
          da altre pagine. E i due pulsanti stanno nel <summary>, quindi fermano il
          clic: senza, premerli chiuderebbe la sezione invece di aprire la
          finestrella. */ ''}
    ${/* ⭐ Fetta 3.4 (04/09, decisione (a) di Germano): il riquadro si chiama per
          ciò che contiene. «Amministrazione» resta solo l'area in alto. */ ''}
    ${sezione(
    `<h2 style="margin:0">Quote e piano dei pagamenti
              <span style="font-size:12px;font-weight:400;color:#aaa;margin-left:10px">
                Valore del progetto: <strong style="color:var(--ink)">${qTot != null ? '€ ' + eur(qTot) : '—'}</strong>
              </span>
            </h2>`,
    `
      <div id="amm-empty" style="display:${ammQuoteSet ? 'none' : 'block'};font-size:13px;color:var(--muted);margin-bottom:12px">Imposta il valore del progetto per vedere il riepilogo.</div>
      ${/* QUATTRO numeri: «chiesto ma non ancora pagato» è lo stato in cui si
            vive per settimane, e dentro un generico «da incassare» spariva.
            Vengono dalle rate SALVATE — una proposta non è un impegno. */ ''}
      <div id="amm-body" style="display:${ammQuoteSet ? 'block' : 'none'};margin-bottom:12px">
        ${pianoUi.quattroNumeri(tot4, pianoSalvato.length > 0)}
      </div>

      ${/* ⭐ 15/08 — LA SCHEDA NON SI SCRIVE PIÙ, SI LEGGE. Germano: «la trovo
            caotica e poco immediata… %/Da chiedere/Incassata/+ rata si scrive
            male e fa casino». La causa era meccanica: OGNI tasto rifaceva la
            tabella con innerHTML, quindi il campo in cui stavi scrivendo veniva
            distrutto e il cursore saltava fuori — 22 campi su 22. Provato:
            digitando «4» su una percentuale da 30 restava «4», cioè 280 € invece
            di 2.800.
            Ora le due cose stanno in due posti: qui SI GUARDA (chi, quanto,
            quando scade, a che punto), nella finestrella SI IMPOSTA. Il piano lo
            tocchi una volta a progetto; lo stato lo guardi ogni settimana.
            Le colonne «%», «Quando» e «Giorni» sono sparite di qui: la prima è
            un'etichetta accanto all'importo, le altre due sono già riassunte da
            «Scade il». */ ''}
      <div style="overflow-x:auto;margin:0 -4px">
        <table style="min-width:560px">
          <thead><tr>
            <th style="text-align:left">Chi paga · rata</th>
            <th style="text-align:left">Importo</th>
            <th style="text-align:left">Scade il</th>
            <th style="text-align:left">A che punto</th>
            <th></th>
          </tr></thead>
          <tbody id="amm-righe"></tbody>
        </table>
      </div>

      <div id="q-riepilogo" style="margin-top:8px;font-size:12.5px;color:#4a5568"></div>
    `,
    // Aperta finché i soldi chiedono qualcosa: il piano non è ancora stato fatto,
    // c'è da chiedere, o si aspetta un incasso. È la stessa regola che la home usa
    // già per i pacchetti — non se ne inventa una seconda.
    !pianoSalvato.length || (tot4.daChiedere || 0) > 0 || (tot4.chiesto || 0) > 0,
    `<button onclick="event.stopPropagation(); apriPiano()" class="btn btn-primary btn-sm">Modifica il piano</button>
     <button onclick="event.stopPropagation(); openAdd()" class="btn btn-neutral btn-sm">+ Aggiungi cliente</button>`, 'amm')}

    ${/* ── LA FINESTRELLA DEL PIANO ────────────────────────────────────────
          Un posto solo dove si imposta tutto: valore del progetto, quota di
          ciascun pagatore, e le sue rate. Un solo «Salva».
          ⚠️ Gli id `q-totale`, `q-comm` e la classe `.q-coachee` restano QUELLI
          DI PRIMA anche se ora vivono qui dentro: li leggono `salvaAmmSilenzioso`
          e `ricaricaConservando`, che tengono le modifiche non salvate quando la
          pagina si ricarica per altri motivi (aggiungi partecipante, cartelle,
          fasi). Cambiarli avrebbe rotto quella rete in silenzio. */ ''}
    ${/* ⚠️ 15/08 — QUI SERVE `width`, NON `max-width`. Germano: «la finestra non
          contiene tutti i campi, bisogna scorrere orizzontalmente». Avevo scritto
          max-width:720px credendo di allargarla, ma `.modal-box` ha
          **width: 520px** fisso: un max-width più grande non allarga niente, e
          la finestrella è sempre rimasta da 520 mentre la tabella dentro ne
          chiedeva 718. Misurato: 198px fuori dal bordo.
          860 = 718 della tabella + i due padding (box 52 + riquadro pagatore 26)
          e un margine per le etichette lunghe. Sta dentro un portatile e anche
          un iPad in orizzontale; sotto i 768px il CSS lo riporta già a tutta
          larghezza da solo. */ ''}
    ${pianoUi.modale({
      labelValore: 'Valore del progetto',
      valore: qTot,
      dataMeta: p.data_meta ? String(p.data_meta).slice(0, 10) : '',
      dataFine: p.data_fine ? String(p.data_fine).slice(0, 10) : '',
      sottotitolo: 'Quanto vale il progetto, chi paga quanto, e in quante volte. Si scrivono gli euro: la percentuale la calcola l\'Hub.',
      mostraDividi: true,
    })}
    ${pianoUi.modaleIncasso()}

    ${sezione(`<h2 style="margin:0">Percorsi <span style="font-weight:400;font-size:13px;color:#aaa">(${(percorsi || []).length})</span></h2>`,
      `${(percorsi && percorsi.length) ? `<div style="overflow-x:auto;margin:0 -4px"><table style="min-width:480px">
        <thead><tr>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Tipo</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Cliente/i</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Lavoro svolto</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Stato</th>
          <th style="text-align:left;font-size:12px;color:var(--muted)">Cartella sessioni</th>
        </tr></thead>
        <tbody>${percorsi.map(pc => {
          const condiviso = !pc.client_id;
          const sess = Number(pc.n_sessioni_fatte) || 0;
          const ore  = Number(pc.ore_fatte) || 0;
          const chi = condiviso
            ? (pc.partecipanti ? esc(pc.partecipanti) : `<span style="color:#aaa">nessun partecipante</span>`)
            : `<a href="/dashboard/clients/${pc.client_id}" style="color:#1A5280;text-decoration:none">${esc(pc.client_name || '—')}</a>`;
          // Cartella Drive: solo per il percorso CONDIVISO (i report di sessione collettiva
          // vivono lì). Gli individuali usano la cartella del cliente → '—'.
          const drive = !condiviso
            ? `<span style="color:#aaa">—</span>`
            : (pc.drive_url
                ? `<a href="${esc(pc.drive_url)}" target="_blank" style="font-size:12px;color:#1A5280">Apri su Drive ↗</a>`
                : `<button onclick="creaCartelleSessioni('${pc.id}', this)" class="btn btn-neutral btn-sm">Crea cartelle su Drive</button>`);
          return `<tr>
            <td><strong>${esc(pc.tipo)}</strong>${condiviso ? ` <span class="badge" style="background:#eef1f5;color:#4a5568">condiviso</span>` : ''}</td>
            <td style="font-size:13px">${chi}</td>
            <td style="font-size:12px;white-space:nowrap">
              <span style="font-size:13px;font-weight:700;color:var(--blue)">${sess}</span> <span style="font-size:11px;color:#aaa">${sess === 1 ? 'sessione' : 'sessioni'}</span>${ore > 0 ? `<span style="color:#dfe3e8"> · </span><span style="font-weight:700;color:var(--green)">${fmtOre(ore)}</span> <span style="font-size:11px;color:#aaa">h</span>` : ''}
            </td>
            <td><span class="badge ${pc.stato === 'attivo' ? 'badge-active' : 'badge-inactive'}">${pc.stato === 'attivo' ? 'Attivo' : 'Concluso'}</span></td>
            <td style="white-space:nowrap">${drive}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
      : `<div style="font-size:13px;color:var(--muted)">Nessun percorso ancora: si generano da soli quando aggiungi i clienti al progetto.</div>`}`,
      false, '<span style="font-size:12px;color:var(--muted)">nascono da soli dai clienti del progetto</span>')}

    ${/* ── I CONTRATTI DEL PROGETTO (28/08/2026) ────────────────────────────
          Card NUOVA, accanto alle altre: non tocca la tabella dell'Amministrazione,
          che è delicata (il 15/08 ogni tasto la ridisegnava e mangiava il campo in
          cui stavi scrivendo). Qui non si scrive niente, si preme e basta.
          ⭐ Regola di Germano (27/08): chi mette una quota firma un CONTRATTO;
             chi non mette niente — progetto tutto a carico dell'azienda, il caso
             più frequente — firma solo l'INFORMATIVA PRIVACY. */ ''}
    ${sezione('<h2 style="margin:0">Contratti</h2>',
      `${quoteGuaste
        ? `<div class="flash-error" style="margin-bottom:12px">${esc(quoteGuaste)} Finché non torna, i contratti non vengono preparati: un contratto al Committente e uno ai partecipanti che dicono cifre diverse sono due documenti firmati che si contraddicono.</div>`
        : ''}
      ${/* Fetta 6a — la colonna «A che punto è». Il pallino dice lo stato, il
            pulsante dice COSA STAI DICHIARANDO («l'ho inviata»), non a quale
            stato stai passando: è la stessa cosa detta dalla parte di chi lavora.
            Le due azioni di modifica sono facoltative e riportano a «da inviare».
            🔒 Il contratto del COMMITTENTE porta anche l'avviso: approvarlo
               congela le specifiche del progetto. */ ''}
      <div style="overflow-x:auto;margin:0 -4px">
        <table style="min-width:620px">
          <thead><tr>
            <th style="text-align:left;font-size:12px;color:var(--muted)">Chi firma</th>
            <th style="text-align:left;font-size:12px;color:var(--muted)">Quota a suo carico</th>
            <th style="text-align:left;font-size:12px;color:var(--muted)">Che cosa firma</th>
            <th style="text-align:left;font-size:12px;color:var(--muted)">A che punto è</th>
          </tr></thead>
          <tbody>
            <tr>
              <td><strong>${esc(p.committente_nome || 'Committente')}</strong> <span class="badge" style="background:#eef1f5;color:#4a5568">committente</span></td>
              <td style="white-space:nowrap">${qComm != null ? '€ ' + eur(qComm) : '<span style="color:#aaa">—</span>'}</td>
              <td style="white-space:nowrap">${quoteGuaste
                ? `<button class="btn btn-off btn-sm" disabled title="Prima devono tornare le quote">📄 Contratto</button>`
                : `<a href="/dashboard/progetti/${p.id}/contratto" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">📄 Contratto</a>`}</td>
              <td>${cellaStato('committente', p.id, statoContr('committente', p.id))}</td>
            </tr>
            ${coachee.map(k => {
              const q = k.quota_coachee != null ? Number(k.quota_coachee) : 0;
              const paga = q > 0;
              return `<tr>
              <td>${esc(k.name || '—')}</td>
              <td style="white-space:nowrap">${paga ? '€ ' + eur(Math.round(q)) : '<span style="color:#aaa">nessuna</span>'}</td>
              ${/* ⚠️ L'informativa privacy la firmano TUTTI, anche chi paga una
                    quota: i suoi dati li tratto io in ogni caso. Il contratto
                    invece lo firma solo chi mette dei soldi. Al primo giro
                    l'informativa l'avevo messa solo a chi non paga — visto
                    premendo il pulsante, non leggendo il codice. */ ''}
              <td style="white-space:nowrap">${paga
                ? (quoteGuaste
                    ? `<button class="btn btn-off btn-sm" disabled title="Prima devono tornare le quote">📄 Contratto</button>`
                    : `<a href="/dashboard/progetti/${p.id}/partecipanti/${k.part_id}/contratto" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">📄 Contratto</a>`) + ' '
                : ''}<a href="/dashboard/progetti/${p.id}/partecipanti/${k.part_id}/liberatoria" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none">📄 ${p.tipo === 'team' || p.tipo === 'group' ? 'Informativa e Regole' : 'Informativa privacy'}</a></td>
              <td>${(paga
                ? cellaStato('partecipante', k.part_id, statoContr('partecipante', k.part_id))
                : '<span style="font-size:12px;color:#aaa">nessun contratto: firma la sola informativa</span>')
                + cellaConsenso(k)}</td>
            </tr>`; }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">
        ${p.tipo === 'team' || p.tipo === 'group'
          ? `In un percorso collettivo quel documento si chiama <strong>«Informativa Privacy e Regole di Riservatezza»</strong> e
             lo firmano tutti i partecipanti, anche quelli che non pagano nulla. Oltre alla privacy porta dentro le regole del
             gruppo: quello che emerge in sessione <strong>non esce dal gruppo</strong>, e al Committente vanno
             <strong>i risultati del percorso</strong> — sempre come esito del lavoro del gruppo, mai entrando nel merito dei singoli.`
          : `L'informativa privacy la firmano tutti i partecipanti, anche quelli che non pagano nulla: i loro dati
             li tratti tu in ogni caso, e quel documento è dove sta scritto che al Committente vanno
             <strong>solo date, presenze e ore</strong> — mai i contenuti delle sessioni.`}
        Il contratto invece lo firma solo chi ha una quota a proprio carico.
      </div>`,
      // Aperta finché qualcuno deve ancora firmare: quando sono tutti approvati
      // la sezione riposa, perché non chiede più niente.
      contrattiDaSeguire,
      '<span style="font-size:12px;color:var(--muted)">si aprono in una scheda nuova · nessuno viene inviato</span>')}

    ${collCard}

    ${fasiCard}
  </div>

  <div id="modal-coachee" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px">Aggiungi cliente</h2>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button type="button" id="mode-new" onclick="setAddMode('new')" class="btn btn-primary btn-sm" style="flex:1">Cliente nuovo</button>
        <button type="button" id="mode-existing" onclick="setAddMode('existing')" class="btn btn-neutral btn-sm" style="flex:1">Cliente esistente</button>
      </div>

      <div id="add-new">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label>Nome</label><input id="k-nome" type="text"></div>
          <div class="form-group"><label>Cognome *</label><input id="k-cognome" type="text"></div>
        </div>
        <div class="form-group"><label>Email</label><input id="k-email" type="email"></div>
        <p style="color:var(--muted);font-size:12px;margin-bottom:12px">Nasce come cliente con il suo link alla piattaforma. La cartella Drive si crea dopo, dalla sua scheda.</p>
      </div>

      <div id="add-existing" style="display:none">
        ${nDisponibili
          ? `<div class="form-group"><label>Scegli un cliente già in anagrafica</label>
               <select id="k-existing"><option value="">— seleziona —</option>${opzioniClienti}</select></div>
             <p style="color:var(--muted);font-size:12px;margin-bottom:12px">Lo colleghi al progetto senza doppioni. I suoi dati non vengono toccati.</p>`
          : `<p style="color:var(--muted);font-size:13px;margin-bottom:12px">Non ci sono altri clienti da collegare: o sono già tutti in questo progetto, o non ne hai ancora altri in anagrafica.</p>`}
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="closeAdd()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveCoachee()" class="btn btn-primary" style="flex:1">Aggiungi</button>
      </div>
    </div>
  </div>

  <!-- Fetta B (Mattone 2) — modale sessione collettiva (crea/modifica) -->
  <div id="modal-seduta" class="modal-overlay">
    <div class="modal-box" style="width:600px;max-width:94vw">
      <h2 id="seduta-title" style="margin-bottom:16px">Aggiungi sessione</h2>
      <input id="s-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="s-tipo" onchange="oreAuto()"><option value="Intake">Intake</option><option value="Ongoing" selected>Ongoing</option><option value="Final">Final</option></select></div>
        <div class="form-group"><label>Data</label><input id="s-data" type="date"></div>
      </div>
      <div class="form-group" style="max-width:220px"><label>Ore <span id="s-ore-hint" style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0"></span></label><input id="s-ore" type="number" step="0.5" min="0"></div>
      <div class="form-group"><label>Obiettivo <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(comune al gruppo, una frase)</span></label><textarea id="s-obiettivo" style="min-height:54px"></textarea></div>
      <div class="form-group"><label>Argomenti trattati <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga; cita i nomi dei singoli dove serve)</span></label><textarea id="s-argomenti" style="min-height:72px" placeholder="- primo argomento&#10;- **Marco:** ha portato…"></textarea></div>
      <div class="form-group"><label>Attività concordate <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga)</span></label><textarea id="s-attivita" style="min-height:60px" placeholder="- attività comune&#10;- **Anna:** attività individuale"></textarea></div>
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr 1fr;gap:12px">
        <div class="form-group"><label>Scadenza <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(data)</span></label><input id="s-scadenza" type="date"></div>
        <div class="form-group"><label>Ora <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(prossimo)</span></label><input id="s-ora" type="time"></div>
        <div class="form-group"><label>Eseguita</label><select id="s-eseguita"><option value="">—</option><option value="✓">✓ fatta</option><option value="✗">✗ non fatta</option></select></div>
      </div>
      <div class="form-group"><label>Note</label><textarea id="s-note" style="min-height:60px"></textarea></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-seduta').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveSeduta()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#223B6E;color:#fff;padding:10px 18px;border-radius:22px;font-size:13px;z-index:200">Link copiato!</div>

  <script>
    ${statoUi.js()}
    const PID = ${JSON.stringify(p.id)};

    ${/* ⭐ 15/08 — LA FINESTRELLA DEL PIANO NON STA PIÙ QUI DENTRO.
          Sta in `piano-ui.js` e la usa anche la scheda del cliente, perché un
          percorso a Pacchetto paga a rate esattamente come un progetto
          (decisione di Germano del 15/08). Tenerne due copie avrebbe voluto
          dire due occasioni di divergere — lo stesso guaio che avevamo appena
          finito di riparare fra la scheda del progetto e quella del cliente. */ ''}
    ${pianoUi.js({
      piani,
      dataFirma: p.data_inizio ? String(p.data_inizio).slice(0, 10) : '',
      quotaPerPagatore: true,
    })}

    // ── Quello che cambia da pagina a pagina ─────────────────────────────
    // I comandi sulla riga di un pagatore. Qui si apre la sua scheda e lo si
    // toglie dal progetto; sulla scheda del cliente non c'è niente da fare,
    // perché il pagatore è la persona di cui stai già guardando la scheda.
    function azioniPagatore(pg) {
      if (pg.tipo === 'committente') return '';
      return '<a href="/dashboard/clients/' + pg.client_id + '" class="btn btn-neutral btn-sm">Scheda</a>'
        + ' <button onclick="removeCoachee(\\'' + pg.pid + '\\')" class="btn btn-danger btn-sm" title="Elimina dal progetto">🗑</button>';
    }
    // Il riepilogo in cima alla scheda si rifà dopo la tabella: è un testo
    // derivato, non un campo, e qui nessuno sta scrivendo.
    function dopoDisegnaPiano() { recalcQuota(); }

    // Fetta B (Mattone 2) — sessioni collettive del percorso condiviso.
    const COLL_PID = ${JSON.stringify(percCond ? percCond.id : '')};
    const COLL_FINE_ISO = ${JSON.stringify(collFineIso)};   // data dell'ultima sessione confermata
    const COLL_FINE_IT  = ${JSON.stringify(collFineIt)};
    const SEDUTE = ${JSON.stringify(Object.fromEntries(seduteColl.map(s => [s.id, { id: s.id, percorso_id: s.percorso_id, tipo: s.tipo, data: s.data, ore: Number(s.ore), obiettivo: s.obiettivo || '', argomenti: s.argomenti || '', attivita: s.attivita || '', scadenza: s.scadenza || '', prossima_ora: s.prossima_ora || '', eseguita: s.eseguita || '', note: s.note || '' }]))).replace(/</g, '\\u003c')};
    const ORE_TIPO_COLL = { Intake: 2, Ongoing: 1, Final: null };
    ${paginaJs.sedute({
      oreTipo: 'ORE_TIPO_COLL', richiedePercorso: false,
      basePercorso: "'/dashboard/progetti/' + PID + '/percorsi/' + pid",
      pidSalvataggio: 'COLL_PID',
      ricarica: 'ricaricaConservando()',
      confermaElimina: 'Eliminare questa sessione? Le ore si ricalcolano.',
      confermaApprova: 'Approvare questa scheda? Da bozza diventa una sessione confermata e le ore entrano nel conteggio (categoria Team/Group).',
    })}
    async function chiudiPercorsoColl() {
      const msg = COLL_FINE_ISO
        ? ("Concludere il percorso di gruppo? La data di fine sarà " + COLL_FINE_IT + ", il giorno dell'ultima sessione.")
        : 'Concludere il percorso di gruppo? Non ci sono sessioni registrate, quindi la data di fine sarà oggi.';
      if (!confirm(msg)) return;
      if (!await chiamaHub('/dashboard/progetti/' + PID + '/percorsi/' + COLL_PID + '/chiudi',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_fine: COLL_FINE_ISO || null }) })) return;
      ricaricaConservando();
    }
    // Fetta 4 — quante sessioni prevede il percorso condiviso. Fino al 29/08
    // quel numero non si poteva cambiare da nessuna schermata: nasceva a 8 (il
    // valore di riserva del database) e restava 8 per sempre.
    ${collaudo.js()}
    ${chiamaUi.js()}
    // Fetta 6a — muove lo stato di una bozza di contratto.
    // ⚠️ Approvare il contratto del COMMITTENTE congela le specifiche del
    //    progetto: è l'unico passaggio che si fa confermare, perché è l'unico
    //    che toglie qualcosa (la possibilità di cambiare idea).
    ${paginaJs.muoviContratto({ confermaCongelamento: true, ricarica: 'ricaricaConservando()' })}
    // Fetta 6b — la tipologia. Si fa confermare perché cambia la natura del
    // percorso e quindi le clausole dei contratti che ne escono.
    async function salvaTipo() {
      const sel = document.getElementById('sp-tipo');
      if (!sel) return;
      if (!confirm('Cambiare la tipologia cambia le clausole dei contratti: riservatezza, che cosa riceve il Committente e come si svolgono le sessioni.\\n\\nProcedo?')) return;
      const r = await fetch('/dashboard/progetti/' + PID + '/tipo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: sel.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { alert(d.error || ('Errore: ' + r.status)); return; }
      ricaricaConservando();
    }
    async function salvaPreviste() {
      const campo = document.getElementById('sp-previste');
      if (!campo) return;
      const n = parseInt(campo.value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        alert("Il numero di sessioni previste dev'essere un intero fra 1 e 100.");
        campo.focus(); return;
      }
      const r = await fetch('/dashboard/progetti/' + PID + '/percorsi/' + COLL_PID + '/previste',
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ n_sessioni_previste: n }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); return; }
      ricaricaConservando();
    }
    async function scanCollettivo() {
      const btn = document.getElementById('scan-coll-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/progetti/' + PID + '/scan-collettivo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : '. Controlla che il file inizi con "Report" e sia nelle sottocartelle Intake/Ongoing/Final del percorso.'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto, da approvare.');
        ricaricaConservando();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }

    // Cartella Drive del progetto: crea (o ripristina) l'albero se drive_url è vuoto.
    async function creaCartelleProgetto() {
      const btn = document.getElementById('drive-folders-btn');
      const msg = document.getElementById('drive-folders-msg');
      btn.disabled = true; msg.style.color='#6B7280'; msg.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (d.error) { msg.style.color='#b45309'; msg.textContent = d.error; btn.disabled = false; return; }
        ricaricaConservando();
      } catch(e) { msg.style.color='#b45309'; msg.textContent = 'Errore di rete, riprova'; btn.disabled = false; }
    }

    // Fetta B / Mattone 1 — crea la cartella Drive del percorso CONDIVISO (team/group)
    // dentro il progetto (sottocartelle Intake/Ongoing/Final). Poi ricarica per mostrare il link.
    async function creaCartelleSessioni(pid, btn) {
      const old = btn.textContent; btn.disabled = true; btn.textContent = 'Creo…';
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/percorsi/'+pid+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || 'Errore');
        ricaricaConservando();
      } catch(e) { alert('Errore: '+e.message); btn.disabled = false; btn.textContent = old; }
    }

    // ── Fase 3B: quota del progetto ──
    // Gemella di fiscale.euro() per il BROWSER (il modulo del server non si puo
    // chiamare qui). useGrouping always = il punto delle migliaia anche sotto le
    // 5 cifre, scelta di Germano del 17/08.
    function euro(n) { return Number(n||0).toLocaleString('it-IT', { minimumFractionDigits:2, maximumFractionDigits:2, useGrouping:'always' }); }

    // ── I quattro numeri in cima ──
    // ⚠️ Qui si aggiorna SOLO «Concordato», che è la quota totale scritta nel
    // campo qui accanto. Gli altri tre vengono dalle tranche SALVATE e li scrive
    // il server: aggiornarli mentre si digita vorrebbe dire contare come
    // «da chiedere» delle rate che ancora non esistono, cioe' mostrare un numero
    // che sparisce ricaricando la pagina.
    function renderAmministrazione() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      const body = document.getElementById('amm-body');
      const empty = document.getElementById('amm-empty');
      if (!isFinite(tot) || tot <= 0) { body.style.display = 'none'; empty.style.display = 'block'; return; }
      body.style.display = 'block'; empty.style.display = 'none';
      document.getElementById('amm-atteso').textContent = '€ ' + euro(tot);
    }
    function recalcQuota() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      // ⚠️ q-comm nasce dentro la tabella, che disegna il JS: al primo giro puo'
      // non esserci ancora. Prima si leggeva senza guardare, e la pagina si
      // fermava con la tabella vuota — un guasto muto, la scheda sembrava solo
      // «senza dati».
      const elComm = document.getElementById('q-comm');
      const comm = elComm ? parseFloat(elComm.value) : NaN;
      // Una riga sola di verifica: prima ce n'erano due che dicevano la stessa
      // cosa da due punti di vista (quanto resta / quanto coprono i clienti).
      const box = document.getElementById('q-riepilogo');
      if (!isFinite(tot) || tot <= 0) {
        box.textContent = 'Scrivi il valore del progetto per vedere la divisione.';
        renderAmministrazione();
        return;
      }
      const c = isFinite(comm) ? comm : 0;
      const somma = (typeof PIANI !== 'undefined')
        ? PIANI.reduce(function (s2, pg) { return s2 + (Number(pg.quota) || 0); }, 0) : c;
      const pct = Math.round(c / tot * 100);
      const diff = tot - somma;
      box.innerHTML = diff === 0
        ? '<span style="color:#4F8B73">Le quote coprono € ' + euro(tot) + ' — torna.</span>'
          + ' <span style="color:var(--hint)">Il committente copre il ' + pct + '%.</span>'
        : '<span style="color:#b45309">Le quote sommano € ' + euro(somma) + ' su € ' + euro(tot)
          + (diff > 0 ? ': mancano € ' + euro(diff) : ': € ' + euro(-diff) + ' di troppo') + '.</span>';
      renderAmministrazione();
    }

    // ── Fase 3B Pezzo 2: divisione tra i coachee ──
    function getResto() {
      const tot = parseFloat(document.getElementById('q-totale').value);
      const elC = document.getElementById('q-comm');
      const comm = elC ? parseFloat(elC.value) : NaN;
      if (!isFinite(tot) || tot <= 0) return null;
      const c = isFinite(comm) ? comm : 0;
      return Math.max(tot - c, 0);
    }
    function coacheeInputs() { return Array.prototype.slice.call(document.querySelectorAll('.q-coachee')); }
    // Divide il resto (valore del progetto meno la quota del committente) fra i
    // partecipanti. ⚠️ Dal 15/08 scrive NEI CAMPI della finestrella, che sono la
    // verita' finche' e' aperta — non piu' in PIANI, che ormai e' solo lo stato
    // di partenza. Qui si puo' toccare il DOM: e' un clic esplicito, non una
    // digitazione, quindi non c'e' nessun cursore da far saltare.
    function dividiEqui() {
      const resto = getResto();
      if (resto === null) { alert('Scrivi prima il valore del progetto.'); return; }
      const campi = coacheeInputs();
      if (!campi.length) return;
      // Cifre INTERE (regola del 27/07) e il resto della divisione al
      // committente: 3.000 diviso 3 e' tondo, 100 diviso 3 no.
      const base = Math.floor(resto / campi.length);
      campi.forEach(function (i) { i.value = base; });
      const avanzo = resto - base * campi.length;
      const comm = document.getElementById('q-comm');
      if (avanzo && comm) comm.value = (Math.round(Number(comm.value) || 0)) + avanzo;
      // Chi non ha ancora nessuna rata riceve la proposta sulla quota nuova:
      // un pagatore con la quota e senza piano resterebbe un buco da riempire
      // a mano, ed e' proprio il lavoro che la proposta esiste per evitare.
      document.querySelectorAll('#piano-pagatori .pg-box').forEach(function (box) {
        const tb = box.querySelector('.pg-righe');
        if (tb.querySelectorAll('tr').length) return;
        const key = box.getAttribute('data-key');
        const pg = pianoDi(key);
        if (!pg) return;
        const quota = quotaDi(box);
        if (quota <= 0) return;
        tb.innerHTML = proponiRate({ tipo: pg.tipo, quota: quota })
          .map(function (t) { return rigaPianoHtml(key, t); }).join('');
        tb.querySelectorAll('tr').forEach(function (tr, i) {
          const s = tr.querySelector('.pr-inn');
          if (s) s.value = proponiRate({ tipo: pg.tipo, quota: quota })[i].innesco;
        });
      });
      ricalcolaPiano();
    }
    // La stessa proposta che fa il server, per quando la quota cambia in pagina:
    // 30/40/30 al committente, una rata anticipata al partecipante.
    function proponiRate(pg) {
      if (pg.tipo === 'partecipante') {
        return [{ id: null, etichetta: 'Quota', importo: pg.quota, innesco: 'firma', giorni: 0, stato: 'da_chiedere', data_incasso: null }];
      }
      const a = Math.round(pg.quota * 0.30), b = Math.round(pg.quota * 0.40);
      return [
        { id: null, etichetta: 'Acconto', importo: a, innesco: 'firma', giorni: 30, stato: 'da_chiedere', data_incasso: null },
        { id: null, etichetta: 'Metà percorso', importo: b, innesco: 'meta', giorni: 30, stato: 'da_chiedere', data_incasso: null },
        { id: null, etichetta: 'Saldo', importo: pg.quota - a - b, innesco: 'fine', giorni: 30, stato: 'da_chiedere', data_incasso: null },
      ];
    }
    // ⭐ UN SOLO «Salva»: quote e rate insieme. Erano due pulsanti — «Salva le
    // quote» e «Salva il piano» — e salvarne uno solo lasciava la scheda a
    // metà, con le rate che non tornavano piu' con la quota.
    async function salvaTutto() {
      const err = document.getElementById('piano-error');
      err.style.display = 'none';
      try {
        // ⚠️ Si legge dai CAMPI della finestrella, non da PIANI: è il DOM la
        // verità mentre si scrive, ed è l'unico modo di non ridisegnare gli
        // input a ogni tasto (il difetto D1). Lo fa leggiFinestrella(), che sta
        // nel modulo condiviso perche serve identica alle due pagine.
        // (⚠️ niente apici inversi qui dentro: chiudono la template literal.)
        const perKey = leggiFinestrella();
        const chiavi = Object.keys(perKey);
        const commKey = chiavi.filter(function (k) { return perKey[k].tipo === 'committente'; })[0];

        const rq = await fetch('/dashboard/progetti/'+PID+'/quota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quota_totale: document.getElementById('q-totale').value, quota_committente: commKey ? perKey[commKey].quota : '' }) });
        const dq = await rq.json();
        if (!dq.ok) { err.textContent = dq.error || 'Errore nel salvataggio del valore del progetto'; err.style.display='block'; return; }

        const quote = chiavi.filter(function (k) { return perKey[k].tipo === 'partecipante'; })
          .map(function (k) { return { part_id: perKey[k].pid, quota: perKey[k].quota }; });
        if (quote.length) {
          const rc = await fetch('/dashboard/progetti/'+PID+'/quote-coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quote }) });
          const dc = await rc.json();
          if (!dc.ok) { err.textContent = dc.error || 'Errore nel salvataggio delle quote'; err.style.display='block'; return; }
        }

        const rp = await fetch('/dashboard/progetti/'+PID+'/piano', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            piani: chiavi.map(function (k) { return { partecipazione_id: perKey[k].pid, righe: perKey[k].righe }; }),
            data_meta: document.getElementById('pi-meta').value,
            data_fine: document.getElementById('pi-fine').value }) });
        const dp = await rp.json().catch(function () { return {}; });
        if (!rp.ok) { err.textContent = dp.error || ('Errore ' + rp.status); err.style.display='block'; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; }
    }
    // Fetta B fix (2026-07-23) — salva (best-effort) i valori dell'Amministrazione
    // già in pagina (quota totale/committente + quote dei clienti). Serve prima
    // di una ricarica strutturale (aggiungi/togli partecipante, crea cartelle, fasi): la
    // ricarica ripesca i valori dal DB, quindi senza questo le modifiche non ancora salvate
    // col pulsante "Salva" sparirebbero (era il bug segnalato).
    // ⚠️ Fetta 2.1 (04/09): non è più «senza avvisi». Se il server rifiuta (per esempio
    //    il progetto è congelato), chiamaHub lo DICE; la ricarica prosegue lo stesso,
    //    perché l'azione principale è un'altra e non deve restare a metà.
    async function salvaAmmSilenzioso() {
      try {
        const qt = document.getElementById('q-totale');
        if (qt) {
          const qc = document.getElementById('q-comm');
          await chiamaHub('/dashboard/progetti/'+PID+'/quota', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quota_totale: qt.value, quota_committente: qc ? qc.value : '' }) });
        }
        const quote = coacheeInputs().map(i => ({ part_id: i.getAttribute('data-part'), quota: i.value }));
        if (quote.length) {
          await chiamaHub('/dashboard/progetti/'+PID+'/quote-coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quote }) });
        }
      } catch (e) { /* best-effort: non deve bloccare la ricarica */ }
    }
    // Ricarica la pagina conservando le modifiche non salvate dell'Amministrazione.
    function ricaricaConservando() {
      salvaAmmSilenzioso().finally(function(){ location.reload(); });
    }
    // ⛔ TOLTE il 12/08: paintPagCoachee / togglePagCoachee / renderPag /
    // togglePagComm — l'interruttore «Incassato / Da incassare» sull'intera
    // quota. Era il secondo modo, incompatibile, di dire la stessa cosa che
    // dicono le tranche («dicono cose diverse», Germano). Adesso lo stato è di
    // ogni rata: vedi segnaStato().
    // Le colonne stato_pag_committente e stato_pag_coachee restano nel
    // database e non le legge più nessuno. ⛔ 31/08: le due ROTTE che le
    // scrivevano sono state tolte con la pulizia del codice morto; le COLONNE
    // no, per decisione di Germano — una migrazione non si torna indietro, e
    // due colonne vuote e ferme non danno fastidio a nessuno. In produzione al
    // 31/08 sono tutte al valore di partenza «atteso»: non le ha mosse nessuno.

    let addMode = 'new';
    function setAddMode(m) {
      addMode = m;
      document.getElementById('add-new').style.display      = m === 'new'      ? 'block' : 'none';
      document.getElementById('add-existing').style.display = m === 'existing' ? 'block' : 'none';
      document.getElementById('mode-new').className      = 'btn btn-sm ' + (m === 'new'      ? 'btn-primary' : 'btn-neutral');
      document.getElementById('mode-existing').className = 'btn btn-sm ' + (m === 'existing' ? 'btn-primary' : 'btn-neutral');
    }
    function openAdd() {
      ['k-nome','k-cognome','k-email'].forEach(id=>document.getElementById(id).value='');
      const sel = document.getElementById('k-existing'); if (sel) sel.value='';
      setAddMode('new');
      document.getElementById('modal-coachee').style.display='flex';
    }
    function closeAdd() { document.getElementById('modal-coachee').style.display='none'; }
    async function saveCoachee() {
      let payload;
      if (addMode === 'existing') {
        const sel = document.getElementById('k-existing');
        const clientId = sel ? sel.value : '';
        if (!clientId) { alert('Scegli un cliente dalla lista.'); return; }
        payload = { clientId };
      } else {
        const cognome = document.getElementById('k-cognome').value.trim();
        if (!cognome) { alert('Cognome obbligatorio'); return; }
        payload = { nome:document.getElementById('k-nome').value, cognome, email:document.getElementById('k-email').value };
      }
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (d.ok) ricaricaConservando(); else alert(d.error || 'Errore');
    }
    async function removeCoachee(partId) {
      if (!confirm('Eliminare questo cliente dal progetto? Se non ha ancora dati, viene eliminato anche dall\\'anagrafica.')) return;
      const r = await fetch('/dashboard/progetti/'+PID+'/coachee/'+partId, { method:'DELETE' });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      if (d.kept && d.message) alert(d.message);
      ricaricaConservando();
    }
    // ── Fase 3a: le tappe del progetto (aggiunte a mano da una tendina) ──
    const FASE_LABELS = ${JSON.stringify(FASE_LABELS)};
    const FASE_ORDER  = ${JSON.stringify(FASE_ORDER)};
    function toggleFaseMenu() {
      const m = document.getElementById('fase-menu');
      m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
    }
    document.addEventListener('click', function(e) {
      const m = document.getElementById('fase-menu');
      if (!m || m.style.display !== 'block') return;
      if (!m.contains(e.target) && !(e.target.getAttribute && e.target.getAttribute('onclick') === 'toggleFaseMenu()')) m.style.display = 'none';
    });
    function toggleDettaglio(btn) {
      const b = btn.closest('.fase-block');
      const d = b.querySelector('.fase-dettaglio');
      const open = d.style.display !== 'none';
      d.style.display = open ? 'none' : 'block';
      btn.textContent = open ? 'Dettaglio ▾' : 'Dettaglio ▴';
    }
    async function salvaFase(btn) {
      const b = btn.closest('.fase-block');
      const contenuto = {};
      let obiettivo, parametri;
      b.querySelectorAll('.f-voce').forEach(function(el) {
        const proj = el.dataset.proj || '';
        if (proj === 'obiettivo_smarter') obiettivo = el.value;
        else if (proj === 'parametri') parametri = el.value;
        else contenuto[el.dataset.key] = el.value;
      });
      const payload = {
        tipo: b.dataset.tipo,
        fid: b.dataset.fid || '',
        data: b.querySelector('.f-data').value || null,
        fatta: b.querySelector('.f-fatta').checked,
        contenuto: contenuto
      };
      if (obiettivo !== undefined) payload.obiettivo = obiettivo;
      if (parametri !== undefined) payload.parametri = parametri;
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      if (d.id) b.dataset.fid = d.id;
      showToast('Fase salvata');
    }
    async function approvaFase(btn) {
      const b = btn.closest('.fase-block');
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ fid:b.dataset.fid, tipo:b.dataset.tipo, approva:true }) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      ricaricaConservando();
    }
    async function addFase(tipo) {
      document.getElementById('fase-menu').style.display = 'none';
      const r = await fetch('/dashboard/progetti/'+PID+'/fasi', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ tipo }) });
      const d = await r.json();
      if (!d.ok) { alert(d.error || 'Errore'); return; }
      ricaricaConservando();
    }
    async function scanProgetto() {
      const btn = document.getElementById('scan-fasi-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/progetti/'+PID+'/scan-drive', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : '. Controlla che il file inizi con "Report" e sia nella sottocartella di fase giusta.'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto: apri il Dettaglio e approva.');
        ricaricaConservando();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }
    async function delFase(btn) {
      const b = btn.closest('.fase-block');
      const fid = b.dataset.fid;
      if (fid && !confirm('Eliminare questa tappa?')) return;
      if (fid) {
        const r = await fetch('/dashboard/progetti/'+PID+'/fasi/'+fid, { method:'DELETE' });
        const d = await r.json();
        if (!d.ok) { alert(d.error || 'Errore'); return; }
      }
      b.remove();
      const list = document.getElementById('fasi-list');
      if (!list.querySelector('.fase-block')) document.getElementById('fasi-empty').style.display = 'block';
    }
    ${paginaJs.toast()}
    document.getElementById('modal-coachee').addEventListener('click', e => { if (e.target === document.getElementById('modal-coachee')) closeAdd(); });
    ${/* ⚠️ ORDINE DI AVVIO — la finestrella PRIMA della tabella. È lei a creare
          i campi delle quote (q-comm, .q-coachee), che recalcQuota() legge alla
          fine di disegnaPiano(). Invertendo, la tabella nascerebbe vuota e senza
          nessun messaggio: è il guasto muto del 12/08, quello che sembra
          «non ci sono dati». */ ''}
    costruisciFinestrella();
    disegnaPiano();
    ['pi-meta', 'pi-fine'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', disegnaPiano);
    });
    // Cliccare fuori chiude, come le altre finestrelle della pagina.
    ['modal-piano', 'modal-incasso'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m) m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
    });
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════
// RENDER DATI STRUMENTI (sola lettura)
// ═══════════════════════════════════════════════════════

module.exports = { committentiPage, progettiPage, avvisoKickOff, specificheCard, progettoDettaglioPage };
