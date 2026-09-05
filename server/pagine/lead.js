/**
 * I LEAD — chi ha contattato Noesys e non è ancora un cliente.
 * Fetta 4.1 del riordino (04/09/2026): spostato da routes.js così com'era.
 */
const chiamaUi = require('../chiama-ui');
const statoUi = require('../stato-ui');
const { FONTE_LABEL, baseStyle, esc, fonteOptions, headerNoesys, itDate, jsStr } = require('./comune');

function leadsPage(leads, req) {
  const STATO_CFG = {
    nuovo:       { label:'Nuovo',        bg:'#e8f4fd', color:'#1A5280' },
    contattato:  { label:'Contattato',   bg:'#fff8dc', color:'#7a5c00' },
    call_fissata:{ label:'Call fissata', bg:'#e7f1ec', color:'#2e6b52' },
    incontro_fissato:{ label:'Incontro fissato', bg:'#eae6f7', color:'#4c3a86' },
    convertito:  { label:'Convertito',   bg:'#d1fae5', color:'#065f46' },
    perso:       { label:'Perso',        bg:'#fdf0ef', color:'#c0392b' },
  };

  const attivi = leads.filter(l => l.stato !== 'convertito' && l.stato !== 'perso');
  const archiviati = leads.filter(l => l.stato === 'convertito' || l.stato === 'perso');

  function renderRow(l) {
    const sc = STATO_CFG[l.stato] || STATO_CFG.nuovo;
    return `<tr>
      <td><strong>${esc(l.nome)} ${esc(l.cognome||'')}</strong>
        ${l.email ? `<br><span style="font-size:11px;color:#aaa">${esc(l.email)}</span>` : ''}
        ${l.telefono ? `<br><span style="font-size:11px;color:#aaa">${esc(l.telefono)}</span>` : ''}
      </td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</span></td>
      <td style="font-size:12px;color:#aaa">${FONTE_LABEL[l.fonte]||l.fonte}</td>
      <td style="font-size:12px;color:#aaa">${l.data_prossimo_contatto ? itDate(l.data_prossimo_contatto) : '—'}</td>
      <td style="font-size:12px;color:#4a5568;max-width:180px">${esc(l.note||'')}</td>
      <td style="white-space:nowrap">
        <button onclick="editLead('${l.id}',${jsStr(l.nome)},${jsStr(l.cognome||'')},${jsStr(l.email||'')},${jsStr(l.telefono||'')},'${l.fonte}','${l.stato}',${jsStr(l.note||'')},'${l.data_prossimo_contatto?String(l.data_prossimo_contatto).slice(0,10):''}')" class="btn btn-neutral btn-sm">Modifica</button>
        ${l.stato!=='convertito' ? `<button onclick="convertLead('${l.id}')" class="btn btn-neutral btn-sm" style="margin:0 4px" title="Trasforma questo lead in un cliente">→ Cliente</button>` : ''}
        <span style="display:inline-block;width:10px"></span><button onclick="deleteLead('${l.id}')" class="btn btn-danger btn-sm" title="Elimina il lead">🗑</button>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Lead</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'lead' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>Lead</h1><p style="color:#aaa;font-size:13px">${attivi.length} attivi · ${archiviati.length} archiviati</p></div>
      <button onclick="openNew()" class="btn btn-primary">+ Nuovo lead</button>
    </div>

    <input id="cerca" type="search" placeholder="🔍 Cerca lead (nome, email, telefono…)" oninput="filtra()" style="margin-bottom:14px">

    <div class="card" style="padding:0;overflow-x:auto">
      <table>
        <thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th></th></tr></thead>
        <tbody>
          ${attivi.length ? attivi.map(renderRow).join('') : `<tr><td colspan="6" class="empty">Nessun lead attivo.</td></tr>`}
        </tbody>
      </table>
    </div>

    ${archiviati.length ? `
    <h2 style="margin:24px 0 10px;font-size:14px;color:#aaa">Archiviati (convertiti / persi)</h2>
    <div class="card" style="padding:0;overflow-x:auto">
      <table><thead><tr><th>Contatto</th><th>Stato</th><th>Fonte</th><th>Prossimo contatto</th><th>Note</th><th></th></tr></thead>
      <tbody>${archiviati.map(renderRow).join('')}</tbody></table>
    </div>` : ''}
  </div>

  <div id="modal-lead" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px" id="modal-lead-title">Nuovo lead</h2>
      <input type="hidden" id="lead-id">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome *</label><input id="l-nome" type="text"></div>
        <div class="form-group"><label>Cognome</label><input id="l-cognome" type="text"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="l-email" type="email"></div>
        <div class="form-group"><label>Telefono</label><input id="l-tel" type="tel"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Fonte</label>
          <select id="l-fonte">${fonteOptions('altro')}</select></div>
        <div class="form-group"><label>Stato</label>
          <select id="l-stato"><option value="nuovo">Nuovo</option><option value="contattato">Contattato</option><option value="call_fissata">Call fissata</option><option value="incontro_fissato">Incontro fissato</option><option value="perso">Perso</option></select></div>
      </div>
      <div class="form-group"><label>Prossimo contatto</label><input id="l-data" type="date"></div>
      <div class="form-group"><label>Note</label><input id="l-note" type="text" placeholder="osservazioni libere"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeLeadModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveLead()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <div id="modal-area" class="modal-overlay">
    <div class="modal-box" style="width:340px">
      <h2 style="margin-bottom:6px">Converti in cliente</h2>
      <p style="color:#aaa;font-size:13px;margin-bottom:16px">Scegli l'area del nuovo cliente:</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="doConvert('Personal')" class="btn" style="background:#1A5280;color:#fff">Personal</button>
        <button onclick="doConvert('Business')" class="btn" style="background:#4F8B73;color:#fff">Business</button>
        <button onclick="doConvert('Young')" class="btn" style="background:#D8AE2E;color:#fff">Young</button>
      </div>
      <button onclick="closeAreaModal()" class="btn btn-neutral" style="width:100%;margin-top:14px">Annulla</button>
    </div>
  </div>

  <script>
    ${statoUi.js()}
    ${chiamaUi.js()}
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      document.querySelectorAll('tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    }
    function openNew() {
      document.getElementById('modal-lead-title').textContent='Nuovo lead';
      document.getElementById('lead-id').value='';
      ['l-nome','l-cognome','l-email','l-tel','l-note','l-data'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('l-fonte').value='altro';
      document.getElementById('l-stato').value='nuovo';
      document.getElementById('modal-lead').style.display='flex';
    }
    function editLead(id,nome,cognome,email,tel,fonte,stato,note,data) {
      document.getElementById('modal-lead-title').textContent='Modifica lead';
      document.getElementById('lead-id').value=id;
      document.getElementById('l-nome').value=nome;
      document.getElementById('l-cognome').value=cognome;
      document.getElementById('l-email').value=email;
      document.getElementById('l-tel').value=tel;
      document.getElementById('l-fonte').value=fonte;
      document.getElementById('l-stato').value=stato;
      document.getElementById('l-note').value=note;
      document.getElementById('l-data').value=data;
      document.getElementById('modal-lead').style.display='flex';
    }
    function closeLeadModal() { document.getElementById('modal-lead').style.display='none'; }
    async function saveLead() {
      const nome = document.getElementById('l-nome').value.trim();
      if (!nome) { alert('Nome obbligatorio'); return; }
      const payload = {
        nome, cognome:document.getElementById('l-cognome').value,
        email:document.getElementById('l-email').value, telefono:document.getElementById('l-tel').value,
        fonte:document.getElementById('l-fonte').value, stato:document.getElementById('l-stato').value,
        note:document.getElementById('l-note').value, data_prossimo_contatto:document.getElementById('l-data').value||null,
      };
      const id = document.getElementById('lead-id').value;
      const url = id ? '/dashboard/leads/'+id : '/dashboard/leads';
      if (!await chiamaHub(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})) return;
      location.reload();
    }
    let convertingLeadId = null;
    function convertLead(id) {
      convertingLeadId = id;
      document.getElementById('modal-area').style.display='flex';
    }
    function closeAreaModal() {
      document.getElementById('modal-area').style.display='none';
      convertingLeadId = null;
    }
    async function doConvert(area) {
      if (!convertingLeadId) return;
      const r = await fetch('/dashboard/leads/'+convertingLeadId+'/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area})});
      const d = await r.json();
      if (d.ok) location.href='/dashboard/clients/'+d.clientId;
      else { alert(d.error||'Errore conversione'); closeAreaModal(); }
    }
    async function deleteLead(id) {
      if(!confirm('Eliminare questo lead?')) return;
      if (!await chiamaHub('/dashboard/leads/'+id,{method:'DELETE'})) return; location.reload();
    }
    document.getElementById('modal-lead').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-lead')) closeLeadModal(); });
    document.getElementById('modal-area').addEventListener('click',e=>{ if(e.target===document.getElementById('modal-area')) closeAreaModal(); });
  </script>
  </body></html>`;
}

module.exports = { leadsPage };
