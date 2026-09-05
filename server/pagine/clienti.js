/**
 * I CLIENTI — accesso, elenco, scheda del cliente, ricerca, Estratto ICF, diagnosi Drive.
 * Fetta 4.1 del riordino (04/09/2026): spostato da routes.js così com'era.
 */
const { logoCompact } = require('../logo');
const chiamaUi = require('../chiama-ui');
const collaudo = require('../collaudo');
const contrattiStato = require('../contratti-stato');
const contratto = require('../contratto');
const dateIt = require('../date-it');
const documenti = require('../documenti');
const drive = require('../google-drive');
const fiscale = require('../fiscale');
const maturato = require('../maturato');
const moduli = require('../moduli');
const paginaJs = require('../pagina-js');
const pianoUi = require('../piano-ui');
const proforma = require('../proforma');
const sedute = require('../sedute');
const statoUi = require('../stato-ui');
const tranche = require('../tranche');
const { AREA_COLOR, FONTE_LABEL, ORE_TIPO, PERMESSO_ORE_SESSIONE, PLATFORM_URL, STATO_CLIENTE, STRUMENTI, TOOL_LABEL, areaOptions, attr, baseStyle, composeAddress, esc, fmtOre, fonteOptions, headerNoesys, isProgrammata, itDate, itDateTime, jsModalePdf, jsStr, meseEsteso, modalePdf, oggiIso, prezzoPercorso, renderSedutaRow, renderSessionData, scegliPercorsoContratto, sezionePieghevole, socialOptions } = require('./comune');

function loginPage(error) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Accesso</title>${baseStyle()}</head><body>
    <div style="max-width:360px;margin:70px auto;background:#fff;padding:34px 30px;border-radius:16px;box-shadow:0 8px 32px rgba(16,33,60,0.08)">
      <div style="text-align:center;margin-bottom:20px">${logoCompact(48)}</div>
      <h1 style="text-align:center">Hub CRM</h1>
      <p style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:20px">Accesso coach</p>
      ${error ? `<div class="flash-error">${error}</div>` : ''}
      <form method="POST" action="/login">
        <div class="form-group"><label>Username</label><input name="username" required></div>
        <div class="form-group"><label>Password</label><input name="password" type="password" required></div>
        <button class="btn btn-primary" style="width:100%;margin-top:6px" type="submit">Entra</button>
      </form>
    </div>
  </body></html>`;
}

// `individuali` = la pagina è quella del mondo individuale (titolo e conteggio lo
// dicono); `tutti` = filtro scavalcato, si vedono anche i clienti dei progetti.
function dashboardPage(clients, req, { individuali = false, tutti = false } = {}) {
  const rows = clients.length === 0
    ? `<tr><td colspan="6" class="empty">Nessun cliente. Crea il primo con il pulsante qui sopra.</td></tr>`
    : clients.map(c => {
      const area = c.p_area || c.area || 'Personal';
      const ac = AREA_COLOR[area] || '#1A5280';
      const st = STATO_CLIENTE[c.stato_cliente] || STATO_CLIENTE.attivo;
      const recall = c.prossima_azione
        ? `${esc(c.prossima_azione)}${c.prossima_azione_data ? `<br><span style="font-size:11px;color:#aaa">${itDate(c.prossima_azione_data)}</span>` : ''}`
        : '<span style="color:#ccc">—</span>';
      const sess = Number(c.p_sess) || 0;
      const ore  = Number(c.p_ore) || 0;
      // Relazione conclusa ma percorso ancora aperto: si vede già dall'elenco,
      // senza dover entrare in ogni scheda per accorgersene.
      const daChiudere = c.stato_cliente === 'concluso' && c.p_stato === 'attivo';
      const percorso = c.p_tipo
        ? `${esc(c.p_tipo)} · ${sess} ${sess === 1 ? 'sessione' : 'sessioni'}${ore > 0 ? ` · ${fmtOre(ore)} h` : ''}${c.p_stato !== 'attivo' ? ` · <span style="color:#999">concluso</span>` : ''}${daChiudere ? `<br><span class="badge" style="background:#fff8dc;color:#7a5c00" title="La relazione è conclusa ma il percorso risulta ancora attivo">⚠ percorso da chiudere</span>` : ''}${c.p_progetto_titolo ? `<br><span class="badge" style="background:#e8f4fd;color:#1A5280">📁 ${esc(c.p_progetto_titolo)}</span>` : ''}`
        : '<span style="color:#ccc">—</span>';
      return `<tr onclick="location.href='/dashboard/clients/${c.id}'" style="cursor:pointer">
        <td><strong>${esc(c.name)}</strong> ${collaudo.badge(c.di_collaudo)}${c.email ? `<br><span style="color:#aaa;font-size:11px">${esc(c.email)}</span>` : ''}</td>
        <td><span class="badge" style="background:${ac}18;color:${ac}">${area}</span></td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td style="font-size:12px">${percorso}</td>
        <td style="font-size:12px">${recall}</td>
        <td style="white-space:nowrap" onclick="event.stopPropagation()">
          <a href="/dashboard/clients/${c.id}" class="btn btn-neutral btn-sm">Dettaglio</a>
          <button onclick="copyLink('${PLATFORM_URL}/c/${c.token}')" class="btn btn-neutral btn-sm">🔗</button>
        </td>
      </tr>`;
    }).join('');

  const titolo = individuali && !tutti ? 'Percorsi Individuali' : 'Clienti';
  const sotto = individuali && !tutti
    ? `${clients.length} ${clients.length === 1 ? 'cliente che segui una a una' : 'clienti che segui uno per uno'} · <a href="/dashboard/individuali?tutti=1" style="font-size:13px">vedi tutti i clienti, compresi quelli dentro i progetti</a>`
    : individuali
      ? `${clients.length} clienti in tutto, progetti compresi · <a href="/dashboard/individuali" style="font-size:13px">torna ai soli percorsi individuali</a>`
      : `${clients.length} clienti registrati`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — ${esc(titolo)}</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'individuali' })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1>${esc(titolo)}</h1><p style="color:#aaa;font-size:13px">${sotto}</p></div>
      <button onclick="openNewClient()" class="btn btn-primary">+ Nuovo cliente</button>
    </div>
    <input id="cerca" type="search" placeholder="🔍 Cerca cliente (nome, email, area…)" oninput="filtra()" style="margin-bottom:14px">
    <div class="card" style="padding:0;overflow-x:auto">
      <table>
        <thead><tr><th>Cliente</th><th>Area</th><th>Stato</th><th>Percorso</th><th>Prossima azione</th><th></th></tr></thead>
        <tbody id="lista-clienti">${rows}</tbody>
      </table>
      <div id="nessun-risultato" class="empty" style="display:none">Nessun cliente corrisponde alla ricerca.</div>
    </div>
  </div>

  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-box" style="width:440px">
      <h2 style="margin-bottom:16px">Nuovo cliente</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome</label><input id="new-nome" type="text" placeholder="es. Mario"></div>
        <div class="form-group"><label>Cognome *</label><input id="new-cognome" type="text" placeholder="es. Rossi"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Email</label><input id="new-email" type="email" placeholder="mario@esempio.it"></div>
        <div class="form-group"><label>Telefono</label><input id="new-tel" type="tel" placeholder="+39…"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label><select id="new-area">${areaOptions('Personal')}</select></div>
        <div class="form-group"><label>Come ti ha conosciuto</label><select id="new-fonte">${fonteOptions('altro')}</select></div>
      </div>
      <div class="form-group"><label>Società / azienda</label><input id="new-societa" type="text" placeholder="opzionale"></div>
      <div class="form-group"><label>Obiettivo / motivo</label><textarea id="new-obiettivo" placeholder="opzionale"></textarea></div>
      <div id="new-error" style="display:none" class="flash-error"></div>
      <div id="new-result" style="display:none;background:#e8f5e9;border-radius:6px;padding:12px;margin-bottom:12px;font-size:13px">
        <strong>Cliente creato!</strong><br>Link agli strumenti (da inviare al cliente):<br>
        <a id="new-link" href="#" target="_blank" style="color:#1A5280;word-break:break-all"></a>
        <button onclick="copyLinkEl()" class="btn btn-neutral btn-sm" style="margin-top:8px;width:100%">📋 Copia link</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="closeModal()" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="createClient()" id="btn-create" class="btn btn-primary" style="flex:1">Crea</button>
      </div>
    </div>
  </div>

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:200">Link copiato!</div>

  <script>
    ${statoUi.js()}
    const PLATFORM_URL = ${JSON.stringify(PLATFORM_URL)};
    function filtra() {
      const q = document.getElementById('cerca').value.trim().toLowerCase();
      let visibili = 0;
      document.querySelectorAll('#lista-clienti tr').forEach(tr => {
        const match = tr.textContent.toLowerCase().includes(q);
        tr.style.display = match ? '' : 'none';
        if (match) visibili++;
      });
      document.getElementById('nessun-risultato').style.display = visibili ? 'none' : 'block';
    }
    function openNewClient() {
      document.getElementById('modal-overlay').style.display = 'flex';
      document.getElementById('new-result').style.display = 'none';
      document.getElementById('new-error').style.display = 'none';
      ['new-nome','new-cognome','new-email','new-tel','new-societa','new-obiettivo'].forEach(id=>document.getElementById(id).value='');
      document.getElementById('btn-create').style.display = '';
      document.getElementById('new-nome').focus();
    }
    function closeModal() {
      document.getElementById('modal-overlay').style.display = 'none';
      if (document.getElementById('new-result').style.display !== 'none') location.reload();
    }
    async function createClient() {
      const nome    = document.getElementById('new-nome').value.trim();
      const cognome = document.getElementById('new-cognome').value.trim();
      const errEl = document.getElementById('new-error');
      if (!cognome) { errEl.textContent = 'Il cognome è obbligatorio'; errEl.style.display='block'; return; }
      errEl.style.display = 'none';
      const res = await fetch('/dashboard/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        nome, cognome, email: document.getElementById('new-email').value.trim(),
        telefono: document.getElementById('new-tel').value.trim(),
        area: document.getElementById('new-area').value,
        fonte: document.getElementById('new-fonte').value,
        societa: document.getElementById('new-societa').value.trim(),
        obiettivo: document.getElementById('new-obiettivo').value.trim(),
      }) });
      const data = await res.json();
      if (data.error) { errEl.textContent = data.error; errEl.style.display='block'; return; }
      const link = PLATFORM_URL + '/c/' + data.token;
      document.getElementById('new-link').href = link;
      document.getElementById('new-link').textContent = link;
      document.getElementById('new-result').style.display = 'block';
      document.getElementById('btn-create').style.display = 'none';
      if (data.driveOk === false) {
        const w = document.createElement('div');
        w.style.cssText = 'margin-top:10px;color:#b45309;font-size:12px';
        w.textContent = '⚠ Cliente creato, ma la cartella Drive non è stata creata. Aprilo e usa «🔄 Crea cartelle Drive».';
        document.getElementById('new-result').appendChild(w);
      }
    }
    ${paginaJs.toast()}
    function copyLinkEl() { navigator.clipboard.writeText(document.getElementById('new-link').href).then(showToast); }
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
  </script>
  </body></html>`;
}

// Pagina di verifica del collegamento a Google Drive (Fase 3a). Solo lettura.
function driveDiagPage(steps, root, children, req) {
  const allOk = steps.length > 0 && steps.every(s => s.ok);
  const stepRows = steps.map(s => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #f1f3f6">
      <span style="font-size:15px;line-height:1.4;color:${s.ok ? '#2e6b52' : '#c0392b'}">${s.ok ? '✓' : '✕'}</span>
      <span style="font-size:13px;line-height:1.5">${esc(s.txt)}</span>
    </div>`).join('');

  const childRows = (children || []).length
    ? children.map(f => `
        <div style="display:flex;align-items:center;gap:9px;padding:7px 0;font-size:13px">
          <span>${drive.isFolder(f) ? '📁' : '📄'}</span>
          <span>${esc(f.name)}</span>
        </div>`).join('')
    : '<div class="empty" style="padding:18px">Nessun elemento in cima alla cartella.</div>';

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Verifica Drive</title>${baseStyle()}</head><body>
  ${headerNoesys({ briciole: [{ label: 'Verifica Google Drive' }] })}
  <div class="container" style="max-width:640px">
    <h1>Verifica collegamento a Google Drive</h1>
    <p style="color:var(--muted);font-size:13px;margin-bottom:18px">Controllo di sola lettura: l'Hub prova a leggere il tuo Drive con le chiavi impostate su Railway. Non tocca né il database né le schede.</p>

    <div class="card" style="border-color:${allOk ? '#bfe0cf' : '#f3c9c4'};background:${allOk ? '#f2f9f5' : '#fdf5f4'}">
      <div style="font-weight:700;color:${allOk ? '#2e6b52' : '#c0392b'};margin-bottom:6px">
        ${allOk ? '✓ Collegamento riuscito' : '✕ Qualcosa non torna'}
      </div>
      ${stepRows}
    </div>

    ${root && (children || []).length ? `
    <div class="card">
      <h2>Cosa vede dentro «Noesys»</h2>
      ${childRows}
    </div>` : ''}

    <form method="post" action="/dashboard/diag/drive/test-create" style="margin:14px 0">
      <button type="submit" class="btn btn-neutral btn-sm">Prova a creare una cartella su Drive</button>
      <span style="font-size:12px;color:var(--hint);margin-left:8px">crea «Test-Automazione» dentro Noesys: è l'unica cosa che scrive, e si può cancellare</span>
    </form>

    ${allOk ? `
    <p style="color:var(--muted);font-size:13px">Tutto a posto: la Fase 1 è confermata. Il prossimo passo è la chiave Claude (Fase 2).</p>`
    : `<p style="color:var(--muted);font-size:13px">Segnalami cosa vedi qui sopra: dal messaggio d'errore capisco se è un valore incollato male su Railway (e quale) o altro.</p>`}
  </div>
  </body></html>`;
}

function clientDetailPage(client, sessions, percorsi, payments, sedute, progetti, permessi, req, fatt) {
  fatt = fatt || {};
  const proforme = fatt.proforme || [];
  const link = PLATFORM_URL + '/c/' + client.token;
  sedute = sedute || [];
  permessi = permessi || [];
  const area = client.area || 'Personal';
  const ac = AREA_COLOR[area] || '#1A5280';
  const st = STATO_CLIENTE[client.stato_cliente] || STATO_CLIENTE.attivo;
  const val = v => v ? esc(v) : '<span style="color:#ccc">—</span>';

  // ── Mail 1 di benvenuto (Fetta 1c): bozza + stato ────
  // Nome di battesimo per il saluto e per scegliere la lettera M/F di default.
  const mailNome = (client.nome && client.nome.trim()) || String(client.name || '').trim().split(/\s+/)[0] || '';
  const mail1Genere = documenti.genereFromNome(mailNome);
  const mail1Subject = 'Il tuo percorso di Coaching sta per iniziare';
  // Testo di default modificabile nel pannello (finalizzato da Germano, valido per i
  // percorsi individuali; i Progetti Strutturati avranno varianti). Neutro rispetto al
  // genere (la lettera allegata gestisce Caro/Cara), unica variabile il nome.
  const mail1Body =
`Ciao ${mailNome},

ti scrivo perché a breve inizieremo la prima fase del tuo percorso di Coaching.

Prima di tutto desidero ringraziarti per la fiducia che mi stai accordando: sono certo che, con l'impegno di entrambi, potremo ottenere ottimi risultati.

Per rendere la sessione più proficua e confortevole, ti chiederei di tenere a portata di mano dei fogli e una penna, nel caso possano servire.

In allegato a questa mail troverai i seguenti materiali:
• Lettera di benvenuto
• Scheda anagrafica
• Codice Etico di ICF

Se ne hai tempo e modo, ti chiederei di leggere la lettera, compilare l'anagrafica e rimandarmela a questo indirizzo.

Il Codice Etico di ICF è lo strumento utile qualora volessi avere rassicurazioni su ciò che è alla base del Coaching di ICF.

Per ora è tutto. Grazie ancora e a presto.
Germano`;
  const mail1SentTxt = client.mail1_inviata_data
    ? itDate(new Date(client.mail1_inviata_data).toISOString()) : '';

  // ── Mail 2 (Fetta 2): contratto + agenda, dopo l'Intake ──
  // ⚠️ 03/09 — L'INFORMATIVA È ENTRATA FRA GLI ALLEGATI, e il testo va con lei.
  //    Trovato GUARDANDO la finestrella, non leggendo il codice: avevo aggiunto
  //    il terzo allegato e lasciato una mail che ne annunciava due. Il cliente
  //    avrebbe ricevuto un documento di cui nessuno gli parlava — e per giunta
  //    proprio quello che gli spiega come tratto i suoi dati.
  // ⭐ Quando cambiano gli allegati cambia anche il testo che li elenca: sono
  //    due facce della stessa cosa, e vivono a 1.100 righe di distanza.
  const mail2Subject = 'Contratto, informativa privacy e Agenda di sessione';
  const mail2Body =
`Ciao ${mailNome},

come anticipato, ti invio i documenti per formalizzare e accompagnare il tuo percorso di Coaching. In allegato a questa mail trovi:
• il Contratto per Servizi di Coaching
• l'Informativa sul trattamento dei dati personali
• l'Agenda di sessione

Ti chiederei di leggere con attenzione il contratto e l'informativa, firmarli e rimandarmeli a questo stesso indirizzo.

L'Agenda è uno strumento prezioso per monitorare il tuo percorso: ti aiuta a mettere a fuoco gli impegni presi e a dare continuità al lavoro tra una sessione e l'altra. Ti chiederei di compilarla e inviarmela entro la sera prima del giorno della sessione successiva, così potrò arrivare preparato al nostro incontro.

Per qualsiasi cosa, rispondi pure a questa mail.

A presto,
Germano`;
  const mail2SentTxt = client.mail2_inviata_data
    ? itDate(new Date(client.mail2_inviata_data).toISOString()) : '';

  // ── Percorsi ────────────────────────────────────────
  // Stato della RELAZIONE (sul cliente) e stato del PERCORSO sono due cose diverse
  // e restano separate: una persona può finire un percorso e restare cliente. Ma
  // quando si contraddicono bisogna dirlo, altrimenti divergono in silenzio per
  // mesi (casi reali: Francesco Pilo e Rebecca Ros, conclusi con percorsi aperti).
  const attiviOra = percorsi.filter(p => p.stato === 'attivo');
  const avvisoStati = (client.stato_cliente === 'concluso' && attiviOra.length) ? `
      <div style="font-size:13px;background:#fff8ec;padding:10px 14px;border-radius:8px;border-left:3px solid var(--gold);margin-bottom:14px">
        La relazione con il cliente è <strong>conclusa</strong>, ma ${attiviOra.length === 1 ? 'un percorso risulta' : attiviOra.length + ' percorsi risultano'} ancora <strong>${attiviOra.length === 1 ? 'attivo' : 'attivi'}</strong>. Se ${attiviOra.length === 1 ? 'è finito' : 'sono finiti'}, ${attiviOra.length === 1 ? 'chiudilo' : 'chiudili'} qui sotto; se ${attiviOra.length === 1 ? 'prosegue' : 'proseguono'}, va bene così.
      </div>` : '';
  // ── Il prossimo appuntamento (12/08) ────────────────
  // Sta qui, sopra i percorsi, perché è la cosa che si guarda prima di una
  // sessione. E soprattutto: è l'UNICO punto da cui si può segnare un incontro
  // che dai report non arriverà mai — quello di una sessione saltata, che in
  // home non compare perché la sua data è già passata.
  // Una riga per percorso attivo, anche quando l'appuntamento non c'è: è
  // proprio quel vuoto che va visto.
  const oggiIso = dateIt.oggiRoma();
  const appHtml = (fatt.appuntamenti || []).map(a => {
    const passato = a.scad && String(a.scad) < oggiIso;
    const quando = !a.scad
      ? `<span style="color:var(--hint)">nessun appuntamento fissato</span>`
      : `<strong style="color:${passato ? 'var(--hint)' : 'var(--ink)'}">${itDate(a.scad)}${a.ora ? ` · ore ${esc(a.ora)}` : ''}</strong>${passato ? ` <span style="font-size:12px;color:#8a6d1e">— è già passato</span>` : ''}`;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef1f5;flex-wrap:wrap">
        <div style="font-size:14px">
          ${quando}
          <div style="font-size:11px;color:var(--hint)">${esc(a.percorso_tipo || 'Percorso')}${a.scad ? ` · ${a.fonte === 'mano' ? 'scritto da te' : 'dal report'}` : ''}</div>
        </div>
        <button onclick="apriApp('${a.percorso_id}','${a.scad || ''}',${jsStr(a.ora || '')})" class="btn btn-neutral btn-sm">
          ${a.scad ? 'Cambia' : 'Segna un appuntamento'}
        </button>
      </div>`;
  }).join('');
  // ── LE SEZIONI SI PIEGANO (Germano, 13/08) ──────────────────────────────────
  // «Tutte le schede tranne ANAGRAFICA dovrebbero essere espandibili come
  // PERCORSI». ⚠️ Chiesto cosa intendesse, perché Percorsi era l'unica che NON
  // si chiudeva: ha scelto la FRECCETTA sulla sezione (come Scheda Cliente e
  // Strumenti), non le righe che si aprono una per una.
  //
  // ⭐ E ha scelto come devono nascere: **aperte solo se hanno qualcosa in
  // sospeso**. Quindi ogni sezione porta la SUA domanda — non c'è un criterio
  // unico, perché «in sospeso» vuol dire una cosa diversa per ognuna — e la
  // domanda sta scritta accanto alla sezione che riguarda.
  //
  // ⚠️ I pulsanti che finiscono nel <summary> devono fermare il clic
  // (`event.stopPropagation()`), altrimenti premerli chiude la sezione invece
  // di fare quello che dicono.
  // ⚠️ L'ANAGRAFICA non si tocca: non è una sezione pieghevole e resta fissa in
  // cima, com'è oggi (e con dentro il riquadro «pronto per fatturare»).
  const sezione = sezionePieghevole;

  // In sospeso qui = c'è un percorso attivo SENZA appuntamento, o con uno già
  // passato (è proprio quel vuoto che va visto), oppure ce n'è uno entro una
  // settimana — quello che stai per fare davvero. Se sono tutti fissati e
  // lontani, la sezione riposa chiusa.
  const fra7giorni = new Date(Date.parse(oggiIso) + 7 * 86400000).toISOString().slice(0, 10);
  const appInSospeso = (fatt.appuntamenti || []).some(a =>
    !a.scad || String(a.scad) < oggiIso || String(a.scad) <= fra7giorni);
  const appuntamentoHtml = !(fatt.appuntamenti || []).length ? '' :
    sezione('<h2 style="margin:0">Prossimo appuntamento</h2>', appHtml, appInSospeso);

  // In sospeso qui = c'è un percorso ATTIVO, cioè un lavoro in corso. Un cliente
  // con soli percorsi conclusi apre la scheda senza doverli scorrere.
  const percorsiInSospeso = percorsi.some(p => p.stato === 'attivo');
  const percorsiHtml = sezione(
    `<h2 style="margin:0">Percorsi <span style="font-weight:400;font-size:13px;color:#aaa">(${percorsi.length})</span></h2>`,
    `${avvisoStati}
      ${percorsi.length === 0 ? `<div class="empty">Nessun percorso registrato.</div>` : `
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Tipo</th><th>Lavoro svolto</th><th>Modalità</th><th>Prezzo</th><th>Periodo</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          ${percorsi.map(p => { const condiviso = !p.client_id;
            // Un percorso finisce il giorno della sua ULTIMA SESSIONE CONFERMATA,
            // non il giorno in cui ti ricordi di chiuderlo: la data si propone da lì.
            const ultima = sedute
              .filter(s => s.percorso_id === p.id && s.stato === 'confermata' && s.data)
              .map(s => new Date(s.data)).sort((a, b) => b - a)[0];
            const fineIso = ultima ? ultima.toISOString().slice(0, 10) : '';
            const fineIt  = ultima ? itDate(ultima.toISOString()) : '';
            return `<tr>
            <td><strong>${esc(p.tipo)}</strong>${condiviso ? ` <span class="badge" style="background:#eef1f5;color:#4a5568" title="Percorso di gruppo: gestito sulla pagina del progetto">condiviso</span>` : ''}${p.progetto_titolo ? `<br><a href="/dashboard/progetti/${p.progetto_id}" class="badge" style="background:#e8f4fd;color:#1A5280;text-decoration:none">📁 ${esc(p.progetto_titolo)}</a>` : ''}</td>
            <td style="white-space:nowrap">
              <span style="font-size:13px;font-weight:700;color:var(--blue)">${p.n_sessioni_fatte}</span>
              <span style="font-size:11px;color:#aaa"> ${p.n_sessioni_fatte === 1 ? 'sessione' : 'sessioni'}</span>
              <span style="color:#dfe3e8"> · </span>
              <span style="font-weight:700;color:var(--green)">${fmtOre(p.ore_fatte)}</span> <span style="font-size:11px;color:#aaa">h</span>
              ${Number(p.ore_storiche) > 0 ? `<div style="font-size:11px;color:#aaa;margin-top:4px">di cui ${fmtOre(p.ore_storiche)} h prima dell'automazione</div>` : ''}
            </td>
            <td>${p.modalita==='Scambio servizi' ? `<span class="badge" style="background:#e8f4fd;color:#1A5280">Scambio servizi</span>` : p.modalita==='Pro bono' ? `<span class="badge badge-pausa">Pro bono</span>` : p.modalita==='Pacchetto' ? `<span class="badge" style="background:#eaf5ee;color:#2f6b46">Pacchetto</span>` : `<span style="font-size:12px;color:#4a5568">Standard</span>`}</td>
            <td>${prezzoPercorso(p)}${p.promo ? `<br><span class="badge badge-pausa">Promo</span>${p.sconto_note ? ` <span style="font-size:11px;color:#aaa">${esc(p.sconto_note)}</span>` : ''}` : ''}</td>
            <td style="font-size:12px;color:#aaa">${p.data_inizio ? itDate(p.data_inizio) : '—'}${p.data_fine ? `<br>→ ${itDate(p.data_fine)}` : ''}</td>
            <td><span class="badge ${p.stato==='attivo'?'badge-active':'badge-inactive'}">${p.stato==='attivo'?'Attivo':'Concluso'}</span></td>
            <td style="white-space:nowrap;text-align:right">${condiviso
              ? `<a href="/dashboard/progetti/${p.progetto_id}" class="btn btn-neutral btn-sm">Gestisci nel progetto</a>`
              : `<button onclick="editPercorso('${p.id}')" class="btn btn-neutral btn-sm" title="Correggi modalità, prezzo, sessioni previste">Modifica</button> ${p.stato==='attivo' ? `<button onclick="chiudiPercorso('${p.id}','${fineIso}','${fineIt}')" class="btn btn-neutral btn-sm">Chiudi il percorso</button>` : ''}<span style="display:inline-block;width:14px"></span><button onclick="delPercorso('${p.id}')" class="btn btn-danger btn-sm" title="Elimina il percorso">🗑</button>`}</td>
          </tr>`; }).join('')}
        </tbody>
      </table></div>`}`,
    percorsiInSospeso,
    `<button onclick="event.stopPropagation();openPercorso()" class="btn btn-primary btn-sm">+ Nuovo percorso</button>`);

  // ── Scheda Cliente (una riga per sessione: la tabella storica di Cowork) ──
  const seduteBody = percorsi.length === 0
    ? `<div class="empty">Crea prima un percorso per registrare le sessioni.</div>`
    : sedute.length === 0
      ? `<div class="empty">Nessuna sessione. Le sessioni nascono dai report: salva il report su Drive e premi "⟳ Cerca nuovi report".</div>`
      : `<div style="overflow-x:auto">
          <table class="scheda-cliente">
            <thead><tr><th>Data</th><th>Sessione</th><th>Obiettivo</th><th>Argomenti trattati</th><th>Attività concordate</th><th>Scadenza</th><th>Eseg.</th><th>Note</th><th></th></tr></thead>
            <tbody>${sedute.map(renderSedutaRow).join('')}</tbody>
          </table>
        </div>`;
  // Ore nel titolo della Scheda: contano solo le sessioni CONFERMATE, come
  // ovunque nell'Hub (le bozze non valgono per le ore ICF finché non le approvi).
  const oreConfermate = sedute.reduce((s, x) =>
    s + (x.stato === 'confermata' ? (Number(x.ore) || 0) : 0), 0);
  // In sospeso qui = ci sono sessioni in BOZZA da approvare. Prima nasceva
  // sempre aperta; dal 13/08 vale lo stesso criterio di tutte le altre.
  const bozzeDaApprovare = sedute.some(s => s.stato === 'bozza' && !isProgrammata(s));
  const seduteHtml = `
    <div class="card">
      <details class="sec"${bozzeDaApprovare ? ' open' : ''}>
        <summary style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer">
          <span style="display:flex;align-items:center;gap:8px"><span class="sec-caret">▸</span><h2 style="margin:0">Scheda Cliente <span style="font-weight:400;font-size:13px;color:#aaa">(${sedute.length} ${sedute.length === 1 ? 'sessione' : 'sessioni'}${oreConfermate > 0 ? ` · ${fmtOre(oreConfermate)} h` : ''})</span></h2></span>
          <span style="display:inline-flex;gap:8px;align-items:center">
            ${client.drive_url ? `<button id="scan-btn" onclick="event.stopPropagation();scanDrive()" class="btn btn-gold btn-sm" title="Legge i report Word nuovi dalla cartella Drive e ne aggiunge la riga in bozza">⟳ Cerca nuovi report</button>` : ''}
          </span>
        </summary>
        <div style="margin-top:14px">${seduteBody}</div>
      </details>
    </div>`;

  // ── Amministrazione — FETTA C2 (15/08/2026) ──────────────────────────
  // Germano: «continua a essere caotica… sei sicuro che sia pensata
  // correttamente? non mi voglio trovare a rifare le cose mille volte».
  // Aveva ragione: qui dentro c'erano TRE MODI DIVERSI DI DIRE SOLDI, nati in
  // momenti diversi e mai messi d'accordo — il maturato dei percorsi a sessione,
  // un riflesso delle quote di progetto che leggeva un interruttore ormai morto,
  // e la vecchia tabella dei pagamenti scritti a mano.
  // ⭐ LA MOSSA NON È FONDERLI IN UNA TABELLA SOLA: i soldi arrivano davvero da
  // posti diversi, e nasconderlo non aiuterebbe nessuno. È fargli parlare LA
  // STESSA LINGUA — le stesse parole e gli stessi quattro numeri (Concordato ·
  // Da chiedere · Chiesto · Incassato) — e togliere l'unica fonte che mentiva.
  //
  // ⚠️ La tabella `payments` NON si tocca: guardando i dati veri il 15/08 sono 7
  // righe, tutte «scambio servizi» a 0,00 €, l'ultima del 10/08. È in USO — serve
  // a segnare che uno scambio servizi è saldato — e lo scambio servizi è per
  // decisione di Germano fuori da questo cantiere. L'avevo dato per morto nel
  // piano: era un'assunzione mia, smentita dai dati.
  const trPart = fatt.tranchePartecipazioni || [];
  // Solo l'atteso: serve a decidere se la sezione nasce aperta. L'incassato di
  // qui non si somma più con niente (sono registrazioni fuori dal conto), e
  // tenerlo come variabile orfana è il modo migliore per ritrovarselo sommato
  // per sbaglio fra sei mesi.
  const payAtteso = payments.filter(p=>p.stato==='atteso').reduce((s,p)=>s+Number(p.importo),0);

  // ── Maturato ─────────────────────────────────────────
  // Con la modalità Standard si paga OGNI SESSIONE, quindi quello che hai maturato
  // è una moltiplicazione — sessioni confermate × prezzo di una sessione — non un
  // dato da salvare. Tenerlo come calcolo vuol dire che correggere o cancellare una
  // sessione aggiorna tutto da solo, senza righe rimaste indietro a mentire (stessa
  // regola della "una sola verità" già applicata alle quote dei progetti).
  // Diventerà una riga con l'importo congelato solo quando si chiuderà il mese per
  // fatturare: da lì in poi il numero non deve più cambiare.
  // Contano solo le sedute CONFERMATE: una bozza nata da un report non è ancora
  // un fatto finché il coach non l'ha approvata.
  // La seduta di Intake VALE DUE SESSIONI (Germano, 10/08/2026): dura il doppio e
  // si paga il doppio. Vale solo qui, nel pagamento a sessione: in un Pacchetto il
  // prezzo è già un totale e non si moltiplica niente.
  // ⭐ Dalla Fase 3 il maturato è quello NON ANCORA CHIESTO: una sessione finita
  // in una proforma viva ha smesso di essere «da chiedere» ed esce di qui. È la
  // stessa regola che impedisce di chiedere due volte la stessa sessione, e non
  // ha bisogno di nessuna casella da spuntare: la verità è la riga di proforma.
  // ⭐ Dalla Tappa 3 il conto NON si fa più qui dentro: lo fa `maturato.js`, che
  // è l'unico posto dove sta scritto che cosa vuol dire «da chiedere». Prima era
  // ricopiato in questa pagina; ricopiarlo anche in home e in Amministrazione
  // avrebbe voluto dire tre copie della stessa regola, libere di divergere.
  const mat = fatt.maturato || { totale: 0, nSessioni: 0, mesi: [], bozze: [], nBozze: 0 };
  const maturatoTot = mat.totale;

  // Perché NON si può chiedere il pagamento. Le ragioni sono le stesse che usa
  // la rotta quando crea il documento (stesso modulo), così non può succedere
  // che il pulsante prometta una cosa e il server ne faccia un'altra.
  const motiviBlocco = !mat.nSessioni ? [] : proforma.motiviCheImpediscono({
    emittente: fatt.emittente || {}, soggetto: fiscale.daCliente(client),
    righe: new Array(mat.nSessioni),
  });
  const azioneMaturato = !mat.nSessioni ? '' : (motiviBlocco.length ? `
        <div style="background:#fffdf6;border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;margin-top:10px">
          <div style="font-size:13px;font-weight:700;margin-bottom:5px">Non si può ancora chiedere il pagamento</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#4A4A4A">
            ${motiviBlocco.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
          </ul>
        </div>` : `
        <div style="margin-top:10px">
          <button onclick="chiediPagamento()" id="pf-btn" class="btn btn-primary btn-sm">
            Chiedi il pagamento — € ${fiscale.euro(maturatoTot)}
          </button>
          <div id="pf-error" style="display:none;margin-top:10px" class="flash-error"></div>
        </div>`);

  const avvisoBozze = mat.nBozze ? `
        <div style="font-size:12px;color:#8a6d1e;background:#fdf6e3;border-radius:8px;padding:9px 12px;margin-top:10px">
          ⚠️ ${mat.nBozze === 1 ? 'C’è 1 sessione in bozza' : `Ci sono ${mat.nBozze} sessioni in bozza`}:
          finché non ${mat.nBozze === 1 ? 'la approvi' : 'le approvi'} non ${mat.nBozze === 1 ? 'entra' : 'entrano'} nella proforma.
        </div>` : '';

  // ⭐ DUE RIGHE, non l'elenco (decisione di Germano del 12/08, punto 9c). Qui
  // serve sapere a colpo d'occhio, prima di una sessione, se quella persona ha
  // qualcosa in sospeso: quanto c'è da chiedere, e com'è finita l'ultima volta.
  // L'elenco completo, e i passaggi da fare, stanno in Amministrazione → Proforma.
  const STATO_PF = {
    emessa:    { label: 'Da mandare', bg: '#fff8dc', c: '#7a5c00' },
    inviata:   { label: 'Mandata',    bg: '#e8f4fd', c: '#1A5280' },
    annullata: { label: 'Annullata',  bg: '#f1f3f6', c: '#8a8a8a' },
  };
  const rigaDue = (etichetta, dentro) => `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef1f5;flex-wrap:wrap">
        <div class="field-label" style="margin:0;flex:none">${etichetta}</div>
        <div style="text-align:right;flex:1;min-width:200px">${dentro}</div>
      </div>`;

  const mesiTxt = mat.mesi.map(m =>
    `${meseEsteso(m.mese)} · ${m.n} ${m.n === 1 ? 'sessione' : 'sessioni'}`).join(' — ');

  const rigaDaChiedere = rigaDue('Da chiedere', mat.nSessioni ? `
      <strong style="font-size:16px">€ ${fiscale.euro(maturatoTot)}</strong>
      <div style="font-size:12px;color:var(--hint);text-transform:capitalize">${mesiTxt}</div>`
    : `<span style="font-size:13px;color:var(--hint)">niente in sospeso</span>`);

  const ultima = proforme[0];              // già ordinate dalla più recente
  const stU = ultima ? (STATO_PF[ultima.stato] || STATO_PF.emessa) : null;
  const rigaUltima = !ultima ? '' : rigaDue('Ultima proforma', `
      <a href="#" onclick="apriPdf('${ultima.id}',${jsStr('Proforma n. ' + ultima.numero)});return false" style="font-weight:700;color:var(--blue);text-decoration:none">n. ${esc(ultima.numero)}</a>
      <span style="font-size:13px;color:var(--muted);margin-left:8px">${ultima.data_emissione ? itDate(ultima.data_emissione) : ''}</span>
      <span style="font-size:13px;margin-left:8px">€ ${fiscale.euro(ultima.da_pagare)}</span>
      <span class="badge" style="background:${stU.bg};color:${stU.c};margin-left:8px">${stU.label}</span>
      ${proforme.length > 1 ? `<div style="font-size:12px;color:var(--hint)">altre ${proforme.length - 1} ${proforme.length - 1 === 1 ? 'proforma' : 'proforma'} prima di questa</div>` : ''}`);

  const maturatoBlock = (!mat.nSessioni && !mat.nBozze && !proforme.length) ? '' : `
      <div style="margin-bottom:18px">
        ${rigaDaChiedere}
        ${rigaUltima}
        ${avvisoBozze}
        ${azioneMaturato}
        <div style="margin-top:12px">
          <a href="/dashboard/amministrazione/proforma" style="font-size:12px;color:var(--blue);text-decoration:none">Vai all'Amministrazione →</a>
        </div>
      </div>`;

  // ── I PERCORSI A PACCHETTO — fetta C (15/08/2026) ────────────────────
  // In un pacchetto la cifra è concordata all'inizio: non matura sessione per
  // sessione, si paga a rate. Germano: «il pacchetto segue la logica del
  // committente, con percentuali variabili» → stessa tabella di rate, stessa
  // finestrella, stessi quattro numeri del progetto. Una sola idea di «rata».
  // ⚠️ Fino a oggi un percorso a Pacchetto usciva da tutto IN SILENZIO
  // (`maturato.js` conta solo `modalita = 'Standard'`): non era un guasto, era
  // un pezzo di modello che non era mai stato costruito.
  const trPerc = fatt.tranchePercorsi || [];
  // ⭐ C3 — l'insieme delle rate gia dentro una proforma viva. Da qui esce lo
  // stato «Chiesta» e la sparizione del pulsante: nessuna casella da spuntare.
  const rateChieste = fatt.rateChieste || new Map();
  const pacchetti = percorsi
    .filter(pc => pc.modalita === 'Pacchetto' && pc.client_id === client.id)
    .map(pc => {
      const quota   = pc.prezzo != null ? Math.round(Number(pc.prezzo)) : 0;
      const salvate = trPerc.filter(t => t.percorso_id === pc.id);
      return {
        id: pc.id,
        titolo: `${pc.tipo || 'Percorso'}${pc.data_inizio ? ' · dal ' + itDate(pc.data_inizio) : ''}`,
        quota, salvate,
        data_inizio: pc.data_inizio ? String(pc.data_inizio).slice(0, 10) : '',
        data_meta:   pc.data_meta   ? String(pc.data_meta).slice(0, 10)   : '',
        data_fine:   pc.data_fine   ? String(pc.data_fine).slice(0, 10)   : '',
        righe: pianoUi.righeDi(salvate, quota, 'committente', rateChieste),
        tot4:  tranche.totali(salvate, quota, rateChieste),
        // La scadenza si calcola qui, col modulo puro: le tre date stanno sul
        // percorso, e «metà percorso» può ancora non esserci — che è
        // un'informazione, non un errore.
        scadenze: salvate.map(t => tranche.scadenza(t, pc)),
      };
    });

  // ⭐ La tabella delle rate è UNA SOLA, per il pacchetto e per la quota di un
  // progetto: sono la stessa cosa, e Germano l'ha detto — «una quota di un
  // progetto costa come o più di un pacchetto». Scriverla due volte avrebbe
  // rimesso in piedi il difetto che abbiamo appena tolto.
  const tabellaRate = (salvate, quota, scadenze) => {
    const righeSalvate = salvate.map((t, i) => {
      const stato = tranche.statoDi(t, rateChieste);
      const st   = tranche.STATI[stato] || tranche.STATI.da_chiedere;
      const imp  = Math.round(Number(t.importo));
      const perc = quota ? Math.round(imp / quota * 100) : null;
      const scad = scadenze[i];
      // ⭐ C4 — l'incasso si registra sul DOCUMENTO che contiene la rata, non
      // sulla rata. Stessa scelta e stesse parole della tabella condivisa in
      // piano-ui.js: le due tabelle mostrano la stessa cosa.
      const doc = rateChieste.get(t.id) || {};
      const dataInc = doc.ultimoIncasso || t.data_incasso;
      const comando = (stato === 'da_chiedere')
        ? `<button onclick="chiediRata('${t.id}',${jsStr(t.etichetta + ', \u20ac ' + fiscale.euroIntero(imp))})" class="btn btn-primary btn-sm">Chiedi il pagamento</button>`
        : (stato === 'da_mandare')
        ? `<a href="/dashboard/amministrazione/proforma" class="btn btn-primary btn-sm">Rileggi e manda</a>`
        : (stato === 'incassata')
        ? `<span style="font-size:11.5px;color:var(--hint)">${dataInc ? 'il ' + itDate(dataInc) : ''}</span>
           ${doc.proformaId
             ? `<a href="/dashboard/amministrazione/proforma" style="font-size:11.5px;color:var(--muted)">n. ${esc(doc.numero)}</a>`
             : `<button onclick="segnaStato('${t.id}','da_chiedere')" class="btn btn-neutral btn-sm" title="Torna indietro">Annulla</button>`}`
        : doc.proformaId
        ? `<button onclick="apriIncasso('${doc.proformaId}',${jsStr(t.etichetta)},${Number(doc.residuo) || 0})" class="btn btn-neutral btn-sm">È arrivato</button>`
        : '';
      return `<tr>
          <td>${esc(t.etichetta)}${perc !== null ? ` <span style="font-size:11px;color:var(--hint)">${perc}%</span>` : ''}</td>
          <td style="white-space:nowrap">€ ${fiscale.euroIntero(imp)}</td>
          <td style="font-size:12px;white-space:nowrap;color:${scad ? 'var(--ink)' : 'var(--hint)'}">${scad ? itDate(scad) : '—'}</td>
          <td style="white-space:nowrap"><span class="badge" style="background:${st.bg};color:${st.c}">${st.label}</span></td>
          <td style="text-align:right;white-space:nowrap">${comando}</td>
        </tr>`;
    }).join('');
    return !salvate.length ? '' : `<div style="overflow-x:auto;margin-top:10px"><table style="min-width:460px">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Rata</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Importo</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">Scade il</th>
            <th style="text-align:left;font-size:11px;color:var(--muted)">A che punto</th>
            <th></th>
          </tr></thead>
          <tbody>${righeSalvate}</tbody>
        </table></div>`;
  };

  const pacchettoBlock = pc => {
    // Una scheda non deve dire «pronto» senza dire cosa fare: se il piano non
    // c'è, qui c'è scritto che manca e il pulsante per farlo è a fianco.
    const vuoto = !pc.quota
      ? `<div style="font-size:12.5px;color:#b45309;padding:8px 0">Questo pacchetto non ha ancora un prezzo: scrivilo nel piano.</div>`
      : `<div style="font-size:12.5px;color:#b45309;padding:8px 0">Il piano delle rate non è ancora impostato — apri «Modifica il piano».</div>`;
    return `
      <div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div>
            <strong style="font-size:14px">Pacchetto</strong>
            <span style="font-size:12px;color:var(--hint);margin-left:6px">${esc(pc.titolo)}</span>
          </div>
          <button onclick="apriPianoPacchetto('${pc.id}')" class="btn btn-primary btn-sm">Modifica il piano</button>
        </div>
        ${pianoUi.quattroNumeri(pc.tot4, pc.salvate.length > 0)}
        ${pc.salvate.length ? tabellaRate(pc.salvate, pc.quota, pc.scadenze) : vuoto}
      </div>`;
  };
  const pacchettiHtml = pacchetti.length ? `
      <div style="margin-bottom:18px">
        <div class="field-label" style="margin-bottom:6px">Percorsi a pacchetto</div>
        ${pacchetti.map(pacchettoBlock).join('')}
      </div>` : '';

  // ── La quota che questa persona paga dentro un progetto ──────────────
  // ⭐ Adesso viene dalle RATE, come sulla pagina del progetto: le stesse
  // parole, gli stessi quattro numeri. Prima c'era un'etichetta
  // «Incassato / Da incassare» che parlava dell'INTERA quota e nasceva da un
  // interruttore che nessuno aggiorna più.
  // ⚠️ Resta di SOLA LETTURA e manda al progetto: il piano di un progetto si
  // tocca nella pagina del progetto, e avere due posti dove si scrive la stessa
  // cosa è il difetto che stiamo togliendo, non uno da aggiungere.
  // 🔴 15/08 — Germano: «gli importi dei clienti dei progetti andrebbero gestiti
  // come i pacchetti dei percorsi singoli… in pratica diventa uguale a quello del
  // progetto». È già vero nel modello (la quota di un partecipante è fatta di
  // rate dal 12/08): mancava solo la PORTA. Adesso il piano si apre anche da qui,
  // con la STESSA finestrella, e si tocca solo il piano di questa persona.
  const progettiConto = progetti.map(pr => {
    const q       = pr.quota_coachee != null ? Math.round(Number(pr.quota_coachee)) : 0;
    const salvate = trPart.filter(t => t.partecipazione_id === pr.part_id);
    return { pr, q, salvate,
      tot4: tranche.totali(salvate, q, rateChieste),
      // Le date degli inneschi stanno sul PROGETTO: la scadenza si calcola da
      // quelle, ed è per questo che la finestrella le mostra spente invece di
      // nasconderle.
      scadenze: salvate.map(t => tranche.scadenza(t, pr)) };
  });
  const progettiRows = progettiConto.map(({ pr, q, salvate, tot4, scadenze }) => `
      <div style="padding:12px 0;border-top:1px solid #eef1f5">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
          <div>
            <strong style="font-size:14px">${esc(pr.titolo)}</strong>
            <div style="font-size:12px;color:#aaa">Committente: ${esc(pr.committente_nome)}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${q ? `<button onclick="apriPianoPartecipazione('${pr.part_id}')" class="btn btn-primary btn-sm">Modifica il piano</button>` : ''}
            <a href="/dashboard/progetti/${pr.progetto_id}" class="btn btn-neutral btn-sm">Vai al progetto</a>
          </div>
        </div>
        ${!q
          ? `<div style="font-size:12.5px;color:#b45309">Quota da definire — si scrive nel progetto.</div>`
          : pianoUi.quattroNumeri(tot4, salvate.length > 0)}
        ${q && !salvate.length
          ? `<div style="font-size:12.5px;color:#b45309;margin-top:6px">Il piano delle rate non è ancora impostato — apri «Modifica il piano».</div>`
          : tabellaRate(salvate, q, scadenze)}
      </div>`).join('');
  const progettiBlock = progetti.length ? `
      <div style="margin-bottom:${payments.length ? '18px' : '0'}">
        <div class="field-label" style="margin-bottom:2px">Quote nei progetti</div>
        ${progettiRows}
      </div>` : '';
  // La finestrella del piano serve se c'è almeno una cifra concordata da dividere
  // in rate: un pacchetto, o una quota dentro un progetto.
  const pianoAttivo = pacchetti.length > 0 || progettiConto.some(g => g.q > 0);
  const paymentsTable = payments.length ? `
      ${/* ⚠️ NON è un doppione degli altri blocchi: è il registro dei pagamenti
            scritti a mano, e oggi serve **solo** allo scambio servizi (7 righe
            in produzione al 15/08, tutte a 0,00 €). Lo scambio servizi sta
            fuori dal cantiere dei soldi per decisione di Germano, quindi questi
            importi restano fuori dai tre numeri in cima. */ ''}
      <div class="field-label" style="margin-bottom:2px">Registrazioni di prima</div>
      <div style="font-size:11.5px;color:var(--hint);margin-bottom:6px">
        Storico in sola lettura: da qui non se ne aggiungono più. Sono i pagamenti segnati a mano
        prima che ogni cifra concordata avesse le sue rate — quasi tutti scambi di servizi.
        Restano fuori dal conto qui sopra.</div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Importo</th><th>Tipo</th><th>Data</th><th>Stato</th><th>Note</th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr>
            <td><strong>€ ${fiscale.euro(p.importo)}</strong></td>
            <td style="font-size:12px">${esc(p.tipo)}</td>
            <td style="font-size:12px;color:#aaa">${p.data_pagamento ? itDate(p.data_pagamento) : '—'}</td>
            <td>${p.stato==='ricevuto' ? `<span class="badge badge-active">Incassato</span>` : `<span class="badge badge-inactive">Da incassare</span>`}</td>
            <td style="font-size:12px;color:#aaa">${esc(p.note||'')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '';
  // In sospeso qui = ci sono SOLDI CHE ASPETTANO: qualcosa di maturato da
  // chiedere, una proforma creata e non ancora spedita, o un pagamento atteso.
  // ⚠️ Chi è «da mandare» lo dice `proforma.daMandare`, come in home e nella
  // pagina Proforma: la stessa domanda non si scrive tre volte.
  // I tre numeri del riepilogo restano nel titolo, quindi si leggono anche a
  // sezione chiusa: è l'informazione, non l'azione.
  // Un pacchetto è «in sospeso» quando c'è una rata ancora da chiedere o già
  // chiesta e non arrivata — e anche quando il piano non c'è proprio: quel
  // vuoto è la cosa da vedere per prima.
  const pacchettoInSospeso = pacchetti.some(pc =>
    !pc.salvate.length || pc.tot4.daChiedere > 0 || pc.tot4.chiesto > 0);
  const progettoInSospeso = progettiConto.some(g =>
    g.q > 0 && (!g.salvate.length || g.tot4.daChiedere > 0 || g.tot4.chiesto > 0));
  const soldiInSospeso = maturatoTot > 0 || payAtteso > 0 || proforme.some(proforma.daMandare)
    || pacchettoInSospeso || progettoInSospeso;

  // ⭐ I TRE NUMERI IN CIMA, uguali per chiunque: da chiedere · chiesto ·
  // incassato. «Concordato» non sale quassù di proposito — per un percorso a
  // sessione non esiste una cifra concordata, matura settimana per settimana, e
  // un totale che vale per due casi su tre sarebbe un numero da interpretare.
  // Sta dentro ogni blocco, dove vuol dire qualcosa.
  // ⚠️ Si sommano SOLO cifre della stessa natura: imponibili (il maturato e le
  // rate). Le proforma NON entrano qui: i loro totali contengono l'IVA, e
  // sommarli alle rate darebbe un numero che non è né l'uno né l'altro.
  // «Chiesto» resta a zero finché non arriva C3 — è la proforma di una rata ad
  // accenderlo, ed è giusto che si veda che oggi non c'è.
  const sommaStato = (chiave) =>
    pacchetti.reduce((s, pc) => s + pc.tot4[chiave], 0)
    + progettiConto.reduce((s, g) => s + g.tot4[chiave], 0);
  const totDaChiedere = maturatoTot + sommaStato('daChiedere');
  const totChiesto    = sommaStato('chiesto');
  const totIncassato  = sommaStato('incassato');
  const numeroTitolo = (etichetta, valore, colore) => valore <= 0 ? '' :
    ` · ${etichetta}: <strong style="color:${colore}">€ ${fiscale.euro(valore)}</strong>`;
  // ⭐ Fetta 3.4 (04/09, decisione (a) di Germano): il riquadro si chiama per ciò
  //    che contiene — i PAGAMENTI di questa persona. «Amministrazione» resta il
  //    nome dell'area in alto, quella di tutti i clienti, e di nessun riquadro.
  const paymentsHtml = sezione(
    `<h2 style="margin:0">Pagamenti
      <span style="font-size:12px;font-weight:400;color:#aaa;margin-left:10px">
        Da chiedere: <strong style="color:#1A5280">€ ${fiscale.euro(totDaChiedere)}</strong>
        ${numeroTitolo('Chiesto', totChiesto, '#D8AE2E')}
        ${numeroTitolo('Incassato', totIncassato, '#4F8B73')}
      </span>
    </h2>`,
    `${maturatoBlock}
      ${pacchettiHtml}
      ${progettiBlock}
      ${paymentsTable}`,
    soldiInSospeso,
    // ⛔ 15/08 — VIA il pulsante «+ Pagamento». Germano: «qui non dovrebbe
    // servire», e ha ragione: da quando ogni cifra concordata ha le sue rate
    // (pacchetto e quota di progetto), non resta niente di vero da scrivere a
    // mano. Le righe già segnate restano, in sola lettura: sono quasi tutti
    // scambi di servizi, che stanno fuori da questo cantiere finché non ne
    // parlerà col commercialista. Cancellarle sarebbe stato buttare via il suo
    // storico per fare ordine.
    '');

  // ── Strumenti utilizzati — sezione a fisarmonica ─────
  // Nomi e icone IDENTICI a quelli che il cliente vede in Coaching-Tools: uno
  // strumento si chiama allo stesso modo nelle due app. Mancavano i quattro più
  // recenti (le due ruote, SWOT, Covey/Eisenhower): comparivano col nome tecnico.
  // Le etichette vengono da STRUMENTI (in cima al file), la stessa lista che
  // riempie la tendina dei permessi: così non possono divergere.
  const strumentiItems = sessions.length === 0
    ? `<div class="empty">Nessuno strumento compilato dal cliente.</div>`
    : sessions.map(s => `
      <details class="acc">
        <summary>
          <span class="sec-caret">▸</span>
          <span style="font-weight:700;color:var(--ink)">${TOOL_LABEL[s.tool] || esc(s.tool)}</span>
          <span style="color:#aaa;font-size:12px">· ${itDateTime(s.created_at)}</span>
          <span style="margin-left:auto;font-size:11px;color:#aaa">agg. ${itDateTime(s.updated_at)}</span>
        </summary>
        <div class="acc-body" style="line-height:1.7">${renderSessionData(s.tool, s.data)}</div>
      </details>`).join('');
  const strumentiHtml = `
    <div class="card">
      <details class="sec">
        <summary style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <span class="sec-caret">▸</span><h2 style="margin:0">Strumenti utilizzati <span style="font-weight:400;font-size:13px;color:#aaa">(${sessions.length})</span></h2>
        </summary>
        <div style="margin-top:14px">${strumentiItems}</div>
      </details>
    </div>`;

  // ── Recall / prossima azione (evidenziata se presente) ──
  const recallHtml = client.prossima_azione ? `
    <div style="margin-top:12px;font-size:13px;background:#fff8ec;padding:10px 14px;border-radius:8px;border-left:3px solid var(--gold)">
      <strong>Prossima azione:</strong> ${esc(client.prossima_azione)}
      ${client.prossima_azione_data ? ` — <span style="color:#7a5c00">${itDate(client.prossima_azione_data)}</span>` : ''}
    </div>` : '';

  // ── Azioni e collegamenti (la zona in fondo alla scheda anagrafica) ──
  // Una zona SOLA per tutti i link e tutti i pulsanti, divisi per funzione.
  // Ogni cosa compare UNA volta, col suo stato accanto: prima la cartella Drive,
  // il link d'accesso e le date delle mail stavano sia tra i dati sia sui
  // pulsanti (Germano 27/07: "raggruppa tutti i link e i pulsanti, fai in modo
  // che non ci siano duplicazioni"). Solo forma: le funzioni sono quelle di ieri.
  // ── Permessi a termine sugli strumenti (2026-07-31) ────
  // La data della prossima sessione NON si chiede al coach: sta già nel database,
  // scritta dai report (`sedute.scadenza`), la stessa che alimenta il reminder in
  // home. Qui si prende, del cliente, la seduta confermata più recente che porti
  // una data vera; se non è passata, è la scadenza da proporre per il compito.
  const prossimaSess = sedute
    .filter(s => s.stato === 'confermata' && /^\d{4}-\d{2}-\d{2}$/.test(String(s.scadenza || '')))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    .map(s => s.scadenza)
    .find(d => d >= new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })) || null;

  // Nomi degli strumenti per la tendina: senza icone (la pagina è del coach) e
  // nell'ordine in cui li vede il cliente.
  const opzioniStrumenti = STRUMENTI
    .map(t => `<option value="${attr(t.key)}">${esc(t.nome)}</option>`).join('');

  // Cosa è aperto adesso. Un permesso scaduto non si mostra: conta quello che il
  // cliente può fare ORA. Nella riga della scheda va solo il riassunto in una
  // frase — i pulsanti stanno tutti dentro la finestrella, così la riga resta
  // pulita come le altre.
  const permessiVivi = permessi.filter(p => p.valido);
  const descrivi = p =>
    p.attende_sessione ? 'fino alla prossima sessione, che non è ancora fissata'
    : (p.primo_accesso || p.durata_ore == null) ? `fino al ${itDateTime(p.fine)}`
    : `${p.durata_ore} ore da quando lo apre (non ancora aperto)`;
  const permessiSintesi = permessiVivi.length === 0
    ? 'Nessun permesso aperto: in questo momento il cliente non apre nulla.'
    : permessiVivi.length === 1
      ? `Aperto: <strong>${permessiVivi[0].tool ? (TOOL_LABEL[permessiVivi[0].tool] || esc(permessiVivi[0].tool)) : 'tutti gli strumenti'}</strong>, ${descrivi(permessiVivi[0])}.`
      : `${permessiVivi.length} permessi aperti.`;
  const permessiElenco = permessiVivi.length === 0
    ? '<div style="font-size:13px;color:#8a94a6">Nessun permesso aperto in questo momento.</div>'
    : permessiVivi.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
          <span style="flex:1">✓ <strong>${p.tool ? (TOOL_LABEL[p.tool] || esc(p.tool)) : 'Tutti gli strumenti'}</strong>
            <span style="color:#8a94a6">— ${descrivi(p)}</span></span>
          <button onclick="chiudiPermesso(${jsStr(p.id)})" class="btn btn-off btn-sm" style="padding:2px 9px;font-size:11px">chiudi</button>
        </div>`).join('');

  // ── PROPOSTA letta dai moduli, da approvare (08/08) ──────────────────
  // Sta in cima alla scheda perché è una cosa che ASPETTA il coach. Mostra il
  // confronto «c'è scritto X → il modulo dice Y»: i campi oggi vuoti arrivano
  // già spuntati, quelli che SOSTITUIREBBERO un dato esistente arrivano spenti,
  // perché è lì che si sbaglia (nella ricognizione dell'08/08 tre valori su
  // tutti erano da non applicare, fra cui un'email scritta male dal cliente).
  const NOMI_CAMPO = {
    data_nascita:'Data di nascita', luogo_nascita:'Luogo di nascita', via:'Via',
    citta:'Città', provincia:'Provincia', cap:'CAP', telefono:'Telefono', email:'Email',
    professione:'Professione', societa:'Società', codice_fiscale:'Codice fiscale',
    pec:'PEC', codice_sdi:'Codice SDI',
  };
  const bozza = client.bozza_anagrafica
    ? (typeof client.bozza_anagrafica === 'string' ? JSON.parse(client.bozza_anagrafica) : client.bozza_anagrafica)
    : null;
  const bozzaHtml = !bozza ? '' : `
    <div class="card" style="border-left:4px solid var(--gold);background:#FFFDF5">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <h2 style="margin:0;font-size:17px">Dati letti dai documenti</h2>
        <span class="badge" style="background:#F3E5B5;color:#7a5c00">da controllare</span>
      </div>
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:14px">
        Da ${bozza.moduli.map(m => esc(m.nome)).join(' · ')}. Spunta quello che vuoi tenere: quello che sostituisce un dato che hai già arriva <strong>non spuntato</strong>.
      </div>
      ${(bozza.proposte || []).length ? `
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--hint);font-size:11px;text-transform:uppercase;letter-spacing:.06em">
          <th style="padding:5px 8px 5px 0;width:26px"></th><th style="padding:5px 8px 5px 0">Campo</th>
          <th style="padding:5px 8px 5px 0">C&rsquo;è scritto</th><th style="padding:5px 0">Il documento dice <span style="text-transform:none;font-weight:400">(correggibile)</span></th>
        </tr></thead>
        <tbody>
        ${bozza.proposte.map(p => `
          <tr style="border-top:1px solid var(--line)">
            <td style="padding:9px 8px 9px 0"><input type="checkbox" class="bz-campo" value="${attr(p.campo)}" ${p.prima ? '' : 'checked'} style="width:20px;height:20px"></td>
            <td style="padding:9px 8px 9px 0;color:var(--muted)">${esc(NOMI_CAMPO[p.campo] || p.campo)}</td>
            <td style="padding:9px 8px 9px 0">${p.prima ? esc(p.prima) : '<span style="color:#ccc">— vuoto</span>'}</td>
            ${/* Il valore è MODIFICABILE (Germano 08/08: «non c'è modo di fare
                  eventuali correzioni»). Quello che si scrive qui è quello che
                  viene salvato: se il documento è stato letto male, o il cliente
                  ha scritto male, si corregge subito senza dover riaprire la
                  scheda dopo. */ ''}
            <td style="padding:9px 0"><input class="bz-valore" data-campo="${attr(p.campo)}" value="${attr(p.dopo)}"
                 style="width:100%;font-weight:600;padding:7px 9px;border:1px solid var(--line);border-radius:7px;font-family:inherit;font-size:13px"></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : ''}
      ${bozza.consenso ? `
      <div style="margin-top:12px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:8px">
        <label style="display:flex;gap:9px;align-items:flex-start;margin:0;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="checkbox" id="bz-consenso" ${bozza.consensoNuovo || bozza.dataConsenso ? 'checked' : ''} style="width:20px;height:20px;margin-top:1px">
          <span><strong>Consenso al trattamento dei dati</strong>${bozza.dataConsenso ? ` — sottoscritto il ${itDate(bozza.dataConsenso)}` : ''}
          ${bozza.comeRisulta ? `<br><span style="color:var(--hint);font-size:12px">${esc(bozza.comeRisulta)}</span>` : ''}</span>
        </label>
      </div>` : ''}
      ${(bozza.daEliminare || []).length ? `
      <div style="margin-top:10px;font-size:12px;color:#B45309">
        🗑 Approvando, ${bozza.daEliminare.length === 1 ? 'verrà eliminato da Drive il modulo rimasto in bianco' : 'verranno eliminati da Drive i moduli rimasti in bianco'}: ${bozza.daEliminare.map(v => esc(v.nome)).join(', ')}.
      </div>` : ''}
      <div id="bz-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button onclick="approvaBozza()" class="btn btn-primary btn-sm">✓ Approva e scrivi</button>
        <button onclick="scartaBozza()" class="btn btn-neutral btn-sm">Scarta</button>
      </div>
    </div>`;

  // ── Com'e messa DAVVERO l'anagrafica letta da Drive (26/08/2026) ─────────
  // La frase qui sotto era TESTO FISSO: diceva «non ancora acquisita» a tutti i
  // clienti, sempre, anche a chi la scheda l'aveva mandata due mesi prima. Ora
  // guarda i fatti: i moduli che l'automazione ha davvero letto, e la proposta
  // eventualmente ancora in attesa di approvazione.
  const moduliLetti = (fatt && fatt.moduliLetti) || [];
  const ultimoModulo = (t) => moduliLetti.filter(m => m.tipo === t)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  const modScheda = ultimoModulo('scheda');
  const modContratto = ultimoModulo('contratto');
  const rigaModulo = (m, fatto, manca) => m
    ? `<span class="az-fatto">✓ ${fatto} il ${itDateTime(m.created_at)}</span>`
    : `<strong style="color:var(--muted)">${manca}</strong>`;
  // ── Il riquadro del contratto (27/08) ────────────────────────────────────
  // Il contratto si fa su UN percorso: qui si prende quello attivo, e se non
  // ce n'è nessuno l'ultimo creato. Il riquadro dice a quale si riferisce,
  // perché un cliente può averne più di uno e sbagliare percorso vorrebbe dire
  // mandargli il contratto di un altro pezzo del suo lavoro.
  // ⭐ La regola sta in UN posto solo (`scegliPercorsoContratto`, accanto al
  //    contratto). Questa pagina la usa per il pulsante e per l'anteprima; la
  //    Mail 2 (fetta 0.5, 04/09) riceve da qui l'id del percorso scelto, così
  //    l'allegato è per costruzione il PDF che si è guardato.
  const percorsoContratto = scegliPercorsoContratto(percorsi);
  // I campi che finirebbero a puntini nel documento. Non è un errore: un
  // contratto con dei puntini si stampa lo stesso e si riempie a penna. Ma
  // meglio saperlo PRIMA di mandarlo, che è il difetto che stiamo togliendo.
  const CAMPI_CONTRATTO = [
    ['codice_fiscale', 'codice fiscale'], ['via', 'indirizzo'], ['citta', 'città'],
    ['provincia', 'provincia'], ['email', 'email'], ['telefono', 'cellulare'],
  ];
  const mancantiContratto = CAMPI_CONTRATTO
    .filter(([col]) => !client[col] || !String(client[col]).trim())
    .map(([, nome]) => nome);
  const modalitaContratto = percorsoContratto && percorsoContratto.modalita;
  const prezzoMancante = percorsoContratto
    && ['Standard', 'Pacchetto'].includes(modalitaContratto)
    && (percorsoContratto.prezzo == null || Number(percorsoContratto.prezzo) === 0);

  // ══════════════════════════════════════════════════════════════════════════
  // COSA RENDE UN CONTRATTO DIVERSO DA UN ALTRO — le SEI variabili.
  //
  // ⭐ Germano (03/09) ne aveva elencate quattro a memoria e ha chiesto se ne
  //    mancava qualcuna. Aperto `contratto-testi.js`: tutto il resto del
  //    documento è testo fisso, uguale per tutti. A cambiare sono solo queste.
  //    Ne mancavano TRE: il prezzo, il numero di sessioni e — la più importante —
  //    la prestazione dello scambio, cioè il campo vuoto che il 03/09 ha fatto
  //    uscire il contratto di Giuliano coi puntini.
  // ⚠️ E una delle sue non serve: la TIPOLOGIA di percorso («Individuale») non
  //    entra nel contratto individuale. Guardarla non fa male, ma non cambia una
  //    virgola: quello che cambia il documento è la MODALITÀ.
  // ➜ Si mostrano PRIMA di mandare, in chiaro: controllare sei righe è più
  //    veloce e più sicuro che cercare i puntini dentro sei pagine di PDF.
  const rateDelPercorso = percorsoContratto
    ? (fatt.tranchePercorsi || []).filter(t => t.percorso_id === percorsoContratto.id)
    : [];
  const vuoto = '<span style="color:#a4342a;font-weight:600">manca</span>';
  const seiVariabili = !percorsoContratto ? [] : [
    ['Dati anagrafici', mancantiContratto.length
      ? `<span style="color:#a4342a;font-weight:600">manca ${mancantiContratto.join(', ')}</span>`
      : '<span style="color:#2f6b46">completi</span>'],
    ['Modalità di pagamento', modalitaContratto ? esc(modalitaContratto) : vuoto],
    ['Prezzo', percorsoContratto.prezzo != null && Number(percorsoContratto.prezzo) > 0
      ? '€ ' + fiscale.euro(percorsoContratto.prezzo) + ' + IVA'
      : (['Scambio servizi', 'Pro bono'].includes(modalitaContratto)
          ? '<span style="color:#8a94a6">non previsto in questa modalità</span>' : vuoto)],
    ['Sessioni previste', percorsoContratto.n_sessioni_previste
      ? String(percorsoContratto.n_sessioni_previste) : vuoto],
    ['Cosa dà il Cliente in cambio', modalitaContratto === 'Scambio servizi'
      ? (percorsoContratto.prestazione_scambio && String(percorsoContratto.prestazione_scambio).trim()
          ? esc(percorsoContratto.prestazione_scambio)
          : '<span style="color:#a4342a;font-weight:600">manca — nel contratto resteranno i puntini</span>')
      : '<span style="color:#8a94a6">non è uno scambio di servizi</span>'],
    ['Rateazione', rateDelPercorso.length
      ? `${rateDelPercorso.length} rate`
      : (modalitaContratto === 'Pacchetto'
          ? '<span style="color:#8a6d1e">nessun piano: il contratto non nominerà nessuna rata</span>'
          : '<span style="color:#8a94a6">non prevista in questa modalità</span>')],
  ];
  // Quello che uscirebbe A PUNTINI o in bianco. È l'avviso che serve PRIMA,
  // non la scoperta sfogliando il PDF.
  const guaiContratto = [
    ...(mancantiContratto.length ? ['nell\'intestazione mancano: ' + mancantiContratto.join(', ')] : []),
    ...(prezzoMancante ? ['il prezzo è vuoto e la modalità lo richiede'] : []),
    ...(modalitaContratto === 'Scambio servizi'
        && !(percorsoContratto && percorsoContratto.prestazione_scambio
             && String(percorsoContratto.prestazione_scambio).trim())
      ? ['non è scritto cosa dà il Cliente in cambio'] : []),
  ];

  const statoAnagrafica = bozza
    ? `<strong style="color:#8a6d1e">Scheda Anagrafica aggiornata da verificare</strong> — qui sotto, nel riquadro «Dati letti dai documenti».`
    : `${rigaModulo(modScheda, 'Scheda anagrafica letta', 'Scheda anagrafica non ancora arrivata')}<br>${rigaModulo(modContratto, 'Contratto letto', 'Contratto non ancora arrivato')}`;

  // Le cinque righe di «A che punto siamo». Ogni riga: fatto (verde) o cosa
  // manca, e — se manca — il pulsante che porta dove si fa.
  const rigaAche = (ok, testoOk, testoManca, azione) => `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid var(--line)">
        <span style="width:18px;text-align:center">${ok ? '<span style="color:#2f6b46">✓</span>' : '<span style="color:#a4342a">○</span>'}</span>
        <span style="flex:1;font-size:13px;${ok ? 'color:var(--muted)' : ''}">${ok ? testoOk : testoManca}</span>
        ${!ok && azione ? azione : ''}
      </div>`;
  const fattCliente = fiscale.statoFatturabilita(fiscale.daCliente(client));
  const percStatoContratto = percorsoContratto
    ? ((fatt.statiContratti && fatt.statiContratti.get(percorsoContratto.id)) || 'da_redigere') : null;
  const bottoncino = (onclick, testo) => `<button onclick="${onclick}" class="btn btn-neutral btn-sm">${testo}</button>`;
  const acheHtml = `
    <div id="a-che-punto" style="margin:0 0 18px;padding:4px 0 2px">
      <div class="zona-tit" style="margin-bottom:2px">A che punto siamo</div>
      ${rigaAche(!mancantiContratto.length, 'Dati anagrafici completi',
        `Dati anagrafici: mancano ${esc(mancantiContratto.join(', '))}`, bottoncino('openEdit()', '✎ Modifica dati'))}
      ${rigaAche(fattCliente.stato === 'pronto', 'Dati per fatturare completi',
        `Dati per fatturare: ${esc(fattCliente.messaggio || 'incompleti')}`, bottoncino('openEdit()', '✎ Modifica dati'))}
      ${rigaAche(!!client.consenso_privacy, `Consenso privacy dato${client.consenso_data ? ' il ' + itDate(client.consenso_data) : ''}`,
        'Consenso privacy non ancora dato: si spunta in «Modifica dati» quando arriva l\'informativa firmata', bottoncino('openEdit()', '✎ Modifica dati'))}
      ${rigaAche(!!mail1SentTxt && !!mail2SentTxt,
        `Mail 1 inviata il ${mail1SentTxt} · Mail 2 inviata il ${mail2SentTxt}`,
        !mail1SentTxt ? 'Mail 1 (lettera, scheda, Codice ICF) non inviata' : 'Mail 2 (contratto, informativa, agenda) non inviata',
        !mail1SentTxt ? bottoncino('openMail1()', '✉️ Rivedi e invia Mail 1') : (percorsoContratto ? bottoncino('openMail2()', '✉️ Rivedi e invia Mail 2') : ''))}
      ${!percorsoContratto
        ? rigaAche(false, '', 'Contratto: serve prima un percorso individuale', bottoncino('openPercorso()', '+ Nuovo percorso'))
        : rigaAche(percStatoContratto === 'approvata', 'Contratto approvato (tornato firmato)',
            `Contratto: ${contrattiStato.stato(percStatoContratto).label.toLowerCase()} — si muove nel riquadro «Contratto» qui sotto`, '')}
    </div>`;

  const azioniHtml = `
    <div class="az-bar">
      <div class="zona-tit">Azioni e collegamenti</div>
      <div class="az-grid">

        <div class="az-gruppo">
          <div class="az-nome">Aggiornamento dati</div>
          <div class="az-btns">
            <button onclick="openEdit()" class="btn btn-primary btn-sm">✎ Modifica dati</button>
            ${client.drive_url
              ? `<button id="scan-moduli-btn" onclick="scanModuliCliente()" class="btn btn-gold btn-sm" title="Legge subito la scheda anagrafica e il contratto dalla cartella Drive, senza aspettare la passata automatica delle 7, delle 15 e delle 23">⟳ Cerca la scheda su Drive</button>`
              : `<button class="btn btn-off btn-sm" disabled title="Serve la cartella Drive del cliente: senza quella non c'è dove cercare">⟳ Cerca la scheda su Drive</button>`}
          </div>
          <div class="az-stato">${statoAnagrafica}</div>
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Contratto</div>
          ${/* ⛔ 03/09 — QUI NON CI VA NESSUN PULSANTE, e ci sono due ragioni.
                  1. Germano: «non serve (e non è mai servito) il pulsante genera
                     contratto: quel lavoro è contenuto in invia Mail 2». Il
                     vecchio «Prepara il contratto» apriva un PDF che poi moriva
                     nel browser — «l'ho salvato io sulla mia scrivania».
                  2. 🔴 E il pulsante che ci avevo messo al suo posto era un
                     DOPPIONE: «Rivedi e invia Mail 2» esisteva già a due
                     riquadri di distanza, e chiamava la stessa funzione. Se n'è
                     accorto Germano guardando la pagina: «ora ci sono 2 pulsanti
                     relativi all'invio del contratto».
                  ⭐ Un riquadro può dire A CHE PUNTO SIAMO senza offrire una
                     seconda porta per la stessa stanza. Qui si legge lo stato;
                     si agisce da «Documenti al cliente», dove stanno le mail. */ ''}
          <div style="font-size:11.5px;color:var(--hint);margin-top:5px">
            Contratto e informativa privacy nascono <strong>dentro la Mail 2</strong> — qui accanto, in «Documenti al cliente» — dove si guardano prima di partire.
          </div>
          ${/* Fetta 6a — lo stato della bozza, con gli stessi pulsanti della card
                del progetto: la cella la disegna `contratti-stato`, non questa
                pagina, così le due pulsantiere non possono divergere. */ ''}
          ${percorsoContratto
            ? `<div style="margin:8px 0 2px">${contrattiStato.cella('cliente', percorsoContratto.id,
                 (fatt.statiContratti && fatt.statiContratti.get(percorsoContratto.id)) || 'da_redigere')}</div>`
            : ''}
          <div class="az-stato">${!percorsoContratto
            ? 'Compare quando il cliente ha un percorso individuale.'
            : `Lo prepara sul percorso <strong>${esc(percorsoContratto.tipo || 'individuale')}</strong>, modalità <strong>${esc(modalitaContratto || '—')}</strong>.` +
              (prezzoMancante ? ' <strong style="color:#a4342a">Il prezzo del percorso è vuoto: nel contratto resterà in bianco.</strong>' : '') +
              (mancantiContratto.length
                ? ` <span style="color:#8a6d1e">Verranno a puntini: ${mancantiContratto.join(', ')}.</span>`
                : ' <span class="az-fatto">✓ i dati del cliente sono completi</span>')
          }</div>
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Documenti al cliente</div>
          <div class="az-btns">
            <button onclick="openMail1()" class="btn btn-gold btn-sm">✉️ Rivedi e invia Mail 1</button>
            <button onclick="openMail2()" class="btn btn-gold btn-sm">✉️ Rivedi e invia Mail 2</button>
          </div>
          <div class="az-stato">
            ${mail1SentTxt ? `<span class="az-fatto">✓ Mail 1 inviata il ${mail1SentTxt}</span>` : 'Mail 1 non inviata'} — lettera · scheda anagrafica · Codice ICF<br>
            ${mail2SentTxt ? `<span class="az-fatto">✓ Mail 2 inviata il ${mail2SentTxt}</span>` : 'Mail 2 non inviata'} — contratto · informativa privacy · agenda
          </div>
          ${/* ⭐ Fetta 3.3 (04/09, decisione b di Germano): i tre PDF si guardano da
                qui, senza aprire la finestrella della mail. Mandare resta una cosa
                sola, dentro «Rivedi e invia Mail 2». */ ''}
          <div id="documenti-cliente" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            ${percorsoContratto
              ? `<a href="/dashboard/clients/${client.id}/percorsi/${percorsoContratto.id}/contratto" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none">📄 Contratto</a>`
              : `<span class="btn btn-off btn-sm" title="Serve un percorso individuale">📄 Contratto</span>`}
            <a href="/dashboard/clients/${client.id}/lettera-privacy" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none">🔒 Informativa privacy</a>
            <a href="/dashboard/clients/${client.id}/agenda" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none">🗓️ Agenda</a>
          </div>
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Cartella su Drive</div>
          ${client.drive_url ? `
          <div class="az-link"><a href="${esc(client.drive_url)}" target="_blank">Apri la cartella su Drive ↗</a></div>
          <div class="az-btns">
            <button onclick="copyLink(this.dataset.url)" data-url="${attr(client.drive_url)}" class="btn btn-neutral btn-sm">📋 Copia il link</button>
          </div>
          <div class="az-stato">Qui vivono i report delle sessioni e la documentazione del cliente.</div>` : `
          <div class="az-btns">
            <button id="drive-folders-btn" onclick="createDriveFolders()" class="btn btn-neutral btn-sm">Crea cartelle su Drive</button>
            <span id="drive-folders-msg" style="font-size:12px;color:#6B7280"></span>
          </div>
          <div class="az-stato">Non ancora creata. Serve per i report delle sessioni e per la documentazione.</div>`}
        </div>

        <div class="az-gruppo">
          <div class="az-nome">Accesso agli strumenti</div>
          <div class="az-btns">
            <button onclick="openStrumento()" class="btn btn-primary btn-sm">🔑 Manda uno strumento</button>
          </div>
          <div class="az-stato">${permessiSintesi}</div>
        </div>

      </div>

      <div class="az-danger">
        <span class="az-stato" style="margin:0">Elimina la persona e tutto il suo storico.</span>
        <button onclick="deleteClient()" class="btn btn-danger btn-sm">🗑 Elimina il cliente</button>
      </div>
    </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — ${esc(client.name)}</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'individuali', briciole: [
    { label: 'Percorsi Individuali', href: '/dashboard/individuali' },
    { label: client.name },
  ] })}
  <div class="container">

    ${bozzaHtml}

    <!-- SCHEDA ANAGRAFICA — due zone: sopra i dati, in fondo azioni e collegamenti -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <h1 style="margin:0">${esc(client.name)}</h1>
        <span class="badge" style="background:${ac}18;color:${ac}">${area}</span>
        <span class="badge ${st.cls}">${st.label}</span>
        <span style="margin-left:auto">${collaudo.interruttore('cliente', client.id, client.di_collaudo)}</span>
        ${/* Qui stava il bollino «🔒 Accesso off»: tolto il 31/07 insieme
              all'interruttore generale che rappresentava. Non spiegava niente e
              soprattutto non esiste più niente da rappresentare — chi entra lo
              decidono i permessi a termine. */ ''}
      </div>

      ${/* ⭐ Fetta 3.2 (04/09/2026) — «A CHE PUNTO SIAMO». La missione chiede di
            «monitorare che tutte le fasi procedano»: anagrafica, dati per
            fatturare, consenso, Mail 1 e 2, contratto. Le informazioni c'erano
            già, sparse in quattro riquadri: qui stanno in fila, ognuna verde o
            con l'azione che manca. Nessun dato nuovo, nessuna seconda porta: le
            azioni sono gli stessi pulsanti di sotto. */ ''}
      ${acheHtml}

      ${/* 11/08 — due colonne affiancate invece di una fila lunga: a sinistra
            CHI È, a destra i SOLDI e le cose da fare. La scheda si era riempita
            e in colonna unica bisognava scorrere per arrivare in fondo.
            Sotto i 1024px torna una colonna sola: su un telefono due colonne
            sarebbero due strisce strette e illeggibili. */ ''}
      <div class="scheda-2col">
      <div>
      <div class="zona-tit">Dati del Cliente</div>
      <div><div class="field-label">Indirizzo</div><div class="field-value">${composeAddress(client) ? esc(composeAddress(client)) : '<span style="color:#ccc">—</span>'}</div></div>
      <div style="margin-top:12px"><div class="field-label">Contatti</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:4px">
          <div><span style="font-size:11px;color:var(--hint)">Telefono</span><div class="field-value">${val(client.telefono)}</div></div>
          <div><span style="font-size:11px;color:var(--hint)">Email</span><div class="field-value">${val(client.email)}</div></div>
          <div><span style="font-size:11px;color:var(--hint)">Social</span><div class="field-value">${client.altro_recapito ? `${client.social_tipo ? `<strong>${esc(client.social_tipo)}</strong> · ` : ''}${esc(client.altro_recapito)}` : '<span style="color:#ccc">—</span>'}</div></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:14px;margin-top:14px">
        <div><div class="field-label">Data di nascita</div><div class="field-value">${client.data_nascita ? itDate(client.data_nascita) : '<span style="color:#ccc">—</span>'}${client.luogo_nascita ? `<span style="color:var(--hint)"> · ${esc(client.luogo_nascita)}</span>` : ''}</div></div>
        <div><div class="field-label">Professione</div><div class="field-value">${val(client.professione)}</div></div>
        <div><div class="field-label">Società</div><div class="field-value">${val(client.societa)}</div></div>
        <div><div class="field-label">Come ci ha conosciuto</div><div class="field-value">${FONTE_LABEL[client.fonte]||val(client.fonte)}</div></div>
        <div><div class="field-label">Consenso privacy</div><div class="field-value">${client.consenso_privacy ? `Sì${client.consenso_data ? ` (${itDate(client.consenso_data)})` : ''}` : '<span style="color:#ccc">No</span>'}</div></div>
      </div>
      </div>
      <div>
      ${/* Dati per la fatturazione: arrivano dal contratto firmato che il cliente
            rimanda (automazione moduli, 07/08), e dall'11/08 portano il VERDETTO
            «pronto per fatturare» / «manca questo».

            ⚠️ Il verdetto compare SOLO se il cliente ha almeno un percorso con un
            prezzo (scelta di Germano, 11/08). Motivo: metà dei clienti in archivio
            sono gusci di prova o scambi di servizi — segnalare a tutti «manca il
            codice fiscale» riempirebbe l'Hub di allarmi che non vogliono dire
            niente. Nessun percorso a pagamento = niente da fatturare = niente da
            segnalare. È la lezione dell'11/08: prima di trasformare un dato in un
            allarme, sapere che cos'è. */ ''}
      ${(() => {
        const st = fiscale.statoFatturabilita(fiscale.daCliente(client));
        const cSoldi = percorsi.some(p => Number(p.prezzo) > 0);
        const cDati  = !!(client.codice_fiscale || client.partita_iva || client.pec || client.codice_sdi);
        if (!cSoldi && !cDati) return '';
        const STILE = {
          pronto:        { bg:'#e7f1ec', color:'#2e6b52', bordo:'#4F8B73' },
          incompleto:    { bg:'#fdf6e3', color:'#8a6d1a', bordo:'#D8AE2E' },
          da_verificare: { bg:'#e8f4fd', color:'#1A5280', bordo:'#223B6E' },
        }[st.stato];
        const REGIME_LABEL = { ordinario:'Regime ordinario', forfettario:'Regime forfettario' };
        return `
      <div>
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div class="zona-tit" style="margin:0">Dati per la fatturazione</div>
          <span style="font-size:11px;color:var(--hint)">${esc(st.etichettaCategoria)}</span>
        </div>
        ${cSoldi ? `
        <div style="margin-bottom:14px;padding:11px 13px;border-left:3px solid ${STILE.bordo};background:${STILE.bg};color:${STILE.color};border-radius:4px;font-size:14px;line-height:1.45">
          ${st.stato === 'pronto' ? '✅ ' : '⚠️ '}${esc(st.messaggio)}
        </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:14px">
          <div><div class="field-label">Codice fiscale</div><div class="field-value">${val(client.codice_fiscale)}</div></div>
          <div><div class="field-label">Partita IVA</div><div class="field-value">${val(client.partita_iva)}</div></div>
          <div><div class="field-label">Regime fiscale</div><div class="field-value">${client.regime ? esc(REGIME_LABEL[client.regime] || client.regime) : '<span style="color:#ccc">—</span>'}</div></div>
          <div><div class="field-label">PEC</div><div class="field-value">${val(client.pec)}</div></div>
          <div><div class="field-label">Codice destinatario SDI</div><div class="field-value">${val(client.codice_sdi)}</div></div>
          <div><div class="field-label">Paese</div><div class="field-value">${val(client.paese || 'IT')}</div></div>
        </div>
      </div>`;
      })()}
      ${client.note_preliminari ? `<div style="margin-top:22px"><div class="zona-tit">Note CRM</div><div style="font-size:14px;color:#6B7280;line-height:1.55">${esc(client.note_preliminari)}</div></div>` : ''}
      ${recallHtml}
      </div>
      </div>

      ${azioniHtml}
    </div>

    ${appuntamentoHtml}
    ${percorsiHtml}
    ${paymentsHtml}
    ${seduteHtml}
    ${strumentiHtml}
  </div>

  <!-- MODAL MODIFICA CLIENTE -->
  <div id="modal-edit" class="modal-overlay">
    <div class="modal-box">
      <h2 style="margin-bottom:16px">Modifica dati cliente</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Nome</label><input id="e-nome" type="text" value="${attr(client.nome)}"></div>
        <div class="form-group"><label>Cognome *</label><input id="e-cognome" type="text" value="${attr(client.cognome)}"></div>
      </div>
      <div class="form-group"><label>Via e numero civico</label><input id="e-via" type="text" value="${attr(client.via)}" placeholder="es. Via Roma 12"></div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px">
        <div class="form-group"><label>CAP</label><input id="e-cap" type="text" value="${attr(client.cap)}"></div>
        <div class="form-group"><label>Città</label><input id="e-citta" type="text" value="${attr(client.citta)}"></div>
        <div class="form-group"><label>Provincia</label><input id="e-provincia" type="text" value="${attr(client.provincia)}" maxlength="4" placeholder="MI"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Telefono</label><input id="e-tel" type="tel" value="${attr(client.telefono)}"></div>
        <div class="form-group"><label>Email</label><input id="e-email" type="email" value="${attr(client.email)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Social</label><select id="e-social-tipo">${socialOptions(client.social_tipo)}</select></div>
        <div class="form-group"><label>Contatto social (username / link)</label><input id="e-altro" type="text" value="${attr(client.altro_recapito)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Professione / ruolo</label><input id="e-prof" type="text" value="${attr(client.professione)}"></div>
        <div class="form-group"><label>Data di nascita</label><input id="e-nascita" type="date" value="${client.data_nascita ? String(client.data_nascita).slice(0,10) : ''}"></div>
      </div>
      <div class="form-group"><label>Società / azienda</label><input id="e-societa" type="text" value="${attr(client.societa)}"></div>
      ${/* Li riempie da sé l'automazione leggendo il contratto firmato, ma restano
            correggibili a mano: se il cliente scrive male un codice, si sistema qui. */ ''}
      <div class="form-group"><label>Luogo di nascita</label><input id="e-luogo-nascita" type="text" value="${attr(client.luogo_nascita)}"></div>
      ${/* 11/08 — «Codice fiscale / P.IVA» era UN campo solo: così non si poteva
            sapere se il cliente è un privato o un professionista con partita IVA,
            ed è proprio quella differenza a decidere se in fattura ci va la
            ritenuta d'acconto. Da qui in poi sono due campi distinti. I codici già
            inseriti restano nel campo del codice fiscale: sono tutti codici
            fiscali veri, nessuno è stato spostato d'ufficio. */ ''}
      <h2 style="font-size:13px;margin:6px 0 12px;color:var(--muted)">Dati per la fatturazione</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Codice fiscale</label><input id="e-cf" type="text" value="${attr(client.codice_fiscale)}"></div>
        <div class="form-group"><label>Partita IVA</label><input id="e-piva" type="text" value="${attr(client.partita_iva)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Regime fiscale</label>
          <select id="e-regime">
            <option value=""${!client.regime ? ' selected' : ''}>— non indicato —</option>
            <option value="ordinario"${client.regime === 'ordinario' ? ' selected' : ''}>Ordinario</option>
            <option value="forfettario"${client.regime === 'forfettario' ? ' selected' : ''}>Forfettario</option>
          </select></div>
        <div class="form-group"><label>Natura giuridica</label>
          <select id="e-natura">
            <option value="persona_fisica"${client.natura_giuridica !== 'persona_giuridica' ? ' selected' : ''}>Persona fisica</option>
            <option value="persona_giuridica"${client.natura_giuridica === 'persona_giuridica' ? ' selected' : ''}>Persona giuridica</option>
          </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>PEC</label><input id="e-pec" type="email" value="${attr(client.pec)}"></div>
        <div class="form-group"><label>Codice destinatario SDI</label><input id="e-sdi" type="text" value="${attr(client.codice_sdi)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:12px">
        <div class="form-group"><label>Paese</label><input id="e-paese" type="text" value="${attr(client.paese || 'IT')}" maxlength="2" placeholder="IT" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Identificativo fiscale estero</label><input id="e-idestero" type="text" value="${attr(client.identificativo_estero)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Area</label><select id="e-area">${areaOptions(area)}</select></div>
        <div class="form-group"><label>Come ci ha conosciuto</label><select id="e-fonte">${fonteOptions(client.fonte||'altro')}</select></div>
      </div>
      <div class="form-group"><label>Obiettivo / motivo del percorso</label><textarea id="e-obiettivo">${esc(client.obiettivo||'')}</textarea></div>
      <hr style="border:none;border-top:1px solid var(--line);margin:6px 0 14px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Stato relazione</label>
          <select id="e-stato">
            <option value="attivo"${client.stato_cliente==='attivo'?' selected':''}>Attivo</option>
            <option value="in pausa"${client.stato_cliente==='in pausa'?' selected':''}>In pausa</option>
            <option value="concluso"${client.stato_cliente==='concluso'?' selected':''}>Concluso</option>
          </select></div>
        <div class="form-group"><label>Data prossima azione</label><input id="e-azione-data" type="date" value="${client.prossima_azione_data ? String(client.prossima_azione_data).slice(0,10) : ''}"></div>
      </div>
      <div class="form-group"><label>Prossima azione (recall)</label><input id="e-azione" type="text" value="${attr(client.prossima_azione)}" placeholder="es. richiamare per proporre nuovo percorso"></div>
      <div class="form-group"><label>Note CRM</label><textarea id="e-note">${esc(client.note_preliminari||'')}</textarea></div>
      <div class="form-group"><label>Link cartella Google Drive</label><input id="e-drive" type="text" value="${attr(client.drive_url)}" placeholder="https://drive.google.com/…"></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input id="e-consenso" type="checkbox" style="width:auto;margin:0" ${client.consenso_privacy?'checked':''}>
        <label style="margin:0;text-transform:none;font-size:13px;letter-spacing:0">Consenso al trattamento dei dati personali${client.consenso_data ? ` (dato il ${itDate(client.consenso_data)}${client.consenso_privacy ? '' : ', poi revocato'})` : ''}</label>
      </div>
      <div id="edit-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-edit').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="saveClient()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAIL 1 — RIVEDI E INVIA -->
  <!-- Manda uno strumento: una finestrella sola al posto delle due tendine e del
       pulsante che stavano nella riga (Germano 31/07: "non mi piace che ci siano
       tre pulsanti… si torna a creare la confusione che avevamo risolto"). Qui le
       scelte hanno lo spazio per essere scritte in chiaro. Struttura come le
       altre finestrelle: h2 primo figlio, riga dei pulsanti ultimo div — è quello
       che le tiene appesi in alto e in basso quando il contenuto non ci sta. -->
  <div id="modal-strumento" class="modal-overlay">
    <div class="modal-box" style="width:520px">
      <h2 style="margin-bottom:4px">Manda uno strumento a ${esc(mailNome || client.name)}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#8a94a6">Il link è sempre lo stesso indirizzo: a decidere se si apre è il permesso che gli dài qui.</p>

      <div class="form-group">
        <label>Cosa gli apri</label>
        <select id="perm-tool" onchange="aggiornaDurate()">
          <option value="">Il portale — tutti gli strumenti</option>
          ${opzioniStrumenti}
        </select>
      </div>

      <div class="form-group">
        <label>Per quanto</label>
        <label style="display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="radio" name="perm-durata" value="ore" checked style="width:auto;margin:3px 0 0">
          <span>Per la sessione di oggi<br><span style="color:#8a94a6;font-size:12px">Vale ${PERMESSO_ORE_SESSIONE} ore, contate da quando il cliente apre il link — così puoi mandarglielo anche la sera prima.</span></span>
        </label>
        <label id="perm-lbl-sessione" style="display:flex;align-items:flex-start;gap:8px;margin:0;text-transform:none;letter-spacing:0;font-weight:400;font-size:13px">
          <input type="radio" name="perm-durata" value="sessione" id="perm-r-sessione" style="width:auto;margin:3px 0 0">
          <span>${prossimaSess ? `Fino alla prossima sessione — <strong>${itDate(prossimaSess)}</strong>` : 'Fino alla prossima sessione'}<br><span style="color:#8a94a6;font-size:12px">${prossimaSess
            ? 'Arriva a fine giornata di quel giorno, così il lavoro lo aprite insieme in sessione. Vale per un solo strumento, non per tutto il portale.'
            : 'La data non è ancora nei report: il collegamento resta aperto finché non la fissate, e allora si aggancia da sé a quel giorno.'}</span></span>
        </label>
      </div>

      <!-- La mail vale SOLO per uno strumento singolo: per il portale sparisce. -->
      <div id="perm-mail" style="border-top:1px solid var(--line);padding-top:14px;margin-top:4px;display:none">
        <div class="form-group"><label>Manda per email a</label>
          <input id="perm-to" type="email" value="${attr(client.email)}" placeholder="email del cliente">
          ${client.email ? '' : '<div style="font-size:12px;color:#B45309;margin-top:4px">In anagrafica non c&rsquo;è l&rsquo;email: scrivila qui, oppure copia il link e mandaglielo come preferisci.</div>'}
        </div>
        <div class="form-group"><label>Oggetto</label><input id="perm-subject" type="text"></div>
        <div class="form-group"><label>Testo</label><textarea id="perm-body" style="min-height:150px;font-family:inherit"></textarea></div>
      </div>

      <div class="form-group" style="margin-bottom:14px">
        <label>Permessi aperti adesso</label>
        <div id="perm-elenco">${permessiElenco}</div>
      </div>

      <div id="perm-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-strumento').style.display='none'" class="btn btn-neutral" style="flex:1">Chiudi</button>
        <button onclick="creaPermesso(false)" class="btn btn-neutral" style="flex:1">📋 Copia il link</button>
        <button id="perm-btn-invia" onclick="creaPermesso(true)" class="btn btn-primary" style="flex:1;display:none">✉️ Invia la mail</button>
      </div>
    </div>
  </div>

  <div id="modal-mail1" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <h2 style="margin-bottom:4px">Rivedi e invia — Mail 1 di benvenuto</h2>
      <p style="margin:0 0 14px;font-size:12px;color:#8a94a6">L'invio è reale: la mail parte davvero al destinatario qui sotto.</p>
      <div class="form-group"><label>A (destinatario)</label><input id="m1-to" type="email" value="${attr(client.email)}" placeholder="email del cliente"></div>
      <div class="form-group"><label>Oggetto</label><input id="m1-subject" type="text" value="${attr(mail1Subject)}"></div>
      <div class="form-group">
        <label>Lettera allegata</label>
        <div style="display:flex;gap:18px;align-items:center;font-size:13px">
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;letter-spacing:0;font-weight:400">
            <input type="radio" name="m1-genere" value="maschile" style="width:auto;margin:0" ${mail1Genere==='maschile'?'checked':''}> Maschile (Caro… benvenuto)</label>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;letter-spacing:0;font-weight:400">
            <input type="radio" name="m1-genere" value="femminile" style="width:auto;margin:0" ${mail1Genere==='femminile'?'checked':''}> Femminile (Cara… benvenuta)</label>
        </div>
      </div>
      <div class="form-group"><label>Testo della mail</label><textarea id="m1-body" style="min-height:230px;font-family:inherit">${esc(mail1Body)}</textarea></div>
      <div style="font-size:12px;color:#6B7280;background:#f7f9fc;border-radius:8px;padding:9px 12px;margin-bottom:12px">
        📎 Allegati (3): <strong>Lettera di Benvenuto</strong> · <strong>Scheda Anagrafica</strong> · <strong>Codice Etico ICF 2025</strong>
      </div>
      <div id="mail1-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-mail1').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="m1-send" onclick="sendMail1()" class="btn btn-primary" style="flex:1">✉️ Invia adesso</button>
      </div>
    </div>
  </div>

  <!-- MODAL MAIL 2 — RIVEDI E INVIA -->
  <div id="modal-mail2" class="modal-overlay">
    <div class="modal-box" style="width:560px">
      <h2 style="margin-bottom:4px">Rivedi e invia — Mail 2</h2>
      <p style="margin:0 0 14px;font-size:12px;color:#8a94a6">L'invio è reale: la mail parte davvero al destinatario qui sotto.</p>
      <div class="form-group"><label>A (destinatario)</label><input id="m2-to" type="email" value="${attr(client.email)}" placeholder="email del cliente"></div>
      <div class="form-group"><label>Oggetto</label><input id="m2-subject" type="text" value="${attr(mail2Subject)}"></div>
      <div class="form-group"><label>Testo della mail</label><textarea id="m2-body" style="min-height:200px;font-family:inherit">${esc(mail2Body)}</textarea></div>

      ${/* ⭐ 03/09 — IL CONTROLLO PRIMA DELL'INVIO, disegno di Germano.
            «Il pulsante genera contratto non serve e non è mai servito: quel
            lavoro è contenuto in invia Mail 2. L'unica cosa che deve cambiare è
            che i pdf generati per essere inviati possano essere controllati.»
            ➜ Qui non si corregge niente: si GUARDA. Se qualcosa non torna si va
            a correggerlo dove vive e si riapre. Un secondo posto dove scrivere
            il prezzo sarebbe un secondo posto dove sbagliarlo. */ ''}
      ${!percorsoContratto ? `
      <div class="flash-error" style="margin-bottom:12px">
        Questo cliente non ha un percorso individuale: senza percorso il contratto non saprebbe dire
        né la modalità né il prezzo. <strong>La mail non parte.</strong>
      </div>` : `
      <div style="border:1px solid var(--line);border-radius:8px;padding:11px 13px;margin-bottom:12px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a94a6;margin-bottom:7px">
          Cosa rende diverso questo contratto — le sei cose da controllare
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12.5px;align-items:baseline">
          ${seiVariabili.map(([et, val]) => `<span style="color:#8a94a6">${et}</span><span>${val}</span>`).join('')}
        </div>
        ${guaiContratto.length ? `
        <div style="margin-top:9px;padding:7px 10px;background:#fdf3f2;border-radius:6px;font-size:12px;color:#a4342a">
          ⚠️ Così com'è, nel contratto resteranno degli spazi vuoti: ${guaiContratto.join(' · ')}.
          Si correggono nella scheda o nel percorso, poi si riapre questa finestrella.
        </div>` : ''}
      </div>
      <div style="font-size:12px;color:#6B7280;background:#f7f9fc;border-radius:8px;padding:10px 12px;margin-bottom:12px">
        ${/* ⭐ Fetta 3.3 (04/09, Germano): «vorrei la possibilità di selezionare cosa
              mandare» — quel giorno aveva dovuto mandare contratto e informativa in
              bozza, e l'agenda insieme. Ogni allegato ha la sua spunta; di norma
              partono tutti e tre. Aprire il PDF e spuntarlo sono due gesti separati. */ ''}
        <div style="margin-bottom:6px">📎 <strong>Allegati</strong> — spunta quelli da mandare, aprili e controllali prima:</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center">
          <label style="margin:0;text-transform:none;letter-spacing:0;font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" class="m2-allegato" value="contratto" checked style="width:18px;height:18px"> Contratto</label>
          <a href="/dashboard/clients/${client.id}/percorsi/${percorsoContratto.id}/contratto" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none;justify-self:start">📄 Apri il contratto</a>
          <label style="margin:0;text-transform:none;letter-spacing:0;font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" class="m2-allegato" value="informativa" checked style="width:18px;height:18px"> Informativa privacy</label>
          <a href="/dashboard/clients/${client.id}/lettera-privacy" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none;justify-self:start">🔒 Apri l'informativa</a>
          <label style="margin:0;text-transform:none;letter-spacing:0;font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" class="m2-allegato" value="agenda" checked style="width:18px;height:18px"> Agenda di sessione</label>
          <a href="/dashboard/clients/${client.id}/agenda" target="_blank" class="btn btn-neutral btn-sm" style="text-decoration:none;justify-self:start">🗓️ Apri l'agenda</a>
        </div>
        <div style="margin-top:6px;color:#aaa">Partono gli stessi identici file che apri qui. La Mail 2 conta come inviata quando parte il contratto.</div>
      </div>`}
      <div id="mail2-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-mail2').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        ${percorsoContratto
          ? `<button id="m2-send" onclick="sendMail2()" class="btn btn-primary" style="flex:1">✉️ Approva e invia</button>`
          : `<button class="btn btn-off" style="flex:1" disabled title="Serve un percorso individuale">✉️ Approva e invia</button>`}
      </div>
    </div>
  </div>

  <!-- MODAL PERCORSO (serve sia a crearne uno nuovo sia a correggerne uno esistente) -->
  <div id="modal-percorso" class="modal-overlay">
    <div class="modal-box" style="width:420px">
      <h2 id="p-titolo" style="margin-bottom:16px">Nuovo percorso</h2>
      <input id="p-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Tipo</label>
          <select id="p-tipo"><option>Individuale</option><option>Business</option><option>Young</option><option>Team</option><option>Group</option></select></div>
        <div class="form-group"><label>Modalità</label>
          <select id="p-modalita" onchange="modalitaCambiata()"><option value="Standard" selected>Standard (si paga ogni sessione)</option><option value="Pacchetto">Pacchetto (cifra unica per N sessioni)</option><option value="Scambio servizi">Scambio servizi</option><option value="Pro bono">Pro bono</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Sessioni previste</label><input id="p-sessioni" type="number" step="1" min="1" value="8"></div>
        <div class="form-group" id="p-prezzo-box"><label id="p-prezzo-label">Prezzo a sessione (€)</label><input id="p-prezzo" type="number" step="0.01" placeholder="es. 150"></div>
        <div class="form-group" id="p-scambio-box" style="display:none"><label>Cosa eroga il Cliente in cambio</label><input id="p-scambio" type="text" placeholder="es. consulenza in ambito risorse umane"><div style="font-size:11px;color:#8a94a6;margin-top:4px">Finisce nel contratto, al punto sul compenso. Senza, quello spazio resta in bianco.</div></div>
        ${/* ⭐ 03/09 — LE RATE SONO PARTE DEL PERCORSO, non un'appendice.
              Germano, dopo averlo provato: «prima crei il percorso e gli dai un
              valore, poi in Amministrazione vai a dare i valori alle quote. Mi
              sembra un modo troppo complicato e inutile. Le informazioni sulle
              quote dovrebbero essere inseribili nella prima fase.»
              ⚠️ Ma le rate si agganciano al percorso, e un percorso non ha
              un'identità finché non è salvato: scriverle PRIMA è impossibile.
              ➜ Allora si salva e la finestrella del piano si apre DA SOLA,
              subito dopo. Un gesto solo, dal suo punto di vista.
              ⛔ E NON si scrive un secondo editor delle rate qui dentro: è la
              stessa finestrella di Amministrazione (piano-ui.js). Due posti
              dove si scrivono le rate direbbero cose diverse, ed è la regola
              che questo codice si è già dato per le sezioni e per i contratti. */ ''}
        <div id="p-piano-box" style="display:none;border:1px solid var(--line);border-radius:8px;padding:9px 11px;margin-bottom:12px;font-size:12.5px">
          <div id="p-piano-testo" style="color:var(--muted)"></div>
          <button type="button" id="p-piano-btn" onclick="apriPianoDaPercorso()" class="btn btn-neutral btn-sm" style="margin-top:7px;display:none">Apri il piano delle rate</button>
        </div>
      </div>
      <div class="form-group" id="p-ore-box"><label>Ore già svolte (percorsi iniziati prima dell'Hub)</label><input id="p-ore" type="number" step="0.5" min="0" value="0"></div>
      ${progetti.length ? `<div class="form-group"><label>Progetto (facoltativo)</label>
        <select id="p-progetto"><option value="">— nessuno (percorso individuale) —</option>${progetti.map(pr => `<option value="${pr.progetto_id}">${esc(pr.titolo)} · ${esc(pr.committente_nome)}</option>`).join('')}</select></div>` : ''}
      <div class="form-group"><label>Data inizio</label><input id="p-data" type="date"></div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input id="p-promo" type="checkbox" style="width:auto;margin:0">
        <label style="margin:0;text-transform:none;font-size:13px;letter-spacing:0">Promo / sconto applicato</label>
      </div>
      <div class="form-group"><label>Note sconto</label><input id="p-sconto" type="text" placeholder="es. 20% lancio…"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('modal-percorso').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button onclick="savePercorso()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
    </div>
  </div>

  <!-- MODAL APPUNTAMENTO (12/08) — la data del prossimo incontro, a mano.
       Non tocca nessun report: quello che si scrive qui vive per conto suo. -->
  <div id="modal-app" class="modal-overlay">
    <div class="modal-box" style="width:420px;max-width:94vw">
      <h2 style="margin-bottom:4px">Prossimo appuntamento</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">${esc(client.name)}</p>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="ap-data" type="date"></div>
        <div class="form-group"><label>Ora</label><input id="ap-ora" type="time"></div>
      </div>
      <p style="color:var(--hint);font-size:12px;margin-bottom:14px">
        Non modifica nessun report. Resta scritto finché non arriva il report di
        una sessione più recente.
      </p>
      <div id="ap-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="document.getElementById('modal-app').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="ap-salva" onclick="salvaApp()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
      <button onclick="togliApp()" class="btn btn-danger btn-sm" style="width:100%;margin-top:10px">Elimina l'appuntamento</button>
    </div>
  </div>

  <!-- MODAL SEDUTA (diario sessioni) -->
  <div id="modal-seduta" class="modal-overlay">
    <div class="modal-box" style="width:600px;max-width:94vw">
      <h2 id="seduta-title" style="margin-bottom:16px">Aggiungi sessione</h2>
      <input id="s-id" type="hidden">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Percorso</label>
          <select id="s-percorso">${percorsi.map(p => `<option value="${p.id}">${esc(p.tipo)}${p.data_inizio ? ` · dal ${itDate(p.data_inizio)}` : ''}${p.stato !== 'attivo' ? ' (concluso)' : ''}</option>`).join('')}</select></div>
        <div class="form-group"><label>Tipo</label>
          <select id="s-tipo" onchange="oreAuto()"><option value="Intake">Intake</option><option value="Ongoing" selected>Ongoing</option><option value="Final">Final</option></select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="s-data" type="date"></div>
        <div class="form-group"><label>Ore <span id="s-ore-hint" style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0"></span></label><input id="s-ore" type="number" step="0.5" min="0"></div>
      </div>
      <div class="form-group"><label>Obiettivo <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(una frase)</span></label><textarea id="s-obiettivo" style="min-height:54px"></textarea></div>
      <div class="form-group"><label>Argomenti trattati <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga, inizia con -)</span></label><textarea id="s-argomenti" style="min-height:72px" placeholder="- primo argomento&#10;- secondo argomento"></textarea></div>
      <div class="form-group"><label>Attività concordate <span style="font-size:11px;color:#aaa;text-transform:none;letter-spacing:0">(un punto per riga, inizia con -)</span></label><textarea id="s-attivita" style="min-height:60px" placeholder="- prima attività&#10;- **Cliente:** seconda attività"></textarea></div>
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

  ${/* ⛔ TOLTA 15/08 con il pulsante «+ Pagamento»: una finestrella che nessuno
        può più aprire non è innocua, è la trappola in cui sono già cascato una
        volta (il finto pulsante «Aggiungi sessione» del 10/08 — codice che
        esiste non vuol dire funzione che esiste). Le rotte del server restano,
        e vanno tolte con la pulizia del codice morto, con la prova che nessuno
        le chiama. */ ''}
  ${/* Fetta C — la finestrella del piano di un pacchetto. È LA STESSA della
        scheda del progetto (piano-ui.js): qui cambia solo come si chiama la
        cifra e dove si salva. Compare solo se questo cliente ha un pacchetto,
        così le altre schede non si portano dietro markup che non usano. */ ''}
  ${pianoAttivo ? pianoUi.modale({
    labelValore: 'Cifra concordata',
    valore: null,
    dataMeta: '', dataFine: '',
    sottotitolo: 'In quante volte si paga. Si scrivono gli euro: la percentuale la calcola l\'Hub.',
    mostraDividi: false,
  }) + pianoUi.modaleIncasso() : ''}
  ${/* ⚠️ Questa NON sta dentro `pianoAttivo`: il link all'ultima proforma c'è
        su qualunque scheda, anche senza pacchetto. Metterla nel ramo
        condizionale vorrebbe dire un link che non apre niente — il guasto che
        si vede solo in un browser vero. */ ''}
  ${modalePdf()}

  <div id="toast" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--navy);color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:200">Fatto!</div>
  <script>
    ${statoUi.js()}
    ${jsModalePdf()}
    const CID = '${client.id}';
    // Fetta 0.5 (04/09): il percorso di cui la finestrella della Mail 2 apre
    // l'anteprima. È lo stesso che «Approva e invia» manda alla rotta, così
    // l'allegato è per costruzione il PDF che si è guardato.
    const PERC_CONTRATTO = '${percorsoContratto ? percorsoContratto.id : ''}';
    // Per comporre link e testo della mail dello strumento, senza chiedere al server.
    const PERM_BASE = '${PLATFORM_URL}/c/${client.token}';
    const PERM_NOMI = ${JSON.stringify(Object.fromEntries(STRUMENTI.map(t => [t.key, t.nome]))).replace(/</g, '\\u003c')};
    const PERM_SCAD = ${prossimaSess ? `'${prossimaSess}'` : 'null'};

    ${pianoAttivo ? `
    ${/* ── FETTA C — il piano di un pacchetto ─────────────────────────────
          La finestrella arriva tutta da piano-ui.js: qui non si riscrive
          niente, si dice solo QUALE pacchetto si sta impostando e DOVE si
          salva. Parte con PIANI vuoto e si riempie al clic su «Modifica il
          piano»: un cliente può avere più di un pacchetto, e ognuno ha le sue
          date e il suo prezzo. Riempire il DOM su un CLIC è ammesso — la
          regola vieta di rifarlo mentre qualcuno sta scrivendo. */ ''}
    ${pianoUi.js({ piani: [], dataFirma: '', quotaPerPagatore: false })}

    var PACCHETTI = ${JSON.stringify(pacchetti.map(pc => ({
      id: pc.id, titolo: pc.titolo, quota: pc.quota, righe: pc.righe,
      data_inizio: pc.data_inizio, data_meta: pc.data_meta, data_fine: pc.data_fine,
    }))).replace(/</g, '\\u003c')};
    var QUOTE_PROGETTO = ${JSON.stringify(progettiConto.filter(g => g.q > 0).map(g => ({
      part_id: g.pr.part_id, titolo: g.pr.titolo, quota: g.q,
      righe: pianoUi.righeDi(g.salvate, g.q, 'partecipante', rateChieste),
      data_inizio: g.pr.data_inizio ? String(g.pr.data_inizio).slice(0, 10) : '',
      data_meta:   g.pr.data_meta   ? String(g.pr.data_meta).slice(0, 10)   : '',
      data_fine:   g.pr.data_fine   ? String(g.pr.data_fine).slice(0, 10)   : '',
    }))).replace(/</g, '\\u003c')};
    ${/* Che cosa si sta impostando: un pacchetto o una quota dentro un progetto.
          Il resto della finestrella non cambia di una riga — e non deve. */ ''}
    var PIANO_TIPO = null;   // 'pacchetto' | 'partecipazione'
    var PACC_ID = null;

    // Sulla scheda del cliente il pagatore è la persona di cui stai già
    // guardando la scheda: non c'è niente da aprire né da togliere.
    function azioniPagatore(pg) { return ''; }

    function apriPianoPacchetto(id) {
      var pc = null;
      for (var i = 0; i < PACCHETTI.length; i++) if (PACCHETTI[i].id === id) pc = PACCHETTI[i];
      if (!pc) return;
      PIANO_TIPO = 'pacchetto'; PACC_ID = id;
      DATA_FIRMA = pc.data_inizio || '';
      PIANI = [{ key: 'pacchetto', pid: null, nome: pc.titolo, ruolo: 'pacchetto',
                 quota: pc.quota, tipo: 'committente', righe: pc.righe }];
      preparaPiano('Prezzo del pacchetto', false, '');
      document.getElementById('q-totale').value = pc.quota || '';
      document.getElementById('pi-meta').value  = pc.data_meta || '';
      document.getElementById('pi-fine').value  = pc.data_fine || '';
      costruisciFinestrella();
      apriPiano();
    }

    ${/* 15/08 — la quota dentro un progetto si imposta come un pacchetto, con la
          STESSA finestrella. Cambiano solo tre cose: l'etichetta della cifra, il
          fatto che cifra e date sono spente (sono del progetto), e dove si
          salva. */ ''}
    function apriPianoPartecipazione(partId) {
      var g = null;
      for (var i = 0; i < QUOTE_PROGETTO.length; i++) if (QUOTE_PROGETTO[i].part_id === partId) g = QUOTE_PROGETTO[i];
      if (!g) return;
      PIANO_TIPO = 'partecipazione'; PACC_ID = partId;
      DATA_FIRMA = g.data_inizio || '';
      PIANI = [{ key: 'pacchetto', pid: null, nome: g.titolo, ruolo: 'quota nel progetto',
                 quota: g.quota, tipo: 'partecipante', righe: g.righe }];
      preparaPiano('Quota nel progetto', true,
        'La cifra concordata e le date sono del progetto: si cambiano lì. Qui si decide in quante volte si paga.');
      document.getElementById('q-totale').value = g.quota || '';
      document.getElementById('pi-meta').value  = g.data_meta || '';
      document.getElementById('pi-fine').value  = g.data_fine || '';
      costruisciFinestrella();
      apriPiano();
    }

    async function salvaTutto() {
      var err = document.getElementById('piano-error');
      err.style.display = 'none';
      try {
        // Si legge dai CAMPI, non da PIANI: dentro la finestrella il DOM è la
        // verità mentre si scrive (la lezione del 15/08).
        var perKey = leggiFinestrella();
        var k = Object.keys(perKey)[0];
        if (!k) { err.textContent = 'Non ci sono rate da salvare.'; err.style.display = 'block'; return; }
        var dove, corpo;
        if (PIANO_TIPO === 'partecipazione') {
          // Qui NON si mandano né la quota né le date: sono del progetto, e
          // mandarle da qui vorrebbe dire poterlo scombinare da un'altra pagina.
          dove  = '/dashboard/partecipazioni/' + PACC_ID + '/piano';
          corpo = { righe: perKey[k].righe };
        } else {
          dove  = '/dashboard/percorsi/' + PACC_ID + '/piano';
          corpo = {
            prezzo: document.getElementById('q-totale').value,
            data_meta: document.getElementById('pi-meta').value,
            data_fine: document.getElementById('pi-fine').value,
            righe: perKey[k].righe };
        }
        var r = await fetch(dove, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block'; return; }
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block'; }
    }
    ` : ''}
    const PERM_NOME_CLIENTE = ${JSON.stringify(mailNome || client.name).replace(/</g, '\\u003c')};
    const PERM_ORE = ${PERMESSO_ORE_SESSIONE};
    const SEDUTE = ${JSON.stringify(Object.fromEntries(sedute.map(s => [s.id, { id: s.id, percorso_id: s.percorso_id, tipo: s.tipo, data: s.data, ore: Number(s.ore), obiettivo: s.obiettivo || '', argomenti: s.argomenti || '', attivita: s.attivita || '', scadenza: s.scadenza || '', prossima_ora: s.prossima_ora || '', eseguita: s.eseguita || '', note: s.note || '' }]))).replace(/</g, '\\u003c')};
    // Dati dei percorsi per riempire la finestra quando si preme "Modifica".
    const PERCORSI_DATI = ${JSON.stringify(Object.fromEntries(percorsi.map(p => [p.id, { id: p.id, tipo: p.tipo || 'Individuale', modalita: p.modalita || 'Standard', prezzo: p.prezzo === null || p.prezzo === undefined ? '' : String(p.prezzo), n_sessioni_previste: Number(p.n_sessioni_previste) || 8, promo: !!p.promo, sconto_note: p.sconto_note || '', data_inizio: p.data_inizio ? String(p.data_inizio).slice(0, 10) : '', prestazione_scambio: p.prestazione_scambio || '', nRate: trPerc.filter(t => t.percorso_id === p.id).length }]))).replace(/</g, '\\u003c')};
    const ORE_TIPO = { Intake: 2, Ongoing: 1, Final: null };
    ${paginaJs.sedute({
      oreTipo: 'ORE_TIPO', richiedePercorso: true,
      basePercorso: "'/dashboard/clients/' + CID + '/percorsi/' + pid",
      pidSalvataggio: "document.getElementById('s-percorso').value",
      ricarica: 'location.reload()',
      confermaElimina: 'Eliminare questa sessione dal diario? Le ore si ricalcolano.',
      confermaApprova: 'Approvare questa scheda? Da bozza diventa una sessione confermata e le ore entrano nel conteggio ICF.',
    })}
    ${collaudo.js()}
    ${chiamaUi.js()}
    // Fetta 6a — muove lo stato della bozza di contratto. Stessa rotta della card
    // del progetto: una sola porta per tutti e tre i tipi di contratto.
    // ⚠️ Qui il tipo è sempre 'cliente' e non congela niente: le specifiche di
    //    progetto non esistono in un percorso individuale, quindi niente conferma.
    ${paginaJs.muoviContratto({ confermaCongelamento: false, ricarica: 'location.reload()' })}
    async function scanDrive() {
      const btn = document.getElementById('scan-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Cerco… (può volerci qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca nuovi report'; } };
      try {
        const r = await fetch('/dashboard/scan-drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CID }) });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const n = (d.processed || []).length;
        if (n === 0) {
          const errs = (d.errors || []).map(e => e.err).join('; ');
          alert('Nessun nuovo report da lavorare' + (errs ? ('. Nota: ' + errs) : ' (già lavorati, o cartella Ongoing/Intake/Final vuota).'));
          reset(); return;
        }
        alert(n + (n === 1 ? ' bozza creata' : ' bozze create') + '. La trovi qui sotto, evidenziata, da approvare.');
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }
    async function scanModuliCliente() {
      const btn = document.getElementById('scan-moduli-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Leggo la scheda… (può volerci qualche secondo)'; }
      const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '⟳ Cerca la scheda su Drive'; } };
      try {
        const r = await fetch('/dashboard/clients/' + CID + '/scan-moduli', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (!r.ok || d.error) { alert('Errore: ' + (d.error || r.status)); reset(); return; }
        const errs = (d.errors || []).map(e => e.errore || e.err).join('; ');
        // Un guasto NON è un «niente di nuovo»: se la lettura non è potuta partire
        // (Drive non raggiungibile, cartella sbagliata) va detto, altrimenti sembra
        // che abbia guardato e non abbia trovato nulla. Provato col pulsante, 26/08.
        if (errs) { alert('Non sono riuscito a leggere la cartella Drive: ' + errs); reset(); return; }
        if ((d.proposte || []).length === 0) {
          alert('Niente di nuovo: nella cartella Drive non ci sono moduli compilati che non siano già stati letti.');
          reset(); return;
        }
        alert('Letta. La proposta è qui sotto, da controllare e approvare.');
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); reset(); }
    }
    // ── Appuntamento (12/08) ──
    var appPercorso = null;
    ${paginaJs.appuntamento({ conChi: false, confermaTogli: "Elimino l'appuntamento?" })}
    ${paginaJs.toast()}
    function openEdit() { document.getElementById('modal-edit').style.display='flex'; }
    function openMail1() {
      document.getElementById('mail1-error').style.display='none';
      document.getElementById('modal-mail1').style.display='flex';
    }
    async function sendMail1() {
      const err = document.getElementById('mail1-error');
      const to = document.getElementById('m1-to').value.trim();
      if (!to) { err.textContent='Serve un indirizzo destinatario.'; err.style.display='block'; return; }
      const gEl = document.querySelector('input[name="m1-genere"]:checked');
      const payload = {
        to,
        subject: document.getElementById('m1-subject').value,
        body: document.getElementById('m1-body').value,
        genere: gEl ? gEl.value : null,
      };
      if (!confirm('Invio la Mail 1 a ' + to + ' con i 3 allegati?')) return;
      const btn = document.getElementById('m1-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display='none';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/mail1/invia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || d.error) { err.textContent = d.error || ('Errore ' + r.status); err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; return; }
        alert('Mail inviata a ' + d.to + '.\\nAllegati: ' + (d.allegati||[]).join(', '));
        location.reload();
      } catch(e) { err.textContent='Errore di rete: ' + e.message; err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Invia adesso'; }
    }
    async function createDriveFolders() {
      const btn = document.getElementById('drive-folders-btn');
      const msg = document.getElementById('drive-folders-msg');
      btn.disabled = true; msg.style.color='#6B7280'; msg.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/drive-folders', { method:'POST' });
        const d = await r.json();
        if (d.error) { msg.style.color='#b45309'; msg.textContent = d.error; btn.disabled = false; return; }
        location.reload();
      } catch(e) { msg.style.color='#b45309'; msg.textContent = 'Errore di rete, riprova'; btn.disabled = false; }
    }
    function openMail2() {
      document.getElementById('mail2-error').style.display='none';
      document.getElementById('modal-mail2').style.display='flex';
    }
    async function sendMail2() {
      const err = document.getElementById('mail2-error');
      const to = document.getElementById('m2-to').value.trim();
      if (!to) { err.textContent='Serve un indirizzo destinatario.'; err.style.display='block'; return; }
      const allegati = [...document.querySelectorAll('.m2-allegato:checked')].map(c => c.value);
      if (!allegati.length) { err.textContent='Spunta almeno un allegato.'; err.style.display='block'; return; }
      const payload = {
        to,
        subject: document.getElementById('m2-subject').value,
        body: document.getElementById('m2-body').value,
        percorso_id: PERC_CONTRATTO,
        allegati,
      };
      const NOMI_ALLEGATI = { contratto: 'contratto', informativa: 'informativa privacy', agenda: 'agenda' };
      if (!confirm('Invio a ' + to + ': ' + allegati.map(a => NOMI_ALLEGATI[a] || a).join(', ') + '?')) return;
      const btn = document.getElementById('m2-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display='none';
      try {
        const r = await fetch('/dashboard/clients/'+CID+'/mail2/invia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const d = await r.json().catch(()=>({}));
        if (!r.ok || d.error) { err.textContent = d.error || ('Errore ' + r.status); err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Approva e invia'; return; }
        alert('Mail inviata a ' + d.to + '.\\nAllegati: ' + (d.allegati||[]).join(', '));
        location.reload();
      } catch(e) { err.textContent='Errore di rete: ' + e.message; err.style.display='block'; btn.disabled=false; btn.textContent='✉️ Approva e invia'; }
    }
    async function saveClient() {
      const nome    = document.getElementById('e-nome').value.trim();
      const cognome = document.getElementById('e-cognome').value.trim();
      const err = document.getElementById('edit-error');
      if (!cognome) { err.textContent='Il cognome è obbligatorio'; err.style.display='block'; return; }
      const payload = {
        nome, cognome, email:document.getElementById('e-email').value, telefono:document.getElementById('e-tel').value,
        altro_recapito:document.getElementById('e-altro').value, social_tipo:document.getElementById('e-social-tipo').value,
        via:document.getElementById('e-via').value, cap:document.getElementById('e-cap').value,
        citta:document.getElementById('e-citta').value, provincia:document.getElementById('e-provincia').value,
        professione:document.getElementById('e-prof').value, societa:document.getElementById('e-societa').value, data_nascita:document.getElementById('e-nascita').value||null,
        luogo_nascita:document.getElementById('e-luogo-nascita').value, codice_fiscale:document.getElementById('e-cf').value,
        pec:document.getElementById('e-pec').value, codice_sdi:document.getElementById('e-sdi').value,
        partita_iva:document.getElementById('e-piva').value, regime:document.getElementById('e-regime').value,
        natura_giuridica:document.getElementById('e-natura').value, paese:document.getElementById('e-paese').value,
        identificativo_estero:document.getElementById('e-idestero').value,
        area:document.getElementById('e-area').value, fonte:document.getElementById('e-fonte').value,
        obiettivo:document.getElementById('e-obiettivo').value, stato_cliente:document.getElementById('e-stato').value,
        prossima_azione:document.getElementById('e-azione').value, prossima_azione_data:document.getElementById('e-azione-data').value||null,
        note_preliminari:document.getElementById('e-note').value, drive_url:document.getElementById('e-drive').value,
        consenso_privacy:document.getElementById('e-consenso').checked,
      };
      const r = await fetch('/dashboard/clients/'+CID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const d = await r.json();
      if (d.error) { err.textContent=d.error; err.style.display='block'; return; }
      location.reload();
    }

    // ── Permessi a termine sugli strumenti ────
    // ── Proposta letta dai documenti ────────────────────────────────
    async function approvaBozza() {
      // si mandano i campi spuntati CON il valore che si legge nella casella:
      // se il coach l'ha corretto, vale la sua correzione
      const campi = [...document.querySelectorAll('.bz-campo:checked')].map(c => {
        const cassetta = document.querySelector('.bz-valore[data-campo="' + c.value + '"]');
        return { campo: c.value, valore: cassetta ? cassetta.value : null };
      });
      const cons = document.getElementById('bz-consenso');
      const err = document.getElementById('bz-error');
      err.style.display = 'none';
      const r = await fetch('/dashboard/clients/'+CID+'/bozza-anagrafica/approva', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ campi: campi, consenso: cons ? cons.checked : false })
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { err.textContent = d.error || 'Non sono riuscito ad approvare.'; err.style.display='block'; return; }
      if (d.avvisi && d.avvisi.length) { alert('Fatto, ma: ' + d.avvisi.join(' · ')); }
      location.reload();
    }
    async function scartaBozza() {
      ${/* ⚠️ apostrofo: qui siamo dentro una template literal, quindi va scritto
            \\' — con una barra sola sparisce e rompe TUTTO il JavaScript della
            pagina (è successo l'08/08: scheda cliente inerte, nessun pulsante
            rispondeva). Vedi la prova che ora controlla il JS renderizzato. */ ''}
      if (!confirm('Scarto quello che i documenti dicono? La scheda resta com\\'è.')) return;
      if (!await chiamaHub('/dashboard/clients/'+CID+'/bozza-anagrafica/scarta', { method:'POST' })) return;
      location.reload();
    }

    function openStrumento() {
      document.getElementById('perm-error').style.display = 'none';
      document.getElementById('modal-strumento').style.display = 'flex';
      aggiornaDurate();
    }
    // Cambiando la durata cambia la riga della scadenza nel testo della mail:
    // dire "fino alla prossima sessione" per un permesso di poche ore sarebbe
    // scrivere al cliente una cosa non vera.
    document.querySelectorAll('input[name="perm-durata"]').forEach(
      r => r.addEventListener('change', componiMail));
    // Il portale intero vale solo per la sessione di oggi: "fino alla prossima
    // sessione" ha senso per il compito su UN solo strumento, non per aprire tutto.
    // La scelta NON si nasconde quando non è disponibile — si spegne e resta
    // leggibile: nascosta sembrava che il programma fosse rotto.
    function aggiornaDurate() {
      const tool = document.getElementById('perm-tool').value;
      const r    = document.getElementById('perm-r-sessione');
      const lbl  = document.getElementById('perm-lbl-sessione');
      if (!r) return;
      // «Fino alla prossima sessione» vale per un solo strumento. La data può
      // mancare: in quel caso il permesso resta libero finché non la fissate,
      // quindi la scelta è comunque disponibile.
      const disponibile = !!tool;
      r.disabled = !disponibile;
      lbl.style.opacity = disponibile ? '1' : '0.45';
      if (!disponibile) document.querySelector('input[name="perm-durata"][value="ore"]').checked = true;
      // La mail si manda solo per uno strumento singolo, mai per il portale.
      document.getElementById('perm-mail').style.display = tool ? 'block' : 'none';
      document.getElementById('perm-btn-invia').style.display = tool ? 'block' : 'none';
      componiMail();
    }

    const PERM_MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio',
                       'agosto','settembre','ottobre','novembre','dicembre'];
    // "il 7 agosto" ma "l'8 agosto" e "l'11 agosto": davanti a otto e undici
    // l'articolo si apostrofa. Scritto male si nota, ed è una mail che legge un cliente.
    function permDataInLettere(iso) {
      const p = String(iso).split('-');
      const g = parseInt(p[2], 10);
      const art = (g === 8 || g === 11) ? "l'" : 'il ';
      return art + g + ' ' + PERM_MESI[parseInt(p[1], 10) - 1];
    }
    function componiMail() {
      const tool = document.getElementById('perm-tool').value;
      if (!tool) return;
      const durata = document.querySelector('input[name="perm-durata"]:checked').value;
      const nome = PERM_NOMI[tool] || tool;
      const link = PERM_BASE + '/tool/' + tool;
      let scadenza;
      if (durata !== 'sessione') {
        scadenza = 'Resta attivo per ' + PERM_ORE + ' ore da quando lo apri.';
      } else if (PERM_SCAD) {
        scadenza = 'Resta attivo fino alla nostra prossima sessione, ' + permDataInLettere(PERM_SCAD) + ', così lo guardiamo insieme.';
      } else {
        scadenza = 'Resta attivo fino alla nostra prossima sessione: appena fissiamo la data lo guardiamo insieme.';
      }
      document.getElementById('perm-subject').value = nome;
      document.getElementById('perm-body').value =
        'Ciao ' + PERM_NOME_CLIENTE + ',\\n\\n' +
        'qui sotto trovi il collegamento per lavorare sulla ' + nome +
        ': puoi aprirlo quando vuoi e riprenderlo più volte, quello che scrivi resta salvato.\\n' +
        scadenza + '\\n\\n' + link + '\\n\\nA presto,\\nGermano';
    }
    async function creaPermesso(conMail) {
      const tool   = document.getElementById('perm-tool').value;
      const durata = document.querySelector('input[name="perm-durata"]:checked').value;
      const err    = document.getElementById('perm-error');
      err.style.display = 'none';
      let email = null;
      if (conMail) {
        const to = document.getElementById('perm-to').value.trim();
        if (!to) { err.textContent = 'Manca l\\'indirizzo a cui mandare la mail.'; err.style.display = 'block'; return; }
        email = { to: to,
                  subject: document.getElementById('perm-subject').value,
                  body: document.getElementById('perm-body').value };
      }
      const r = await fetch('/dashboard/clients/'+CID+'/permessi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: tool || null, durata: durata, email: email })
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { err.textContent = d.error || 'Non sono riuscito a creare il permesso.'; err.style.display = 'block'; return; }
      if (d.avviso) { err.textContent = d.avviso; err.style.display = 'block'; }
      if (d.inviata) {
        const t = document.getElementById('toast');
        t.textContent = 'Mail inviata! Il permesso è aperto.';
        t.style.display = 'block';
        setTimeout(() => location.reload(), 1500);
        return;
      }
      if (d.avviso) return;
      // La copia automatica può essere bloccata dal browser (succede su Safari
      // quando fra il clic e la copia c\'è una chiamata al server): in quel caso
      // il link non si perde, si mostra e lo si copia a mano.
      try {
        await navigator.clipboard.writeText(d.link);
        const t = document.getElementById('toast');
        t.textContent = 'Link copiato! Il permesso è aperto.';
        t.style.display = 'block';
      } catch (e) {
        window.prompt('Ecco il link da mandare al cliente (copialo):', d.link);
      }
      setTimeout(() => location.reload(), 1200);
    }
    async function chiudiPermesso(id) {
      if (!confirm('Chiudo questo permesso? Da subito il cliente non potrà più aprirlo.')) return;
      if (!await chiamaHub('/dashboard/clients/'+CID+'/permessi/'+id+'/chiudi', { method: 'POST' })) return;
      location.reload();
    }
    async function deleteClient() {
      if (!confirm('Eliminare ${attr(client.name)} e tutti i suoi dati? Operazione irreversibile.')) return;
      if (!await chiamaHub('/dashboard/clients/'+CID,{method:'DELETE'})) return; location.href='/dashboard/individuali';
    }
    // Il prezzo è un campo solo che cambia significato con la modalità: qui si limita
    // a cambiare etichetta, e sparisce del tutto quando non c'è nessuna cifra da dire.
    function modalitaCambiata() {
      const m = document.getElementById('p-modalita').value;
      const box = document.getElementById('p-prezzo-box');
      const senzaPrezzo = (m === 'Scambio servizi' || m === 'Pro bono');
      box.style.display = senzaPrezzo ? 'none' : '';
      // La prestazione in cambio esiste in una modalità sola: comparire altrove
      // vorrebbe dire invitare a scrivere un dato che nessun contratto stamperà.
      document.getElementById('p-scambio-box').style.display = (m === 'Scambio servizi') ? '' : 'none';
      if (!senzaPrezzo) {
        document.getElementById('p-prezzo-label').textContent =
          (m === 'Pacchetto') ? 'Prezzo del pacchetto (€)' : 'Prezzo a sessione (€)';
        document.getElementById('p-prezzo').placeholder = (m === 'Pacchetto') ? 'es. 900' : 'es. 150';
      }
      // Le rate esistono SOLO nel Pacchetto: negli altri casi non se ne parla,
      // perche' invitare a dividere in rate una cifra che non c'e' e' peggio che tacere.
      const pbox = document.getElementById('p-piano-box');
      const pid  = document.getElementById('p-id').value;
      const dati = pid ? PERCORSI_DATI[pid] : null;
      if (m !== 'Pacchetto') { pbox.style.display = 'none'; return; }
      pbox.style.display = '';
      const btn = document.getElementById('p-piano-btn');
      const testo = document.getElementById('p-piano-testo');
      if (!pid) {
        btn.style.display = 'none';
        testo.innerHTML = '💶 <strong>Le rate si scrivono subito dopo:</strong> appena salvi, si apre da sola la finestrella del piano, col prezzo gia\\' dentro.';
      } else if (dati && dati.nRate > 0) {
        btn.style.display = '';
        testo.innerHTML = '💶 Piano dei pagamenti: <strong>' + dati.nRate + (dati.nRate === 1 ? ' rata' : ' rate') + '</strong>.';
      } else {
        btn.style.display = '';
        testo.innerHTML = '💶 <strong>Nessun piano dei pagamenti.</strong> Senza, il contratto non nominera\\' nessuna rata.';
      }
    }
    // Apre la finestrella del piano da QUI, senza chiudere niente a mano: e' la
    // stessa di Amministrazione, non una seconda.
    function apriPianoDaPercorso() {
      const pid = document.getElementById('p-id').value;
      if (!pid) return;
      document.getElementById('modal-percorso').style.display = 'none';
      apriPianoPacchetto(pid);
    }
    function openPercorso() {
      document.getElementById('p-titolo').textContent = 'Nuovo percorso';
      document.getElementById('p-id').value = '';
      document.getElementById('p-tipo').value = 'Individuale';
      document.getElementById('p-modalita').value = 'Standard';
      document.getElementById('p-sessioni').value = 8;
      document.getElementById('p-prezzo').value = '';
      document.getElementById('p-scambio').value = '';
      document.getElementById('p-ore').value = 0;
      document.getElementById('p-promo').checked = false;
      document.getElementById('p-sconto').value = '';
      document.getElementById('p-data').value = '';
      document.getElementById('p-ore-box').style.display = '';
      if (document.getElementById('p-progetto')) document.getElementById('p-progetto').parentElement.style.display = '';
      modalitaCambiata();
      document.getElementById('modal-percorso').style.display='flex';
    }
    function editPercorso(pid) {
      const p = PERCORSI_DATI[pid];
      if (!p) { alert('Percorso non trovato: ricarica la pagina.'); return; }
      document.getElementById('p-titolo').textContent = 'Modifica percorso';
      document.getElementById('p-id').value = p.id;
      document.getElementById('p-tipo').value = p.tipo;
      document.getElementById('p-modalita').value = p.modalita;
      document.getElementById('p-sessioni').value = p.n_sessioni_previste;
      document.getElementById('p-prezzo').value = p.prezzo;
      document.getElementById('p-scambio').value = p.prestazione_scambio || '';
      document.getElementById('p-promo').checked = p.promo;
      document.getElementById('p-sconto').value = p.sconto_note;
      document.getElementById('p-data').value = p.data_inizio;
      // Ore già svolte e progetto non si toccano in modifica: le ore le ricalcolano le
      // sedute, e spostare un percorso di progetto è un'altra cosa dal correggere il prezzo.
      document.getElementById('p-ore-box').style.display = 'none';
      if (document.getElementById('p-progetto')) document.getElementById('p-progetto').parentElement.style.display = 'none';
      modalitaCambiata();
      document.getElementById('modal-percorso').style.display='flex';
    }
    async function savePercorso() {
      const pid = document.getElementById('p-id').value;
      const modalita = document.getElementById('p-modalita').value;
      const dati = {
        tipo: document.getElementById('p-tipo').value,
        modalita,
        n_sessioni_previste: document.getElementById('p-sessioni').value || 8,
        prezzo: document.getElementById('p-prezzo').value || null,
        prestazione_scambio: document.getElementById('p-scambio').value || null,
        promo: document.getElementById('p-promo').checked,
        sconto_note: document.getElementById('p-sconto').value,
        data_inizio: document.getElementById('p-data').value || null,
      };
      if (!pid) {
        dati.ore_fatte = document.getElementById('p-ore').value || 0;
        dati.progetto_id = (document.getElementById('p-progetto') ? document.getElementById('p-progetto').value : '') || null;
      }
      const url = '/dashboard/clients/'+CID+'/percorsi' + (pid ? '/'+pid : '');
      const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dati)});
      const d = await r.json().catch(()=>({}));
      if (d && d.error) { alert(d.error); return; }
      if (d && d.driveWarning) alert(d.driveWarning);
      // ⭐ Salvato un PACCHETTO, il piano delle rate si apre da solo. La pagina
      //    deve ricaricarsi comunque (il percorso nuovo non e' ancora nei dati
      //    del browser), quindi il compito si passa all'indirizzo: al
      //    ricaricamento chi trova «?piano=…» apre la finestrella.
      const idPiano = pid || (d && d.id);
      if (modalita === 'Pacchetto' && idPiano) {
        location.href = location.pathname + '?piano=' + encodeURIComponent(idPiano);
        return;
      }
      location.reload();
    }
    async function chiudiPercorso(pid, fineIso, fineIt) {
      const msg = fineIso
        ? ("Chiudere questo percorso? La data di fine sarà " + fineIt + ", il giorno dell'ultima sessione.")
        : 'Chiudere questo percorso? Non ci sono sessioni registrate, quindi la data di fine sarà oggi.';
      if(!confirm(msg)) return;
      if (!await chiamaHub('/dashboard/clients/'+CID+'/percorsi/'+pid+'/chiudi',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_fine: fineIso || null})})) return;
      location.reload();
    }
    async function delPercorso(pid) {
      if(!confirm('Eliminare questo percorso? Le sue ore spariscono dall\\'estratto ICF. Operazione irreversibile.')) return;
      if (!await chiamaHub('/dashboard/clients/'+CID+'/percorsi/'+pid,{method:'DELETE'})) return; location.reload();
    }
    // ⛔ 15/08 — tolte openPayment/savePayment/segnaRicevuto/deletePayment
    // insieme al pulsante «+ Pagamento» e alla sua finestrella. Lasciare
    // funzioni che nessuno chiama e' esattamente la trappola del 10/08 (il finto
    // pulsante "Aggiungi sessione"): chi legge il codice crede che la funzione
    // ci sia. Le rotte del server restano e si tolgono con la pulizia del
    // codice morto, portando la prova che nessuno le chiama.
    // Crea la proforma con TUTTO il maturato non ancora chiesto. Il numero non
    // si riusa mai, quindi prima si chiede conferma: un documento nato per
    // sbaglio brucia un numero e resta nell'elenco.
    async function chiediPagamento() {
      if(!confirm('Creo la proforma con tutte le sessioni non ancora chieste?\\n\\nIl numero che le viene assegnato non potrà essere riusato.')) return;
      var btn = document.getElementById('pf-btn'), err = document.getElementById('pf-error');
      btn.disabled = true; btn.textContent = 'Preparo il documento…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/clients/'+CID+'/proforma', { method:'POST' });
        var d = await r.json();
        if(!r.ok) throw new Error(d.error || 'Errore nella creazione della proforma');
        // 18/08 — niente scheda nuova: l'id viaggia e la finestrella si apre da
        // sola dopo la ricarica (vedi jsModalePdf).
        try { sessionStorage.setItem('pdf-appena-nata',
          JSON.stringify({ id: d.id, titolo: 'Proforma n. ' + d.numero })); } catch(e) {}
        location.reload();
      } catch(ex) {
        err.textContent = ex.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Chiedi il pagamento';
      }
    }
    ${/* ⚠️ `chiediRata()` NON si riscrive qui: la porta piano-ui.js, insieme alla
          finestrella del piano, ed è disponibile ogni volta che c'è una cifra
          concordata — cioè ogni volta che esistono delle rate da chiedere.
          Averla in due punti vorrebbe dire due versioni della stessa conferma. */ ''}
    // Cliccando fuori, la finestrella si chiude. ⚠️ Si SALTA quello che non c'e:
    // alcune finestrelle compaiono solo in certe schede (il piano solo se c'e una
    // cifra concordata) e una di queste e stata tolta il 15/08. Senza il filtro,
    // un getElementById che torna null fa fallire tutto il blocco.
    [document.getElementById('modal-edit'),document.getElementById('modal-percorso'),document.getElementById('modal-seduta'),document.getElementById('modal-piano'),document.getElementById('modal-incasso')]
      .filter(Boolean).forEach(m=>{
        m.addEventListener('click',e=>{ if(e.target===m) m.style.display='none'; });
      });

    // ⭐ IL SEGUITO DEL SALVATAGGIO DI UN PACCHETTO: «savePercorso» ricarica la
    //    pagina su «?piano=…», e qui si raccoglie il testimone aprendo la
    //    finestrella delle rate. Cosi' per Germano e' un gesto solo: salva il
    //    percorso, gli si chiede subito come si paga.
    // ⚠️ L'indirizzo si ripulisce, altrimenti ogni ricaricamento successivo
    //    riaprirebbe la finestrella — e un F5 che rifa' sempre la stessa cosa
    //    e' il modo piu' rapido per far odiare una funzione utile.
    (function () {
      var q = new URLSearchParams(location.search).get('piano');
      if (!q) return;
      history.replaceState(null, '', location.pathname);
      if (typeof apriPianoPacchetto === 'function') apriPianoPacchetto(q);
    })();
  </script>
  </body></html>`;
}

// ── Estratto ICF: tabella percorsi + riepilogo, con download CSV. ──
// Pagina dei risultati di ricerca (fase 1c). Sola lettura: ogni risultato è un
// link alla sua scheda, nessun pulsante che agisca.
// NIENTE blocco di script qui dentro, di proposito: senza JS inline non c'è il rischio
// degli apostrofi dentro il template literal, e la pagina non ha nulla da fare
// nel browser. Committenti e Lead non hanno una scheda propria nell'Hub: il
// risultato mostra i loro dati sul posto e porta al rispettivo elenco.
function cercaPage(q, ris, req) {
  // il conteggio dice anche quando la lista è tagliata: un "30" muto farebbe
  // credere che siano tutti (il limite delle query è 30 per gruppo)
  const testa = (t, n) => `<div style="display:flex;align-items:baseline;gap:8px;margin:22px 0 8px">
      <h2 style="margin:0">${t}</h2><span style="font-size:12px;color:#aaa">${n >= 30 ? 'primi 30 — restringi la ricerca' : n}</span></div>`;
  const riga = (titolo, href, sotto, badge) => `<div class="ce-riga">
      <div style="min-width:0">
        ${href ? `<a href="${href}" class="ce-nome">${titolo}</a>` : `<span class="ce-nome">${titolo}</span>`}
        ${sotto ? `<div class="ce-sotto">${sotto}</div>` : ''}
      </div>
      ${badge || ''}
    </div>`;
  const pezzi = (...v) => v.filter(Boolean).join(' · ');
  // nome e cognome di una persona si uniscono con uno SPAZIO, non col puntino
  // che separa le informazioni: altrimenti si legge "Marco · Bianchi"
  const nomeCognome = (n, c) => [n, c].filter(Boolean).join(' ');

  let corpo;
  if (!q) {
    corpo = `<div class="card"><p style="color:var(--muted);font-size:13.5px;margin:0">
      Scrivi un nome nella casella qui sopra e premi Invio. Si cercano <strong>clienti</strong>, <strong>committenti</strong>, <strong>progetti</strong> e <strong>lead</strong>.</p></div>`;
  } else if (ris && ris.errore) {
    corpo = `<div class="card"><p style="color:#c0392b;font-size:13.5px;margin:0">La ricerca non è riuscita. Riprova fra un momento.</p></div>`;
  } else {
    const { clienti, committenti, progetti, leads } = ris;
    const totale = clienti.length + committenti.length + progetti.length + leads.length;
    if (!totale) {
      corpo = `<div class="card"><p style="color:var(--muted);font-size:13.5px;margin:0">
        Nessun risultato per <strong>${esc(q)}</strong>.<br>
        <span style="font-size:12.5px">Si cercano i nomi di clienti, committenti, progetti e lead — non il contenuto di sessioni, report o note.</span></p></div>`;
    } else {
      corpo = `
      ${clienti.length ? testa('Clienti', clienti.length) + `<div class="card ce-card">${clienti.map(c => riga(
        esc(c.name || nomeCognome(c.nome, c.cognome) || '—'),
        `/dashboard/clients/${c.id}`,
        pezzi(c.area ? esc(c.area) : '', c.societa ? esc(c.societa) : '', c.email ? esc(c.email) : ''),
        c.stato_cliente ? `<span class="badge">${esc(c.stato_cliente)}</span>` : ''
      )).join('')}</div>` : ''}

      ${committenti.length ? testa('Committenti', committenti.length) + `<div class="card ce-card">${committenti.map(k => riga(
        esc(k.denominazione),
        null,
        pezzi(k.referente ? esc(k.referente) + (k.ruolo ? ' — ' + esc(k.ruolo) : '') : '', k.email ? esc(k.email) : '', k.telefono ? esc(k.telefono) : ''),
        `<a href="/dashboard/committenti" class="ce-vai">Elenco Committenti ↗</a>`
      )).join('')}</div>` : ''}

      ${progetti.length ? testa('Progetti Strutturati', progetti.length) + `<div class="card ce-card">${progetti.map(p => riga(
        esc(p.titolo),
        `/dashboard/progetti/${p.id}`,
        pezzi(esc(p.denominazione), p.area ? esc(p.area) : ''),
        p.stato ? `<span class="badge">${esc(p.stato)}</span>` : ''
      )).join('')}</div>` : ''}

      ${leads.length ? testa('Lead', leads.length) + `<div class="card ce-card">${leads.map(l => riga(
        esc(nomeCognome(l.nome, l.cognome) || '—'),
        null,
        pezzi(l.email ? esc(l.email) : '', l.telefono ? esc(l.telefono) : ''),
        `<a href="/dashboard/leads" class="ce-vai">Elenco Lead ↗</a>`
      )).join('')}</div>` : ''}`;
    }
  }

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Ricerca</title>${baseStyle()}
  <style>
    .ce-card { padding: 4px 0; }
    .ce-riga { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 20px; border-bottom: 1px solid #f1f3f6; }
    .ce-riga:last-child { border-bottom: none; }
    .ce-nome { font-size: 14px; font-weight: 700; color: var(--ink); text-decoration: none; }
    a.ce-nome:hover { color: var(--blue); text-decoration: underline; }
    .ce-sotto { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .ce-vai { font-size: 12px; color: var(--muted); text-decoration: none; white-space: nowrap; }
    .ce-vai:hover { color: var(--blue); }
  </style></head><body>
  ${headerNoesys({ q })}
  <div class="container">
    <h1>Ricerca</h1>
    ${q ? `<p style="color:#aaa;font-size:13px">Risultati per <strong style="color:var(--ink)">${esc(q)}</strong></p>` : ''}
    ${corpo}
  </div>
  </body></html>`;
}

function icfPage(rows, tot, clientiUnici, req) {
  const body = rows.length === 0
    ? `<tr><td colspan="9" class="empty">Nessun percorso registrato. I percorsi si aggiungono dalla scheda cliente.</td></tr>`
    : rows.map(r => `<tr>
        <td><strong>${esc(r.client_name)}</strong></td>
        <td style="font-size:12px;color:#aaa">${esc(r.email || r.telefono || '—')}</td>
        <td style="font-size:12px">${esc(r.tipo || 'Individuale')}</td>
        <td style="font-size:12px">${esc(r.modalita || 'Standard')}</td>
        <td style="font-size:12px">${r.data_inizio ? itDate(r.data_inizio) : '<span style="color:#ccc">—</span>'}</td>
        <td style="font-size:12px">${r.data_fine ? itDate(r.data_fine) : '<span style="color:#ccc">in corso</span>'}</td>
        <td style="text-align:right">${fmtOre(r.pagate)}</td>
        <td style="text-align:right;color:#7a5c00">${r.proBono ? fmtOre(r.proBono) : '<span style="color:#ccc">—</span>'}</td>
        <td style="text-align:right"><strong>${fmtOre(r.ore)}</strong></td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Estratto ICF</title>${baseStyle()}</head><body>
  ${headerNoesys({ briciole: [{ label: 'Estratto ICF' }] })}
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:12px">
      <div><h1>Estratto ICF</h1><p style="color:#aaa;font-size:13px">Log ore di coaching per la certificazione</p></div>
      <a href="/dashboard/icf/export.csv" class="btn btn-gold">⬇ Scarica CSV (Excel)</a>
    </div>
    <p style="color:var(--muted);font-size:12px;margin-bottom:18px;line-height:1.5">
      Le ore contano come <strong>pagate</strong> salvo la modalità <strong>Pro bono</strong>. Lo <em>Scambio servizi</em> vale come pagato ai fini ICF.
      Le ore si aggiornano dalla scheda di ogni cliente (campo “ore svolte” del percorso).
    </p>

    <div class="card" style="padding:0;overflow-x:auto">
      <table>
        <thead><tr>
          <th>Cliente</th><th>Contatto</th><th>Tipo</th><th>Modalità</th>
          <th>Inizio</th><th>Fine</th>
          <th style="text-align:right">Pagate</th><th style="text-align:right">Pro bono</th><th style="text-align:right">Totale</th>
        </tr></thead>
        <tbody>${body}</tbody>
        ${rows.length ? `<tfoot><tr style="background:#f7f9fb;font-weight:700">
          <td colspan="6" style="border-top:2px solid var(--line)">Totale</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.pagate)}</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.proBono)}</td>
          <td style="text-align:right;border-top:2px solid var(--line)">${fmtOre(tot.ore)}</td>
        </tr></tfoot>` : ''}
      </table>
    </div>

    ${rows.length ? `<div class="card" style="display:flex;gap:26px;flex-wrap:wrap">
      <div><div class="field-label">Clienti</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${clientiUnici}</div></div>
      <div><div class="field-label">Percorsi</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${rows.length}</div></div>
      <div><div class="field-label">Ore totali</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${fmtOre(tot.ore)}</div></div>
      <div><div class="field-label">Individuali</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--green)">${fmtOre(tot.indivOre)}<span style="font-size:13px;color:#aaa"> · ${tot.indivN}</span></div></div>
      <div><div class="field-label">Gruppo</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--green)">${fmtOre(tot.gruppoOre)}<span style="font-size:13px;color:#aaa"> · ${tot.gruppoN}</span></div></div>
      <div><div class="field-label">Pagate / Pro bono</div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--blue)">${fmtOre(tot.pagate)}<span style="font-size:15px;color:#aaa"> / ${fmtOre(tot.proBono)}</span></div></div>
    </div>` : ''}
  </div>
  </body></html>`;
}

module.exports = { loginPage, dashboardPage, driveDiagPage, clientDetailPage, cercaPage, icfPage };
