/**
 * MISURA LA PORTABILITÀ: le pagine dell'Hub scivolano di lato sul telefono?
 *
 *   node --env-file=.env scripts/misura-portabilita.js
 *
 * ⚠️ NON sta dentro `npm run prova`: si lancia A MANO quando si tocca l'aspetto
 *    (una tabella, una griglia, un margine). Accende Chrome e ci mette un minuto.
 *
 * COSA GUARDA — due domande diverse, e servono tutte e due:
 *   1. la PAGINA scivola di lato?  documentElement.scrollWidth contro
 *      innerWidth, a 375 / 768 / 850 px. E dice CHI sbatte fuori, altrimenti si
 *      sa che scivola ma non perché.
 *   2. ogni TABELLA, che fine fa quello che deborda? Si risale ai genitori fino
 *      al primo che decide:  auto/scroll = scorre (bene) ·  hidden = TAGLIATA
 *      (male, ma non scivola) ·  nessuno = spinge la pagina.
 *   ⭐ Senza la seconda domanda si scambia un difetto per l'altro: il 31/08 la
 *      mappa diceva «10 tabelle spingono la pagina». Ne spingevano DUE; le altre
 *      SEI erano tagliate e irraggiungibili — nell'elenco clienti 460px su 797.
 *
 * ⭐ IL CASO SI COSTRUISCE COI PULSANTI, non con l'SQL, e con nomi lunghi: una
 *    tabella con le righe vuote non deborda, e misurare su un caso magro
 *    direbbe «tutto a posto» a torto. Ripulisce dietro di sé le sue righe.
 *
 * 🔴 COME SI PILOTA CHROME, e i due modi in cui NON si fa:
 *  ⛔ `--dump-dom` è MORTO: su Chrome 152 non risponde e il comando resta
 *     appeso per sempre invece di dare errore (mezz'ora persa il 31/08). La
 *     ricetta salvata nel 31/07 era invecchiata insieme al browser.
 *  ⛔ `execFileSync` NO: blocca il filo di Node, e il ponte che serve le pagine
 *     a Chrome gira in QUESTO processo — si aspettano a vicenda all'infinito.
 *  ✅ Ci si collega al MOTORE di Chrome (protocollo DevTools) e si comanda:
 *     imponi la larghezza · apri la pagina · valuta la misura. Deterministico.
 *  ⛔ E mai col pannello del browser: quando si nasconde innerWidth diventa 0.
 *
 * ⚠️ Gira sul database di PROVA (`--env-file=.env`), mai sulla produzione.
 * ⚠️ I messaggi «[drive] … fallita» sono ATTESI: in .env non ci sono le chiavi
 *    Google. L'Hub prosegue.
 * ⛔ I Chrome di prova si chiudono per la LORO cartella
 *    (`pkill -f "user-data-dir=/tmp/_pz-cdp"`), mai per nome del programma:
 *    `pkill -f "Google Chrome"` chiuderebbe il browser di Germano.
 */
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
// ⛔ execFileSync NO: blocca il filo di Node, e il ponte che serve le pagine gira
//    in QUESTO processo. Chrome aspetterebbe una pagina che Node non puo' piu'
//    servire, e si bloccherebbero a vicenda. Preso il 31/08, due volte.
const esegui = promisify(execFile);
const express = require('express');
const cookieParser = require('cookie-parser');
const routes = require('../server/routes');
const db = require('../server/db');
const { signToken, COOKIE_NAME } = require('../server/auth');

const app = express();
app.use(cookieParser());
app.use(routes);
const srv = app.listen(0);
const PORTA = srv.address().port;
const BISCOTTO = COOKIE_NAME + '=' + signToken({ role: 'coach', id: 'prova', username: 'prova' });
const LARGHEZZE = [375, 768, 850];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tappa = t => console.log('· ' + t);

// ── IL PILOTA DI CHROME ────────────────────────────────────────────────────
// ⛔ NIENTE `--dump-dom`: su Chrome 152 non risponde più e il comando resta
//    appeso per sempre (provato il 31/08). La tecnica scritta in memoria il
//    31/07 è invecchiata insieme al browser.
// ➜ Ci si collega al motore di Chrome (protocollo DevTools) e si comanda:
//    imposta la larghezza · apri la pagina · misura. Deterministico.
const PROFILO = '/tmp/_pz-cdp';
let chrome;
async function accendiChrome(porta) {
  chrome = require('child_process').spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--no-first-run', '--disable-extensions', '--user-data-dir=' + PROFILO,
    '--remote-debugging-port=' + porta, 'about:blank'], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${porta}/json/version`); if (r.ok) return await r.json(); } catch {}
    await new Promise(ok => setTimeout(ok, 200));
  }
  throw new Error('Chrome non ha aperto la porta del motore');
}
function collega(ws) {
  const sock = new WebSocket(ws);
  let n = 0; const attese = new Map();
  const pronto = new Promise((ok, no) => { sock.onopen = ok; sock.onerror = no; });
  sock.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && attese.has(m.id)) { const { ok, no } = attese.get(m.id); attese.delete(m.id);
      m.error ? no(new Error(m.error.message)) : ok(m.result); }
  };
  return { pronto, sock,
    manda: (metodo, params) => new Promise((ok, no) => {
      const id = ++n; attese.set(id, { ok, no });
      sock.send(JSON.stringify({ id, method: metodo, params: params || {} }));
      setTimeout(() => { if (attese.has(id)) { attese.delete(id); no(new Error('scaduto: ' + metodo)); } }, 30000);
    }) };
}


const chiama = async (metodo, url, corpo) => {
  const r = await fetch(`http://127.0.0.1:${PORTA}${url}`, {
    method: metodo, redirect: 'manual',
    headers: { Cookie: BISCOTTO, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const testo = await r.text();
  let dati = null; try { dati = JSON.parse(testo); } catch {}
  return { stato: r.status, testo, dati };
};

// La misura, valutata dentro la pagina dal motore di Chrome.
const MISURA = `(function(){
    var de = document.documentElement, vw = window.innerWidth;
    var tab = [].map.call(document.querySelectorAll('table'), function(t, i){
      var naturale = Math.max(t.scrollWidth, Math.round(t.getBoundingClientRect().width));
      var n = t.parentElement, verdetto = 'spinge la pagina';
      while (n && n !== document.body) {
        var ov = getComputedStyle(n).overflowX;
        if (ov === 'auto' || ov === 'scroll') { verdetto = 'scorre nel riquadro'; break; }
        if (ov === 'hidden') { verdetto = 'TAGLIATA (nascosta)'; break; }
        n = n.parentElement;
      }
      var spazio = n ? n.clientWidth : vw;
      return { i: i, naturale: naturale, spazio: Math.round(spazio),
               deborda: naturale - Math.round(spazio), verdetto: verdetto };
    });
    // chi sbatte fuori dallo schermo: si tiene l'elemento più ESTERNO di ogni
    // colpa, altrimenti si legge l'elenco dei figli invece del colpevole.
    var colpevoli = [];
    [].forEach.call(document.querySelectorAll('body *'), function(el){
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) return;
      var n = el.parentElement, coperto = false;
      while (n && n !== document.body) {
        var ov = getComputedStyle(n).overflowX;
        if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { coperto = true; break; }
        n = n.parentElement;
      }
      if (coperto) return;
      colpevoli.push({ tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 40),
        id: el.id || '', destra: Math.round(r.right), largo: Math.round(r.width),
        testo: (el.textContent || '').trim().slice(0, 45) });
    });
    // solo i primi: sono i più esterni nell'ordine del documento
    return { vw: vw, scivola: de.scrollWidth - vw, tabelle: tab, colpevoli: colpevoli.slice(0, 8) };
})()`;

(async () => {
  tappa('accendo il database di prova');
  await db.init();
  tappa('database pronto');
  const marca = 'MISURA-' + PORTA;
  const creati = { cli: [], comm: [], prog: [] };
  let ponte;
  try {
    // ── IL CASO, COSTRUITO COI PULSANTI ──────────────────────────────
    // Nomi e indirizzi lunghi di proposito: una tabella con le righe vuote non
    // deborda, e misurare su un caso magro direbbe «tutto a posto» a torto.
    for (const [n, c] of [['Alessandra','Della Valle Buonocore'],['Giovanni Battista','Ferrari Mengoni'],['Maria Vittoria','Sanseverino']]) {
      const r = await chiama('POST', '/dashboard/clients', { nome: n, cognome: c + ' ' + marca, area: 'Business',
        email: (n + '.' + c).toLowerCase().replace(/ /g, '') + '@esempio-lunghissimo.it', telefono: '+39 333 1234567' });
      const id = r.dati && (r.dati.id || (r.dati.client && r.dati.client.id));
      if (id) creati.cli.push(id);
    }
    const idCli = creati.cli[0];
    await chiama('POST', `/dashboard/clients/${idCli}/percorsi`, { tipo: 'Individuale', modalita: 'Pacchetto', prezzo: '1200', n_sessioni_previste: 10, data_inizio: '2026-03-02' });
    let r = await chiama('POST', '/dashboard/committenti', { denominazione: 'Fondazione Internazionale per lo Sviluppo ' + marca,
      referente: 'Maria Cristina Bevilacqua', ruolo: 'Responsabile Risorse Umane', email: 'risorse.umane@fondazione-esempio.it',
      telefono: '+39 02 12345678', partita_iva: '12345678901', indirizzo: 'Via dei Mille 128, Milano' });
    const idComm = r.dati && r.dati.id; if (idComm) creati.comm.push(idComm);
    r = await chiama('POST', '/dashboard/progetti', { committente_id: idComm, titolo: 'Percorso di sviluppo manageriale ' + marca,
      area: 'Business', tipo: 'team', stato: 'attivo', data_inizio: '2026-04-01' });
    const idProg = r.dati && r.dati.id; if (idProg) creati.prog.push(idProg);
    for (const c of creati.cli) await chiama('POST', `/dashboard/progetti/${idProg}/coachee`, { clientId: c });
    await chiama('POST', '/dashboard/leads', { nome: 'Massimiliano', cognome: 'Guglielmotti ' + marca,
      email: 'massimiliano.guglielmotti@azienda-esempio.it', telefono: '+39 340 9876543', fonte: 'passaparola',
      stato: 'da contattare', note: 'Vuole un percorso per il team commerciale, sei persone.' });
    tappa('caso costruito coi pulsanti');

    const pagine = [
      { nome: 'Elenco clienti',  url: '/dashboard/individuali' },
      { nome: 'Scheda cliente',  url: '/dashboard/clients/' + idCli },
      { nome: 'Lead',            url: '/dashboard/leads' },
      { nome: 'Committenti',     url: '/dashboard/committenti' },
      { nome: 'Elenco progetti', url: '/dashboard/progetti' },
      { nome: 'Pagina progetto', url: '/dashboard/progetti/' + idProg },
      { nome: 'Estratto ICF',    url: '/dashboard/icf' },
    ];

    // ── il ponte: stesso indirizzo per pagine e statici, col biscotto, e la sonda in coda
    ponte = http.createServer(async (req, res) => {
      const up = await fetch(`http://127.0.0.1:${PORTA}${req.url}`, { headers: { Cookie: BISCOTTO }, redirect: 'manual' });
      const ct = up.headers.get('content-type') || 'text/html';
      if (ct.includes('text/html')) {
        const html = await up.text();
        res.writeHead(up.status, { 'Content-Type': ct });
        return res.end(html);
      }
      const buf = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, { 'Content-Type': ct });
      res.end(buf);
    });
    await new Promise(ok => ponte.listen(8766, ok));
    tappa('ponte acceso su 8766 — misuro');

    const PORTA_CDP = 9333;
    await accendiChrome(PORTA_CDP);
    tappa('Chrome acceso, motore collegato');

    const esiti = [];
    for (const p of pagine) {
      for (const w of LARGHEZZE) {
        let e;
        let cdp;
        try {
          const t = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?about:blank`, { method: 'PUT' })).json();
          cdp = collega(t.webSocketDebuggerUrl);
          await cdp.pronto;
          await cdp.manda('Page.enable');
          // la larghezza si IMPONE al motore: è la misura vera, non quella della finestra
          await cdp.manda('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
          const caricata = new Promise(ok => {
            cdp.sock.addEventListener('message', function asc(ev) {
              const m = JSON.parse(ev.data);
              if (m.method === 'Page.loadEventFired') { cdp.sock.removeEventListener('message', asc); ok(); }
            });
          });
          await cdp.manda('Page.navigate', { url: 'http://127.0.0.1:8766' + p.url });
          await Promise.race([caricata, new Promise(ok => setTimeout(ok, 15000))]);
          await new Promise(ok => setTimeout(ok, 250));
          const r = await cdp.manda('Runtime.evaluate', { expression: MISURA, returnByValue: true });
          e = r.result && r.result.value ? r.result.value : { errore: 'nessuna misura' };
        } catch (err) { e = { errore: String(err.message || err).slice(0, 120) }; }
        finally { if (cdp) try { cdp.sock.close(); } catch {} }
        e.url = p.url; e.nome = p.nome; e.w = w; esiti.push(e);
        tappa(`${p.nome} @ ${w}px → ` + (e.errore ? '⛔ ' + e.errore : `scivola ${e.scivola}, ${e.tabelle.length} tabelle`));
      }
    }
    if (chrome) chrome.kill('SIGKILL');

    console.log('\n══════ SCIVOLAMENTO LATERALE (0 o meno = a posto) ══════\n');
    let guasti = 0;
    for (const p of pagine) {
      const riga = LARGHEZZE.map(w => {
        const e = esiti.find(x => x.url === p.url && x.w === w);
        if (!e || e.errore) return `${w}px: ⛔`;
        if (e.scivola > 0) guasti++;
        return `${w}px: ${e.scivola > 0 ? '🔴 +' + e.scivola : '✅ ' + e.scivola}`;
      }).join('   ');
      console.log(`${p.nome.padEnd(17)} ${riga}`);
    }

    console.log('\n══════ CHI SBATTE FUORI DALLO SCHERMO ══════\n');
    for (const e of esiti) {
      if (!e.colpevoli || !e.colpevoli.length) continue;
      console.log(`── ${e.nome} @ ${e.w}px (scivola ${e.scivola})`);
      e.colpevoli.forEach(c => console.log(`   <${c.tag}${c.id ? ' #' + c.id : ''}${c.cls ? ' .' + c.cls : ''}> largo ${c.largo}, arriva a ${c.destra}  «${c.testo}»`));
    }

    console.log('\n══════ LE TABELLE, a 375px ══════\n');
    for (const p of pagine) {
      const e = esiti.find(x => x.url === p.url && x.w === 375);
      if (!e || !e.tabelle) continue;
      console.log(`── ${p.nome}`);
      if (!e.tabelle.length) { console.log('   (nessuna tabella in questo caso)'); continue; }
      e.tabelle.forEach(t => {
        const segno = t.deborda > 0 ? (t.verdetto === 'scorre nel riquadro' ? '✅' : '🔴') : '· ';
        console.log(`   ${segno} tabella ${t.i}: ${t.naturale}px in ${t.spazio}px` +
          (t.deborda > 0 ? ` (deborda di ${t.deborda})` : '') + ` → ${t.verdetto}`);
      });
    }
    console.log(`\n${guasti === 0 ? '✅ NESSUNA pagina scivola di lato' : '🔴 ' + guasti + ' combinazioni pagina/larghezza scivolano di lato'}`);
  } finally {
    if (ponte) ponte.close();
    for (const id of creati.prog) await db.query('DELETE FROM progetti WHERE id=$1', [id]).catch(() => {});
    for (const id of creati.comm) await db.query('DELETE FROM committenti WHERE id=$1', [id]).catch(() => {});
    for (const id of creati.cli)  await db.query('DELETE FROM clients WHERE id=$1', [id]).catch(() => {});
    await db.query('DELETE FROM leads WHERE cognome LIKE $1', ['%' + marca]).catch(() => {});
    console.log('(righe di prova rimosse)');
    srv.close(); process.exit(0);
  }
})();
