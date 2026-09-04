/**
 * LA HOME — la giornata del coach: le tre porte e «Chiede attenzione».
 * Fetta 4.1 del riordino (04/09/2026): spostato da routes.js così com'era.
 */
const { logoPicto } = require('../logo');
const appuntamenti = require('../appuntamenti');
const collaudo = require('../collaudo');
const documenti = require('../documenti');
const fiscale = require('../fiscale');
const incassi = require('../incassi');
const paginaJs = require('../pagina-js');
const proforma = require('../proforma');
const { baseStyle, esc, headerNoesys, itDate, itDateTime, jsStr, meseEsteso } = require('./comune');

// ═══════════════════════════════════════════════════════
// HOME — tre porte sul pittogramma + cosa chiede attenzione
// ═══════════════════════════════════════════════════════
function homePage(d, req) {
  const porta = (href, nome, num, unita, desc) => `
    <a class="hm-porta" href="${href}">
      <span class="hm-porta-nome">${nome}</span>
      <span class="hm-porta-num">${num}</span>
      <span class="hm-porta-unita">${unita}</span>
      <span class="hm-porta-desc">${desc}</span>
    </a>`;

  // Un gruppo compare SOLO se ha qualcosa dentro: una home che elenca caselle
  // vuote è rumore.
  const gruppo = (titolo, voci) => voci.length ? `
    <div class="hm-gruppo">
      <div class="hm-gruppo-nome">${titolo}</div>
      ${voci.join('')}
    </div>` : '';
  const voce = (href, testo, coda) => `
    <a class="hm-voce" href="${href}"><span>${testo}</span><span class="hm-voce-coda">${coda || ''}</span></a>`;

  // Il prossimo appuntamento di ogni percorso, come lo dice il report dell'ultima
  // sessione. Sta per primo perché è la cosa che si guarda per prima. Quando la
  // data è passata la riga non c'è più: il gruppo si mostra solo se ha voci.
  // L'ora c'è solo se il report la diceva: senza, resta la sola data (meglio di
  // un orario inventato).
  // ⭐ Dal 12/08 ogni riga ha la sua matita: l'appuntamento si sposta da QUI,
  // che è il posto dove Germano lo guarda, senza aprire la scheda e senza
  // toccare il verbale della sessione da cui era nato.
  // ⚠️ Non si può usare `voce()`: quella è un <a>, e un pulsante dentro un
  // collegamento è marcato sbagliato (e il clic finirebbe sul collegamento).
  // Qui la riga è un contenitore, col nome che resta un collegamento.
  const gAppuntamenti = gruppo('Prossimi appuntamenti', d.appuntamenti.map(a => `
    <div class="hm-voce">
      <span><a href="/dashboard/clients/${a.client_id}" style="text-decoration:none;color:inherit">${esc(a.name)}</a></span>
      <span class="hm-voce-coda">
        ${itDate(a.scad)}${a.ora ? ` · <strong style="color:var(--ink)">${esc(a.ora)}</strong>` : ''}
        <button onclick="apriApp('${a.percorso_id}',${jsStr(a.name)},'${a.scad || ''}',${jsStr(a.ora || '')})"
                class="btn btn-neutral btn-sm" style="margin-left:8px" title="Sposta l'appuntamento">✎</button>
      </span>
    </div>`));

  const gBozze = gruppo('Sessioni in bozza da approvare', d.bozze.map(b => voce(
    b.client_id ? `/dashboard/clients/${b.client_id}` : (b.progetto_id ? `/dashboard/progetti/${b.progetto_id}` : '/dashboard/individuali'),
    b.cliente ? esc(b.cliente) : (b.progetto ? esc(b.progetto) + ' <span style="color:var(--hint)">· percorso di gruppo</span>' : 'Sessione'),
    b.data ? itDate(b.data) : '')));

  const gChiudere = gruppo('Percorsi da chiudere', d.daChiudere.map(x => voce(
    `/dashboard/clients/${x.id}`, esc(x.name),
    'relazione conclusa, ' + (x.n === 1 ? 'percorso ancora attivo' : x.n + ' percorsi ancora attivi'))));

  const gAzioni = gruppo('Prossime azioni', d.azioni.map(a => voce(
    `/dashboard/clients/${a.id}`, `<strong>${esc(a.name)}</strong> — ${esc(a.prossima_azione)}`,
    a.prossima_azione_data ? itDate(a.prossima_azione_data) : '')));

  const gLead = gruppo('Lead da ricontattare', d.richiami.map(l => voce(
    '/dashboard/leads', esc([l.nome, l.cognome].filter(Boolean).join(' ')),
    l.data_prossimo_contatto ? itDate(l.data_prossimo_contatto) : '')));

  // Proposte lette dai documenti, in attesa che il coach le guardi.
  const gAnagrafiche = gruppo('Dati letti dai documenti, da controllare', d.anagrafiche.map(a => voce(
    `/dashboard/clients/${a.id}`, esc(a.name),
    a.n === 1 ? '1 dato' : a.n + ' dati')));

  // ⭐ I pagamenti da chiedere (Fase 3, Tappa 3). Sta in cima perché è l'unico
  // gruppo che riguarda dei soldi, e perché l'amministrazione è la cosa che
  // Germano rimanda più volentieri: se non gliela mette davanti l'Hub, non se la
  // ricorda nessuno.
  // Una riga per PERSONA, non per mese e non per tipo di problema (regola
  // dell'11/08): si apre quella scheda e si sistema tutto lì.
  // Le BOZZE stanno nella riga della persona a cui appartengono, e chi ha SOLO
  // bozze compare lo stesso: una sessione non approvata non matura, quindi
  // resterebbe fuori dalla proforma senza che nessuno lo dica.
  const gDaChiedere = gruppo('Pagamenti da chiedere', (d.pagamentiDaChiedere || []).map(c => {
    // Chi ha solo bozze non ha mesi maturati: il mese lo dicono le bozze stesse,
    // altrimenti la riga direbbe un nome e basta.
    const mesi = (c.n ? c.mesi.map(m => m.mese) : c.bozze.map(b => b.mese))
      .map(meseEsteso).join(' · ');
    const bozze = c.nBozze
      ? `<span style="color:#8a6d1e"> · ${c.nBozze === 1 ? '1 sessione ancora in bozza' : c.nBozze + ' sessioni ancora in bozza'}</span>`
      : '';
    const coda = c.n
      ? `<strong style="color:var(--ink)">€ ${fiscale.euro(c.importo)}</strong>`
      : 'da approvare';
    return voce(`/dashboard/clients/${c.id}`,
      `${esc(c.name)} ${collaudo.badge(c.di_collaudo)} <span style="color:var(--hint);text-transform:capitalize">${mesi}</span>${bozze}`,
      coda);
  }));

  // ⭐ Le proforma ferme (13/08). Stanno SOPRA i pagamenti da chiedere perché
  // sono più avanti nella catena: il documento c'è già, manca solo mandarlo —
  // ed è il passo che costa meno e vale di più.
  // Il collegamento porta ad Amministrazione → Proforma e non alla scheda del
  // cliente: è lì che stanno le due azioni («apri il PDF» e «Rivedi e manda»),
  // e una riga che chiede di fare una cosa deve portare dove la si fa.
  // Da GIORNI_FERMA in su la riga alza la voce (Germano, 13/08: 7 giorni).
  const gFerme = gruppo('Proforma da mandare', (d.proformeFerme || []).map(p => {
    const insiste = p.giorni !== null && p.giorni >= proforma.GIORNI_FERMA;
    const quanto  = proforma.daQuantoFerma(p.giorni);
    return voce('/dashboard/amministrazione/proforma',
      `${esc(p.cliente || 'Destinatario cancellato')} ${collaudo.badge(p.di_collaudo)} <span style="color:var(--hint)">· ${esc(p.numero)}</span>`,
      `<span style="color:${insiste ? '#a4342a' : 'var(--hint)'};${insiste ? 'font-weight:700' : ''}">${quanto}</span>
       <strong style="color:var(--ink);margin-left:10px">€ ${fiscale.euro(p.da_pagare)}</strong>`);
  }));

  // ⭐ C4b — «Verifica se è arrivato» (18/08). Sta SOPRA le proforma da mandare
  // perché è ancora più avanti nella catena: quel documento è già partito, i
  // soldi dovevano già esserci, e l'unica cosa che l'Hub non può sapere da solo
  // è se sono arrivati davvero — la banca non la vede.
  // La riga porta ad Amministrazione → Proforma, dove sta il pulsante «È
  // arrivato» col suo contesto (quanto manca, gli acconti già registrati): una
  // riga che chiede di fare una cosa porta dove la si fa, come le altre qui.
  // Da GIORNI_INSISTE in su alza la voce, come le proforma ferme.
  const gVerificare = gruppo('Verifica se è arrivato', (d.incassiDaVerificare || []).map(p => {
    const insiste = p.giorni !== null && p.giorni >= incassi.GIORNI_INSISTE;
    const quanto  = incassi.daQuantoScaduta(p.giorni);
    // Un acconto non fa sparire la riga: la fa dire quanto manca ancora.
    const parziale = p.acconto > 0
      ? `<span style="color:var(--hint)"> · acconto di € ${fiscale.euro(p.acconto)} ricevuto</span>` : '';
    return voce('/dashboard/amministrazione/proforma',
      `${esc(p.cliente || 'Destinatario cancellato')} ${collaudo.badge(p.di_collaudo)} <span style="color:var(--hint)">· ${esc(p.numero)}</span>${parziale}`,
      `<span style="color:${insiste ? '#a4342a' : 'var(--hint)'};${insiste ? 'font-weight:700' : ''}">${quanto}</span>
       <strong style="color:var(--ink);margin-left:10px">€ ${fiscale.euro(p.manca)}</strong>`);
  }));

  // Documentazione che manca, SOLO sui percorsi attivi (scelta di Germano 08/08).
  // I due casi restano distinti perché l'azione è diversa: «non arrivata» aspetta
  // il cliente, «ancora in bianco» aspetta il coach — è il caso di chi compila su
  // carta e va scansionato.
  const gDocumenti = gruppo('Documentazione da completare', d.documenti.map(x => voce(
    `/dashboard/clients/${x.id}`, esc(x.name), x.stato)));

  // ⭐ Fetta 2.2 — «L'automazione non è riuscita a…». Ogni voce ha un nome e una
  //    cosa da fare (rinominare un file, controllare un link). Il gruppo compare
  //    solo se c'è qualcosa da dire; sotto, in piccolo, quando è passata l'ultima.
  const au = d.automazione || { voci: [], ultima: null };
  const gAutomazione = gruppo('L\'automazione non è riuscita a…', au.voci.map(v =>
    `<div class="hm-voce" style="cursor:default"><span style="color:${v.grave ? '#a4342a' : 'var(--muted)'}">${esc(v.testo)}</span></div>`));

  const attenzione = [gAppuntamenti, gVerificare, gFerme, gDaChiedere, gAutomazione, gBozze, gAnagrafiche, gChiudere, gDocumenti, gAzioni, gLead].filter(Boolean).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Noesys Hub</title>${baseStyle()}</head><body>
  ${headerNoesys({})}
  <div class="hm-picto">${logoPicto(1080)}</div>
  <div class="container" style="position:relative;z-index:1">

    <section class="hm-hero">
      <div class="hm-porte">
        ${porta('/dashboard/individuali', 'Percorsi Individuali', d.nIndividuali,
                d.nIndividuali === 1 ? 'cliente' : 'clienti',
                'Le persone che segui una per una: paga il cliente.')}
        ${porta('/dashboard/progetti', 'Progetti Strutturati', d.nProgetti,
                d.nProgetti === 1 ? 'progetto' : 'progetti',
                `Commissionati da un committente${d.nCommittenti ? ` · ${d.nCommittenti} ${d.nCommittenti === 1 ? 'committente' : 'committenti'}` : ''}.`)}
        ${porta('/dashboard/leads', 'Lead', d.nLeadAperti,
                d.nLeadAperti === 1 ? 'da coltivare' : 'da coltivare',
                'Chi ti ha contattato e non è ancora un cliente.')}
      </div>
      ${/* ⚗️ Fetta 1.4: chi è tenuto fuori dai tre numeri, e chi non è ancora classificato. */ ''}
      ${collaudo.cartello(d.classificazione || { collaudo: {}, nonClassificati: {} })}
    </section>

    <section class="hm-att">
      <h2 style="margin-bottom:14px">Chiede attenzione</h2>
      ${attenzione || `<div class="card" style="color:var(--muted);font-size:13px">Non c'è nulla in sospeso: nessuna bozza da approvare, nessun percorso da chiudere, nessun richiamo in scadenza.</div>`}
      <div id="ultima-passata" style="font-size:11.5px;color:var(--hint);margin-top:8px">${au.ultima
        ? `⏱ L'automazione (report e moduli da Drive) è passata l'ultima volta il ${itDateTime(au.ultima)}.`
        : '⏱ L\'automazione (report e moduli da Drive) non ha ancora lasciato traccia di una passata.'}</div>
    </section>

  </div>

  ${/* La finestrella dell'appuntamento: tre righe e due pulsanti. Deve restare
        piccola — si apre per spostare un incontro, non per compilare una scheda. */ ''}
  ${/* 🔴 18/08 — era class="modal", che NEL CSS NON ESISTE: niente sfondo bianco,
        niente cornice, niente ombra — restavano i campi nudi sopra la pagina. È
        il difetto che Germano aveva segnalato il 17/08 sulla finestrella
        «Rivedi e manda», e la causa era la stessa qui. La classe giusta è «.modal-box». */ ''}
  <div id="modal-app" class="modal-overlay">
    <div class="modal-box" style="max-width:420px">
      <h2 style="margin-bottom:4px">Sposta l'appuntamento</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px"><span id="ap-chi"></span></p>
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:12px">
        <div class="form-group"><label>Data</label><input id="ap-data" type="date"></div>
        <div class="form-group"><label>Ora</label><input id="ap-ora" type="time"></div>
      </div>
      <p style="color:var(--hint);font-size:12px;margin-bottom:14px">
        Quello che scrivi qui non tocca i report: resta scritto finché non arriva
        il report di una sessione più recente.
      </p>
      <div id="ap-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button onclick="document.getElementById('modal-app').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="ap-salva" onclick="salvaApp()" class="btn btn-primary" style="flex:1">Salva</button>
      </div>
      <button onclick="togliApp()" class="btn btn-danger btn-sm" style="width:100%;margin-top:10px">Elimina l'appuntamento</button>
    </div>
  </div>

  <script>
    var appPercorso = null;
    ${paginaJs.appuntamento({ conChi: true, confermaTogli: "Elimino l'appuntamento?\n\nSparisce dai promemoria. Ne potrai segnare uno nuovo dalla scheda del cliente." })}
  </script>
  </body></html>`;
}

module.exports = { homePage };
