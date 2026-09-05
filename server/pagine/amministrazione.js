/**
 * L'AMMINISTRAZIONE — anomalie, proforma, contratti, chi emette.
 * Fetta 4.1 del riordino (04/09/2026): spostato da routes.js così com'era.
 */
const collaudo = require('../collaudo');
const contrattiStato = require('../contratti-stato');
const contratto = require('../contratto');
const fiscale = require('../fiscale');
const incassi = require('../incassi');
const pianoUi = require('../piano-ui');
const proforma = require('../proforma');
const { amNav, attr, baseStyle, esc, headerNoesys, itDate, itDateTime, jsModalePdf, jsStr, meseEsteso, modalePdf } = require('./comune');

function anomaliePage(anomalie, conteggi, req) {
  const RUOLO = {
    cliente:     { label: 'Cliente',     bg: '#e8f4fd', color: '#1A5280', href: a => `/dashboard/clients/${a.id}` },
    committente: { label: 'Committente', bg: '#e7f1ec', color: '#2e6b52', href: () => '/dashboard/committenti' },
    progetto:    { label: 'Progetto',    bg: '#fdf6e3', color: '#8a6d1a', href: a => `/dashboard/progetti/${a.id}` },
  };

  // Un riquadro per SOGGETTO, con dentro tutti i suoi problemi (scelta di
  // Germano, 11/08): si apre la scheda di quella persona e si sistema tutto in
  // una volta, invece di ritrovare lo stesso nome in due riquadri diversi.
  const gruppi = fiscale.anomaliePerSoggetto(anomalie);

  const gruppiHtml = gruppi.map(g => {
    const r = RUOLO[g.ruolo];
    return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line);background:#fdfcf7">
        <span class="badge" style="background:${r.bg};color:${r.color}">${r.label}</span>
        <a href="${r.href(g)}" style="font-size:16px;font-weight:700;color:var(--blue);text-decoration:none">${esc(g.nome || '(senza nome)')}</a> ${collaudo.badge(g.collaudo)}
        <span style="font-size:12px;color:var(--hint);margin-left:auto">${g.voci.length} ${g.voci.length === 1 ? 'cosa da sistemare' : 'cose da sistemare'}</span>
      </div>
      ${g.voci.map(v => `
        <div style="padding:13px 18px;border-bottom:1px solid #f1f3f6">
          <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:3px">${esc(v.titolo)}</div>
          <div style="font-size:14px;color:#4A4A4A">${esc(v.messaggio)}</div>
        </div>`).join('')}
      <div style="padding:12px 18px">
        <a href="${r.href(g)}" class="btn btn-neutral btn-sm">Apri la scheda →</a>
      </div>
    </div>`;
  }).join('');

  const vuoto = `
    <div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7">
      <strong style="color:#2e6b52;font-size:15px">✅ Niente da sistemare.</strong>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">
        Tutti i clienti e i committenti con qualcosa da fatturare hanno i dati completi,
        e le quote dei progetti tornano.
      </div>
    </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Amministrazione</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione', sub: 'anomalie' })}
  <div class="container">
    <h1>Amministrazione</h1>
    ${amNav('anomalie')}
    <h2 style="margin-bottom:4px">Anomalie</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:6px">
      Quello che va sistemato <strong>prima</strong> di emettere una fattura.
    </p>
    <p style="color:var(--hint);font-size:12px;margin-bottom:20px">
      ${/* Detto in chiaro: qui non c'è tutto l'Hub. Chi non ha soldi in ballo non
            viene controllato, ed è una scelta, non una dimenticanza. */ ''}
      Sotto controllo: ${conteggi.nClienti} ${conteggi.nClienti === 1 ? 'cliente' : 'clienti'} con un percorso a pagamento ·
      ${conteggi.nCommittenti} ${conteggi.nCommittenti === 1 ? 'committente' : 'committenti'} con una quota ·
      ${conteggi.nProgetti} ${conteggi.nProgetti === 1 ? 'progetto' : 'progetti'} con un totale.
      Chi non ha niente da fatturare non compare.
    </p>
    ${anomalie.length ? gruppiHtml : vuoto}
  </div>
  </body></html>`;
}

function proformaPage(daChiedere, proforme, req) {
  const eur = n => '€ ' + fiscale.euro(n);
  // Il numero del documento apre l'anteprima invece di portare via dalla pagina.
  const linkPdf = (p, stile) =>
    `<a href="#" onclick="apriPdf('${p.id}',${jsStr('Proforma n. ' + p.numero)});return false" style="${stile}">n. ${esc(p.numero)}</a>`;

  const passo = (n, titolo, sottotitolo, corpo) => `
    <section style="margin-bottom:26px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:3px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--blue);color:#fff;font-size:13px;font-weight:700;flex:none">${n}</span>
        <h2 style="margin:0">${titolo}</h2>
      </div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 12px 34px">${sottotitolo}</p>
      ${corpo}
    </section>`;

  // ── 1. Da chiedere ────────────────────────────────────────────────────────
  // Un riquadro per PERSONA (regola dell'11/08). Dentro: i mesi, le bozze che
  // resterebbero fuori, e o il pulsante o il motivo per cui non c'è.
  const chiediHtml = daChiedere.map(c => {
    const mesi = c.mesi.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <span style="font-size:14px;text-transform:capitalize">${meseEsteso(m.mese)}</span>
        <span style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--hint)">${m.n} ${m.n === 1 ? 'sessione' : 'sessioni'}${m.nIntake ? ` · ${m.nIntake === 1 ? 'intake' : m.nIntake + ' intake'} ×2` : ''}</span>
          <strong style="font-size:14px">${eur(m.importo)}</strong>
        </span>
      </div>`).join('');

    const bozze = c.nBozze ? `
      <div style="font-size:12px;color:#8a6d1e;background:#fdf6e3;border-radius:8px;padding:9px 12px;margin-top:10px">
        ⚠️ ${c.nBozze === 1 ? 'C’è 1 sessione in bozza' : `Ci sono ${c.nBozze} sessioni in bozza`}
        (${c.bozze.map(b => meseEsteso(b.mese)).join(', ')}):
        finché non ${c.nBozze === 1 ? 'la approvi' : 'le approvi'} non ${c.nBozze === 1 ? 'entra' : 'entrano'} nella proforma.
      </div>` : '';

    // Niente pulsante senza spiegazione: se manca qualcosa si dice cosa e dove.
    const azione = !c.nSessioni ? '' : (c.motivi && c.motivi.length ? `
      <div style="background:#fffdf6;border-left:3px solid var(--gold);border-radius:8px;padding:12px 14px;margin-top:12px">
        <div style="font-size:13px;font-weight:700;margin-bottom:5px">Non si può ancora chiedere il pagamento</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#4A4A4A">
          ${c.motivi.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
        </ul>
      </div>` : `
      <div style="margin-top:12px">
        <button onclick="chiedi('${c.id}')" id="ch-${c.id}" class="btn btn-primary btn-sm">
          Chiedi il pagamento — ${eur(c.totale)}
        </button>
      </div>`);

    return `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:2px">
          <a href="/dashboard/clients/${c.id}" style="font-size:16px;font-weight:700;color:var(--blue);text-decoration:none">${esc(c.name || '(senza nome)')}</a> ${collaudo.badge(c.di_collaudo)}
          ${c.nSessioni ? `<strong style="margin-left:auto;font-size:16px">${eur(c.totale)}</strong>` : ''}
        </div>
        ${mesi}${bozze}${azione}
      </div>`;
  }).join('');

  // ── 2. Da mandare ─────────────────────────────────────────────────────────
  // Chi è «da mandare» lo dice il modulo, non questa pagina: dal 13/08 la stessa
  // domanda la fa anche la home, e due filtri scritti a mano divergerebbero.
  const daMandare = proforme.filter(proforma.daMandare);

  // Quello che la finestrella d'invio deve avere in mano. Il testo lo prepara
  // `proforma.testoMail()`: la pagina non lo scrive, così è lo stesso testo
  // ovunque e si può provare senza aprire un browser.
  // L'indirizzo viene da quello congelato nel documento, e se lì manca da
  // quello del cliente in anagrafica: uno dei due c'è quasi sempre, e comunque
  // resta modificabile prima di mandare.
  const datiInvio = {};
  for (const p of daMandare) {
    const t = proforma.testoMail(p, p.righe);
    datiInvio[p.id] = {
      numero: p.numero,
      to: (p.destinatario_dati || {}).email || p.cliente_email || '',
      subject: t.subject, body: t.body,
      allegato: proforma.nomeFile(p),
    };
  }
  const mandareHtml = daMandare.map(p => `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')} ${collaudo.badge(p.di_collaudo)} · ${p.data_emissione ? itDate(p.data_emissione) : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto">
          <strong style="font-size:15px">${eur(p.da_pagare)}</strong>
          <button onclick="apriPdf('${p.id}',${jsStr('Proforma n. ' + p.numero)})" class="btn btn-neutral btn-sm">Apri il PDF</button>
          <button onclick="apriInvio('${p.id}')" class="btn btn-gold btn-sm">✉️ Rivedi e manda</button>
          <button onclick="annulla('${p.id}',${jsStr(p.numero)},false)" class="btn btn-neutral btn-sm">Annulla</button>
        </div>
      </div>
    </div>`).join('');

  // ── 3. Mandate, in attesa di incasso ──────────────────────────────────────
  // ⭐ C4 — prima questa fila non esisteva: una proforma spedita finiva fra le
  // «Già fatte», che è una ricevuta e non chiede mai niente. Ma una proforma
  // mandata e non pagata è il momento in cui si vive per settimane, e senza una
  // riga che lo dica quei soldi si perdono di vista. Qui ogni riga porta il
  // gesto che le tocca: dire che sono arrivati.
  const inAttesa = proforme.filter(p =>
    p.stato === 'inviata' && !incassi.saldata(p));
  const attesaHtml = inAttesa.map(p => {
    const manca = incassi.residuo(p);
    const preso = incassi.sommaIncassi(p.incassi);
    // ⚠️ Quando la scadenza non si sa (rata legata a «metà percorso» senza data)
    // NON si mette il giorno dell'invio al suo posto: si dice che non si sa.
    // Una data inventata qui farebbe scattare un promemoria per un ritardo che
    // non esiste, ed è esattamente il difetto che Germano ha trovato il 18/08.
    const scad = p.scadenzaVera;
    // Le righe già registrate: un acconto si vede, e si può togliere se la data
    // o la cifra erano sbagliate. Non si «corregge» un fatto: si toglie.
    const righeInc = (p.incassi || []).map(i => `
      <div style="font-size:12px;color:var(--muted);margin-top:4px">
        arrivati ${eur(i.importo)} il ${itDate(i.data_incasso)}
        <button onclick="togliIncasso('${i.id}')" class="btn btn-neutral btn-sm" style="margin-left:6px">Elimina</button>
      </div>`).join('');
    return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')} ${collaudo.badge(p.di_collaudo)}
            ${scad ? ' · scadenza ' + itDate(scad)
                   : ' · <span style="color:var(--hint)">scadenza non ancora nota</span>'}
            ${preso > 0 ? ` · <strong>acconto di ${eur(preso)} ricevuto</strong>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto">
          <strong style="font-size:15px">${eur(manca)}</strong>
          <button onclick="apriIncasso('${p.id}',${jsStr('n. ' + p.numero + ' — ' + (p.cliente_nome || ''))},${manca})" class="btn btn-gold btn-sm">È arrivato</button>
        </div>
      </div>
      ${righeInc}
    </div>`;
  }).join('');

  // ── 4. Incassate, da fatturare ────────────────────────────────────────────
  // ⭐ È il passaggio che impedisce a tutta la catena di finire in un vicolo
  // cieco: i soldi sono arrivati, e adesso la fattura elettronica va emessa a
  // mano in SuperBill. Il documento resta qui finché non se ne scrive il numero.
  // ⚠️ Il mese della fattura è quello dell'INCASSO, non quello del documento
  // (decisione 2 dell'11/08) — per questo la data la scrive Germano.
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const daFatturare = proforme.filter(incassi.daFatturare);
  const fatturareHtml = daFatturare.map(p => {
    const quando = incassi.dataChiudeIlConto(p.incassi);
    const mese = quando ? MESI[Number(quando.slice(5, 7)) - 1] + ' ' + quando.slice(0, 4) : '';
    return `
    <div class="card" style="margin-bottom:12px;border-left:3px solid #4F8B73">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-size:16px;font-weight:700;color:var(--blue);text-decoration:none")}
          <div style="font-size:13px;color:var(--muted)">
            ${esc(p.cliente_nome || '(destinatario cancellato)')} ${collaudo.badge(p.di_collaudo)}
            ${quando ? ' · incassata il ' + itDate(quando) : ''}
            ${mese ? ` · <strong>fattura di ${mese}</strong>` : ''}
          </div>
          <div style="font-size:12px;color:var(--hint);margin-top:3px">
            Imponibile ${eur(p.imponibile)} · IVA ${eur(p.iva)}${Number(p.ritenuta) > 0 ? ` · ritenuta ${eur(p.ritenuta)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto">
          <label style="margin:0;text-transform:none;letter-spacing:0;font-size:12px;color:var(--muted)">N. fattura</label>
          <input id="fatt-${p.id}" value="${esc(p.fattura_numero || '')}" placeholder="es. 12/2026" style="width:120px">
          <button onclick="salvaFattura('${p.id}')" class="btn btn-primary btn-sm">Fatta</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── 5. Chiuse ─────────────────────────────────────────────────────────────
  // Non è un passaggio da fare: è la ricevuta, e serve a non chiedere due volte.
  // ⚠️ `inviata_data` è un MOMENTO, non una data: con itDate() usciva «Wed Aug
  // 12», perché quella funzione taglia una stringa ISO e qui arriva un timestamp.
  // itDateTime() lo scrive in ora italiana — e su una cosa spedita l'ora serve.
  //
  // 🔴 18/08 — DIVISE IN DUE, dopo che Germano ha guardato la pagina con i suoi
  // dati: «vengono indicate tutte quelle annullate, questo non dovrebbe
  // succedere». Prima un unico elenco «Già fatte» metteva la stessa faccia a
  // tre cose diverse, e tre prove annullate stavano sopra l'unica riga utile.
  // ⛔ Cancellarle NO (era la sua proposta, e gliel'ho detto): il numero resta
  // bruciato comunque, e un buco nella numerazione senza spiegazione è peggio
  // di un documento che dice ANNULLATA — soprattutto se quella proforma era
  // già stata spedita, e il cliente ce l'ha in mano.
  // ⭐ Quindi restano, ma ripiegate: si aprono se servono.
  const chiuse = proforme.filter(p =>
    !proforma.daMandare(p) && !inAttesa.includes(p) && !incassi.daFatturare(p));
  const concluse  = chiuse.filter(p => p.stato !== 'annullata');
  const annullate = chiuse.filter(p => p.stato === 'annullata');

  const rigaConclusa = p => {
    const quando = incassi.dataChiudeIlConto(p.incassi);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-weight:700;color:var(--blue);text-decoration:none")}
          <span style="font-size:13px;color:var(--muted);margin-left:8px">${esc(p.cliente_nome || '—')} ${collaudo.badge(p.di_collaudo)}</span>
          <div style="font-size:12px;color:var(--hint);margin-top:2px">
            ${quando ? 'incassata il ' + itDate(quando) : 'mandata' + (p.inviata_data ? ' il ' + itDateTime(p.inviata_data) : '')}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--ink)">${eur(p.da_pagare)}</span>
          ${/* ⭐ IL NUMERO DELLA FATTURA SI VEDE. Buco mio, trovato da Germano
                provando: appena lo scrivevi la riga spariva dal passaggio 4 e
                quel numero non compariva più da nessuna parte — se il
                commercialista chiede «che numero hai dato a questa?», bisognava
                andarlo a cercare nel documento. */ ''}
          ${p.fattura_numero
            ? `<span class="badge" style="background:#eafaf1;color:#065f46">Fattura n. ${esc(p.fattura_numero)}${p.fattura_data ? ' del ' + itDate(p.fattura_data) : ''}</span>`
            : `<span class="badge" style="background:#e8f4fd;color:#1A5280">Mandata${p.inviata_data ? ' il ' + itDateTime(p.inviata_data) : ''}</span>`}
          ${p.drive_url
            ? `<a href="${esc(p.drive_url)}" target="_blank" style="font-size:12px;color:var(--muted);text-decoration:none">copia su Drive</a>`
            : `<button onclick="riprovaDrive('${p.id}')" class="btn btn-neutral btn-sm" title="La mail è partita, ma la copia in archivio no">Copia su Drive non riuscita — riprova</button>`}
          <button onclick="annulla('${p.id}',${jsStr(p.numero)},true)" class="btn btn-neutral btn-sm">Annulla</button>
        </div>
      </div>`;
  };

  // ⚠️ Un'annullata MAI SPEDITA e una annullata DOPO l'invio non sono la stessa
  // cosa: la seconda il cliente ce l'ha, e va detto. Prima avevano la stessa
  // etichetta grigia.
  const rigaAnnullata = p => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #f1f3f6;flex-wrap:wrap">
        <div>
          ${linkPdf(p, "font-weight:700;color:var(--hint);text-decoration:none")}
          <span style="font-size:13px;color:var(--hint);margin-left:8px">${esc(p.cliente_nome || '—')} ${collaudo.badge(p.di_collaudo)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--hint)">${eur(p.da_pagare)}</span>
          ${p.inviata_data
            ? `<span class="badge" style="background:#fdf0ee;color:#a4342a">Annullata dopo essere stata mandata</span>`
            : `<span class="badge" style="background:#f1f3f6;color:#8a8a8a">Annullata, mai mandata</span>`}
        </div>
      </div>`;

  const conclusaHtml = !concluse.length ? '' : `
    <section style="margin-top:34px">
      <h2 style="margin-bottom:4px;font-size:16px;color:var(--muted)">Chiuse</h2>
      <p style="color:var(--hint);font-size:12px;margin:0 0 10px">Incassate e già fatturate: non chiedono più niente.</p>
      <div class="card" style="padding:4px 18px">${concluse.map(rigaConclusa).join('')}</div>
    </section>`;

  // Ripiegate: ci sono, non stanno in mezzo. Il numero resta bruciato e il
  // documento resta consultabile — è tutto quello che serve.
  const annullateHtml = !annullate.length ? '' : `
    <section style="margin-top:22px">
      <details>
        <summary style="cursor:pointer;color:var(--muted);font-size:13px">
          ${annullate.length === 1 ? '1 proforma annullata' : annullate.length + ' proforma annullate'}
          <span style="color:var(--hint)">— il numero resta bruciato, il documento si può ancora aprire</span>
        </summary>
        <div class="card" style="padding:4px 18px;margin-top:10px">${annullate.map(rigaAnnullata).join('')}</div>
      </details>
    </section>`;

  const fatteHtml = conclusaHtml + annullateHtml;

  const nientePerNiente = !daChiedere.length && !proforme.length;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Proforma</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione', sub: 'proforma' })}
  <div class="container">
    <h1>Amministrazione</h1>
    ${amNav('proforma')}
    <h2 style="margin-bottom:4px">Proforma</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:22px">
      Chiedere ai clienti quello che hanno maturato, un passaggio alla volta.
      La proforma <strong>non è una fattura</strong>: la fattura si emette dopo l'incasso.
    </p>

    ${nientePerNiente ? `
      <div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7">
        <strong style="color:#2e6b52;font-size:15px">✅ Non c'è niente da chiedere.</strong>
        <div style="font-size:13px;color:var(--muted);margin-top:6px">
          Nessuna sessione a pagamento in attesa, e nessuna proforma da mandare.
        </div>
      </div>` : `
      ${passo(1, 'Da chiedere', 'Sessioni già fatte e mai chieste. Il pulsante crea la proforma e le raccoglie tutte.',
        daChiedere.length ? chiediHtml : `<div class="card" style="color:var(--muted);font-size:13px">Niente in attesa: tutto quello che era maturato è già stato chiesto.</div>`)}

      ${passo(2, 'Da rileggere e mandare', 'Proforma create e non ancora spedite. Apri il PDF e controllalo prima di mandarlo.',
        daMandare.length ? mandareHtml + `
          <p style="font-size:12px;color:var(--hint);margin:6px 0 0">
            Il PDF si apre in una scheda nuova: rileggilo prima di mandarlo.
            Alla riuscita la proforma passa fra le «Già fatte» e una copia finisce su Drive.
          </p>`
        : `<div class="card" style="color:var(--muted);font-size:13px">Niente da mandare.</div>`)}

      ${passo(3, 'Mandate, in attesa di incasso', 'Proforma partite e non ancora pagate. Quando i soldi arrivano, dillo qui: la data che scrivi decide il mese della fattura.',
        inAttesa.length ? attesaHtml
        : `<div class="card" style="color:var(--muted);font-size:13px">Niente in attesa: tutto quello che è stato chiesto è stato pagato.</div>`)}

      ${passo(4, 'Incassate, da fatturare', 'I soldi sono arrivati: adesso la fattura elettronica va emessa in SuperBill. Scrivi qui il numero che le hai dato, e la riga sparisce.',
        daFatturare.length ? fatturareHtml
        : `<div class="card" style="color:var(--muted);font-size:13px">Nessuna fattura da preparare.</div>`)}

      ${fatteHtml}`}
  </div>

  ${/* ⭐ C4 — la finestrella dell'incasso è la STESSA delle schede col piano di
        pagamento (piano-ui.js): stesso markup, stesse funzioni, stesse parole.
        Registrare un incasso in due modi diversi sarebbe l'errore che questa
        fetta sta togliendo. */ ''}
  ${pianoUi.modaleIncasso()}
  ${modalePdf()}

  ${/* La finestrella è UNA sola per tutte le proforma: quello che cambia lo
        porta dentro `INVIO`, preparato qui dal server. Lo stesso schema di
        Mail 1 e Mail 2, che Germano conosce già. */ ''}
  <div id="modal-invio" class="modal-overlay">
    ${/* 🔴 18/08 — QUI ERA IL DIFETTO CHE GERMANO AVEVA VISTO: «compaiono tutti i
          campi di testo, ma nessuna cornice». La classe scritta era `.modal`, che
          nel foglio di stile non esiste — quindi nessuno sfondo, nessun bordo,
          nessuna ombra. Non era il contenitore che «perdeva» lo stile: non l'ha
          mai avuto. La classe vera è «.modal-box». */ ''}
    <div class="modal-box" style="max-width:640px">
      <h2 style="margin-bottom:4px">Rivedi e manda — <span id="mi-numero"></span></h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">
        Il testo si può cambiare: parte quello che vedi qui sotto.
      </p>
      <div class="form-group"><label>A chi</label><input id="mi-to" type="email"></div>
      <div class="form-group"><label>Oggetto</label><input id="mi-subject" type="text"></div>
      <div class="form-group"><label>Testo della mail</label>
        <textarea id="mi-body" style="min-height:240px;font-family:inherit"></textarea></div>
      <div style="background:#fbfcfd;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:4px">Allegato</div>
        ${/* 🔴 18/08 — L'ULTIMO PUNTO CHE APRIVA UNA SCHEDA NUOVA, e il più
              importante: è QUI che si arriva dopo aver creato una proforma, ed
              è qui che Germano ha continuato a trovarsi la finestra fuori
              dall'Hub («sinceramente non è cambiato niente»). L'avevo lasciato
              apposta per non sovrapporre due finestrelle — un motivo mio, non
              suo, e sbagliato: il vicolo cieco valeva anche qui.
              ⭐ Adesso apre l'anteprima, che ha uno z-index più alto e sta
              sopra questa; chiudendola si torna alla mail, che è rimasta lì
              con tutto quello che avevi scritto. */ ''}
        <a id="mi-pdf" href="#" style="font-size:13px;font-weight:700;color:var(--blue);text-decoration:none"></a>
        <div style="font-size:12px;color:var(--hint);margin-top:4px">Aprilo e rileggilo <strong>prima</strong> di mandarlo: dopo non si torna indietro.</div>
      </div>
      <div id="mi-error" style="display:none" class="flash-error"></div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <button onclick="document.getElementById('modal-invio').style.display='none'" class="btn btn-neutral" style="flex:1">Annulla</button>
        <button id="mi-send" onclick="mandaProforma()" class="btn btn-primary" style="flex:1">✉️ Manda adesso</button>
      </div>
    </div>
  </div>

  <script>
    var INVIO = ${JSON.stringify(datiInvio).replace(/</g, '\\u003c')};
    var invioCorrente = null;
    function apriInvio(id) {
      var d = INVIO[id]; if (!d) return;
      invioCorrente = id;
      document.getElementById('mi-numero').textContent = 'Proforma n. ' + d.numero;
      document.getElementById('mi-to').value = d.to || '';
      document.getElementById('mi-subject').value = d.subject;
      document.getElementById('mi-body').value = d.body;
      var a = document.getElementById('mi-pdf');
      // L'allegato apre l'ANTEPRIMA dentro l'Hub, non una scheda nuova. La
      // finestrella della mail resta aperta sotto: chiusa l'anteprima, il testo
      // che stavi scrivendo e' ancora li'.
      a.href = '#';
      a.onclick = function () { apriPdf(id, 'Proforma n. ' + d.numero); return false; };
      a.textContent = d.allegato;
      document.getElementById('mi-error').style.display = 'none';
      document.getElementById('modal-invio').style.display = 'flex';
    }
    async function mandaProforma() {
      var err = document.getElementById('mi-error');
      var to = document.getElementById('mi-to').value.trim();
      if (!to) { err.textContent = 'Serve un indirizzo destinatario.'; err.style.display = 'block'; return; }
      var d = INVIO[invioCorrente];
      if (!confirm('Mando la proforma n. ' + d.numero + ' a ' + to + '?\\n\\nAllegato: ' + d.allegato)) return;
      var btn = document.getElementById('mi-send');
      btn.disabled = true; btn.textContent = 'Invio in corso…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/proforma/' + invioCorrente + '/invia', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to,
            subject: document.getElementById('mi-subject').value,
            body: document.getElementById('mi-body').value }) });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { err.textContent = j.error || ('Errore ' + r.status); err.style.display = 'block';
          btn.disabled = false; btn.textContent = '✉️ Manda adesso'; return; }
        alert('Mandata a ' + j.to + '.'
          + (j.driveErrore ? '\\n\\nLa mail e\\' partita, ma la copia su Drive no: ' + j.driveErrore
                             + '\\nLa puoi riprovare dall\\'elenco «Gia\\' fatte».' : ''));
        location.reload();
      } catch (e) { err.textContent = 'Errore di rete: ' + e.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = '✉️ Manda adesso'; }
    }
    async function riprovaDrive(id) {
      try {
        var r = await fetch('/dashboard/proforma/' + id + '/drive', { method: 'POST' });
        var j = await r.json().catch(function(){ return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
    async function chiedi(id) {
      if (!confirm('Creo la proforma con tutte le sessioni non ancora chieste?\\n\\nIl numero che le viene assegnato non potra\\' essere riusato.')) return;
      const btn = document.getElementById('ch-' + id);
      btn.disabled = true; btn.textContent = 'Creazione in corso…';
      try {
        const r = await fetch('/dashboard/clients/' + id + '/proforma', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { alert(d.error || ('Errore ' + r.status)); btn.disabled = false; btn.textContent = 'Riprova'; return; }
        // 18/08 — niente scheda nuova: la finestrella si apre da sola dopo la
        // ricarica, e da li si chiude.
        try { sessionStorage.setItem('pdf-appena-nata',
          JSON.stringify({ id: d.id, titolo: 'Proforma n. ' + d.numero })); } catch (e) {}
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); btn.disabled = false; btn.textContent = 'Riprova'; }
    }
    async function annulla(id, numero, mandata) {
      // Il numero non torna disponibile: si dice prima, non dopo.
      var testo = 'Annullo la proforma n. ' + numero + '?\\n\\n'
        + 'Il numero resta bruciato e non si riusa. Le sessioni tornano fra quelle da chiedere.';
      if (mandata) testo += '\\n\\nATTENZIONE: questa proforma e\\' gia\\' stata mandata al cliente.';
      if (!confirm(testo)) return;
      try {
        const r = await fetch('/dashboard/proforma/' + id + '/annulla', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { alert(d.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }

    ${/* ⭐ C4 — apriIncasso / confermaIncasso / chiudiIncasso arrivano da
          piano-ui.js: sono le stesse delle schede col piano. */ ''}
    ${pianoUi.jsIncasso()}
    ${jsModalePdf()}

    // Un incasso non si corregge: si toglie e si rimette. Un fatto o c'e o non
    // c'e — e togliendolo il documento torna da se fra quelli in attesa.
    async function togliIncasso(id) {
      if (!confirm('Tolgo questo incasso?\\n\\nIl documento torna fra quelli in attesa di pagamento.')) return;
      try {
        var r = await fetch('/dashboard/incassi/' + id + '/togli', { method: 'POST' });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
    // Il numero della fattura emessa a mano in SuperBill. Si puo anche
    // cancellare: scritto sbagliato, la riga uscirebbe dalla fila con un numero
    // che non esiste.
    async function salvaFattura(id) {
      var n = document.getElementById('fatt-' + id).value.trim();
      if (!n && !confirm('Il numero e vuoto: la proforma torna fra quelle da fatturare. Confermi?')) return;
      try {
        var r = await fetch('/dashboard/proforma/' + id + '/fattura', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numero: n }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) { alert(j.error || ('Errore ' + r.status)); return; }
        location.reload();
      } catch (e) { alert('Errore di rete: ' + e.message); }
    }
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHI EMETTE (Fatturazione, Fase 3) — i dati che vanno in cima alla proforma.
//
// Nell'Hub non c'erano da nessuna parte: sapeva tutto dei clienti e niente di
// chi manda il documento. Una proforma senza l'IBAN non serve a niente — chi la
// riceve non sa dove pagare — quindi la pagina non si limita a raccogliere i
// dati: dice in cima, con parole intere, se si può emettere o cosa manca.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * L'elenco di TUTTI i contratti, diviso in due come ha chiesto Germano: percorsi
 * singoli e progetti strutturati.
 * ⚠️ Si guarda e basta: lo stato si cambia dove il contratto si fa. I link a
 *    destra ci portano.
 */
function contrattiAmmPage(singoli, progetti, partecipanti, req, tutti) {
  const st = (x) => x || 'da_redigere';
  // ⭐ Germano, 30/08: di norma si vedono solo i percorsi ATTIVI, con un
  //    interruttore per tirare fuori anche i conclusi. Un elenco che serve ad
  //    avere tutto sotto controllo, se cresce per sempre, smette di funzionare:
  //    i contratti che chiedono qualcosa anneghiamo fra quelli chiusi da anni.
  // ⛔ Ma quante righe sono nascoste SI DICE SEMPRE. Nascondere in silenzio è
  //    peggio di non nascondere: chi guarda crede di star vedendo tutto.
  // ⚠️ SI NASCONDE SOLO CIÒ CHE È CONCLUSO, non «tutto ciò che non è attivo».
  //    Un progetto «in pausa» è lavoro vivo che si è fermato — è proprio quello
  //    che vuoi vedere. Filtrare su «attivo» l'avrebbe fatto sparire: sbagliato
  //    alla prima stesura del 30/08 e corretto guardando gli stati veri.
  const finito = (x) => x === 'concluso';
  const percConclusi = singoli.filter(r => finito(r.stato_percorso));
  const progConclusi = progetti.filter(g => finito(g.stato_progetto));
  const singoliVisti  = tutti ? singoli  : singoli.filter(r => !finito(r.stato_percorso));
  const progettiVisti = tutti ? progetti : progetti.filter(g => !finito(g.stato_progetto));
  // Un interruttore SOLO, in cima, per tutti e due gli elenchi: due comandi che
  // fanno la stessa cosa in due punti diversi sono due modi di confondersi.
  const nascosti = percConclusi.length + progConclusi.length;
  const pezzi = [
    percConclusi.length ? `${percConclusi.length} ${percConclusi.length === 1 ? 'percorso' : 'percorsi'}` : null,
    progConclusi.length ? `${progConclusi.length} ${progConclusi.length === 1 ? 'progetto' : 'progetti'}` : null,
  ].filter(Boolean).join(' e ');
  const interruttore = !nascosti ? '' : (tutti
    ? `<a href="/dashboard/amministrazione/contratti" style="font-size:13px">nascondi ${pezzi} ${nascosti === 1 ? 'concluso' : 'conclusi'}</a>`
    : `<a href="/dashboard/amministrazione/contratti?tutti=1" style="font-size:13px">mostra anche ${pezzi} ${nascosti === 1 ? 'concluso' : 'conclusi'}</a>`);
  // Il conto per stato: è la riga che dice «dove sono i problemi» senza contare
  // le righe a occhio.
  const conta = (righe) => {
    const m = new Map();
    for (const r of righe) m.set(st(r.stato_contratto), (m.get(st(r.stato_contratto)) || 0) + 1);
    return contrattiStato.STATI.filter(s => m.get(s.key))
      .map(s => `<span class="badge" style="background:${s.bg};color:${s.color}">${m.get(s.key)} ${s.label.toLowerCase()}</span>`).join(' ');
  };
  const consenso = (r) => r.consenso_privacy
    ? '<span style="font-size:11px;color:#2f6b46">✓ informativa</span>'
    : '<span style="font-size:11px;color:#8a6d1e">informativa da firmare</span>';

  const rigaSingolo = (r) => `<tr>
    <td><a href="/dashboard/clients/${r.client_id}" style="color:var(--blue);text-decoration:none">${esc(r.name || '—')}</a>
        ${r.stato_percorso !== 'attivo' ? '<span class="badge badge-inactive">percorso concluso</span>' : ''}</td>
    <td style="font-size:12px;color:var(--muted)">${esc(r.tipo || 'Individuale')}</td>
    <td>${contrattiStato.badge(st(r.stato_contratto))}</td>
    <td>${consenso(r)}</td>
    <td style="text-align:right"><a href="/dashboard/clients/${r.client_id}" style="font-size:12px">apri la scheda ↗</a></td>
  </tr>`;

  const rigaProgetto = (g) => {
    const suoi = partecipanti.filter(p => p.progetto_id === g.progetto_id);
    const paganti = suoi.filter(p => Number(p.quota_coachee) > 0);
    return `<tr>
      <td><a href="/dashboard/progetti/${g.progetto_id}" style="color:var(--blue);text-decoration:none"><strong>${esc(g.titolo || '—')}</strong></a>
          <div style="font-size:12px;color:var(--muted)">${esc(g.denominazione || '')}</div></td>
      <td style="font-size:12px;color:var(--muted)">Committente</td>
      <td>${contrattiStato.badge(st(g.stato_contratto))}</td>
      <td style="font-size:11px;color:var(--muted)">${suoi.length} ${suoi.length === 1 ? 'partecipante' : 'partecipanti'}</td>
      <td style="text-align:right"><a href="/dashboard/progetti/${g.progetto_id}" style="font-size:12px">apri il progetto ↗</a></td>
    </tr>` + paganti.map(p => `<tr>
      <td style="padding-left:26px"><a href="/dashboard/clients/${p.client_id}" style="color:var(--blue);text-decoration:none">${esc(p.name || '—')}</a></td>
      <td style="font-size:12px;color:var(--muted)">Partecipante</td>
      <td>${contrattiStato.badge(st(p.stato_contratto))}</td>
      <td>${consenso(p)}</td>
      <td></td>
    </tr>`).join('') + suoi.filter(p => !(Number(p.quota_coachee) > 0)).map(p => `<tr>
      <td style="padding-left:26px;color:var(--muted)">${esc(p.name || '—')}</td>
      <td style="font-size:12px;color:#aaa">non firma un contratto</td>
      <td><span style="font-size:12px;color:#aaa">—</span></td>
      <td>${consenso(p)}</td>
      <td></td>
    </tr>`).join('');
  };

  const tabella = (intestazioni, corpo, vuoto) => corpo
    ? `<div style="overflow-x:auto"><table style="width:100%;min-width:640px">
         <thead><tr>${intestazioni.map(h => `<th style="text-align:left;font-size:12px;color:var(--muted);padding-bottom:6px">${h}</th>`).join('')}</tr></thead>
         <tbody>${corpo}</tbody></table></div>`
    : `<div style="font-size:13px;color:var(--muted)">${vuoto}</div>`;

  const tuttiPart = partecipanti.filter(p => Number(p.quota_coachee) > 0);
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Contratti</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione', sub: 'contratti' })}
  <div class="container" style="max-width:1200px">
    <h1>Amministrazione</h1>
    ${amNav('contratti')}
    <h2 style="margin-bottom:4px">Contratti</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
      A che punto è ogni contratto. Qui si guarda: lo stato si cambia dove il contratto si prepara —
      la scheda del cliente o la pagina del progetto — e i link a destra ti ci portano.
    </p>
    ${interruttore ? `<div style="margin:-8px 0 20px">
      <span style="font-size:13px;color:var(--muted)">Vedi quello che è in corso. ${interruttore}</span>
    </div>` : ''}

    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h2 style="margin:0">Percorsi singoli</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${conta(singoliVisti)}</div>
      </div>
      ${tabella(['Cliente', 'Percorso', 'Contratto', 'Privacy', ''], singoliVisti.map(rigaSingolo).join(''),
        'Nessun percorso individuale in corso fuori da un progetto.')}
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h2 style="margin:0">Progetti strutturati</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${conta(progettiVisti)} ${tuttiPart.length ? '<span style="font-size:12px;color:var(--muted)">+ ' + tuttiPart.length + ' contratti di partecipanti</span>' : ''}</div>
      </div>
      ${tabella(['Chi firma', 'Ruolo', 'Contratto', '', ''], progettiVisti.map(rigaProgetto).join(''),
        'Nessun progetto in corso.')}
    </div>
  </div>
  </body></html>`;
}

function emittentePage(e, verdetto, salvato, req) {
  const v = k => attr(e[k] || '');
  const campo = (id, etichetta, extra = '') =>
    `<div class="form-group"><label>${etichetta}</label><input id="em-${id}" type="text" value="${v(id)}" ${extra}></div>`;
  const riga = (...campi) =>
    `<div style="display:grid;grid-template-columns:${campi.map(() => '1fr').join(' ')};gap:12px">${campi.join('')}</div>`;

  // Il verdetto sta in cima e non in fondo: è la prima cosa da sapere, e deve
  // essere leggibile senza contare i campi vuoti a occhio.
  const cartello = verdetto.pronto
    ? `<div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7;margin-bottom:18px">
         <strong style="color:#2e6b52;font-size:15px">✅ Puoi emettere proforma.</strong>
         ${verdetto.consigliati.length ? `<div style="font-size:13px;color:var(--muted);margin-top:6px">
           Non è obbligatorio, ma sul documento starebbe meglio anche: ${esc(verdetto.consigliati.join(', '))}.
         </div>` : ''}
       </div>`
    : `<div class="card" style="border-left:3px solid var(--gold);background:#fffdf6;margin-bottom:18px">
         <strong style="font-size:15px">Prima di poter mandare una proforma manca ancora qualcosa.</strong>
         <ul style="margin:8px 0 0;padding-left:20px;font-size:14px;color:#4A4A4A">
           ${verdetto.mancanti.map(m => `<li style="margin-bottom:3px">${esc(m)}</li>`).join('')}
         </ul>
       </div>`;

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Hub allenamento ICF — Chi emette</title>${baseStyle()}</head><body>
  ${headerNoesys({ mondo: 'amministrazione', sub: 'emittente' })}
  <div class="container" style="max-width:1200px">
    <h1>Amministrazione</h1>
    ${amNav('emittente')}
    <h2 style="margin-bottom:4px">Chi emette</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px">
      I tuoi dati, quelli che finiscono in cima a ogni proforma. Si compilano una volta
      sola e si correggono quando cambiano.
    </p>
    ${salvato ? `<div class="card" style="border-left:3px solid #4F8B73;background:#f4faf7;margin-bottom:18px;font-size:14px;color:#2e6b52"><strong>Salvato.</strong></div>` : ''}
    ${cartello}

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Chi sei</div>
      ${riga(campo('denominazione', 'Denominazione', 'placeholder="es. Noesys Professional Coaching"'))}
      ${riga(campo('nome', 'Nome'), campo('cognome', 'Cognome'))}
      ${riga(campo('partita_iva', 'Partita IVA'), campo('codice_fiscale', 'Codice fiscale'))}
      ${riga(
        `<div class="form-group"><label>Regime fiscale</label><select id="em-regime">
           <option value="ordinario"${(e.regime || 'ordinario') === 'ordinario' ? ' selected' : ''}>IVA ordinaria</option>
           <option value="forfettario"${e.regime === 'forfettario' ? ' selected' : ''}>Forfettario</option>
         </select></div>`,
        campo('ateco', 'Codice ATECO', 'placeholder="es. 70.20.09"'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Dove sei</div>
      ${riga(campo('via', 'Indirizzo', 'placeholder="via e numero civico"'))}
      ${riga(campo('cap', 'CAP'), campo('citta', 'Città'), campo('provincia', 'Provincia', 'placeholder="es. MI"'))}
      ${riga(campo('paese', 'Paese', 'placeholder="IT"'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Dove ti pagano</div>
      ${riga(campo('iban', 'IBAN', 'placeholder="IT.."'))}
      ${riga(campo('intestatario', 'Intestatario del conto'), campo('banca', 'Banca'))}
    </div>

    <div class="card">
      <div class="field-label" style="margin-bottom:12px">Come ti si contatta</div>
      ${riga(campo('email', 'Email'), campo('telefono', 'Telefono'))}
    </div>

    <div id="em-error" style="display:none" class="flash-error"></div>
    <button onclick="salvaEmittente()" id="em-btn" class="btn btn-primary">Salva</button>
  </div>

  <script>
    async function salvaEmittente() {
      var campi = ['denominazione','nome','cognome','partita_iva','codice_fiscale','regime',
                   'ateco','via','cap','citta','provincia','paese','iban','intestatario',
                   'banca','email','telefono'];
      var dati = {};
      campi.forEach(function (c) { dati[c] = (document.getElementById('em-' + c).value || '').trim(); });
      var btn = document.getElementById('em-btn'), err = document.getElementById('em-error');
      btn.disabled = true; btn.textContent = 'Salvo…'; err.style.display = 'none';
      try {
        var r = await fetch('/dashboard/amministrazione/emittente', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dati) });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Errore nel salvataggio');
        location.href = '/dashboard/amministrazione/emittente?salvato=1';
      } catch (ex) {
        err.textContent = ex.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Salva';
      }
    }
  </script>
  </body></html>`;
}

module.exports = { anomaliePage, proformaPage, contrattiAmmPage, emittentePage };
