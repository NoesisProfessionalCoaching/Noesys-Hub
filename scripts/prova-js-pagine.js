// Prova il JAVASCRIPT DELLE PAGINE dell'Hub, non solo il file che lo contiene.
// Le pagine sono template literal: `node --check routes.js` dice solo che il file è
// valido, non che lo script che finisce nel browser lo sia. Qui si estrae ogni blocco
// <script>, si sostituiscono le interpolazioni ${...} con un valore finto, e si passa
// il risultato a node --check: così una graffa o una parentesi sbagliata dentro una
// pagina si vede subito, senza dover aprire il browser.
//
//   node scripts/prova-js-pagine.js            (controlla server/routes.js)
//   node scripts/prova-js-pagine.js altro.js
//
// Esce con codice 0 se è tutto valido, 1 se un blocco è rotto.
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'server', 'routes.js');
const src = fs.readFileSync(file, 'utf8');
const tmpDir = path.join(os.tmpdir(), 'noesys-prova-js-pagine');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Toglie ${...} tenendo conto delle graffe annidate.
function togliInterpolazioni(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let livello = 1, j = i + 2;
      while (j < s.length && livello > 0) {
        if (s[j] === '{') livello++;
        else if (s[j] === '}') livello--;
        j++;
      }
      out += 'null';
      i = j;
    } else { out += s[i]; i++; }
  }
  return out;
}

// Dentro un template literal Node scioglie gli escape PRIMA che il browser veda il
// codice: nel sorgente si scrive \\' per far arrivare \' alla pagina, e \\d per far
// arrivare \d a un'espressione regolare. Senza questo passaggio il controllo darebbe
// falsi allarmi proprio sulle righe scritte giuste.
function sciogliEscape(s) {
  return s.replace(/\\([\s\S])/g, (_, c) => {
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === 'r') return '\r';
    return c;
  });
}

const blocchi = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m, n = 0;
while ((m = re.exec(src)) !== null) {
  const riga = src.slice(0, m.index).split('\n').length;
  blocchi.push({ riga, codice: sciogliEscape(togliInterpolazioni(m[1])) });
}

// ⭐ 18/08 (C4) — IL JS CHE ARRIVA DA UN MODULO NON PASSAVA DA NESSUNA PROVA.
// I blocchi qui sopra si estraggono da routes.js come TESTO: dove la pagina
// scrive `${pianoUi.js(...)}` il controllo vede «null» e non guarda dentro. Ma
// lì ci sono centinaia di righe di JavaScript vero — la finestrella del piano,
// quella dell'incasso — e un errore di sintassi sarebbe arrivato nel browser
// passando tutte le prove. È lo stesso buco che nel 15/08 aveva reso necessario
// `prova-file`: una regola che non sta nella rete di sicurezza prima o poi salta.
// ⚠️ Si chiamano con dei dati finti: qui si guarda la SINTASSI, non il risultato.
const pianoUi = require('../server/piano-ui');
const daiModuli = [
  { nome: 'piano-ui.js — la finestrella del piano',
    codice: () => pianoUi.js({ piani: [], dataFirma: '2026-01-01', quotaPerPagatore: true }) },
  { nome: 'piano-ui.js — la finestrella dell’incasso', codice: () => pianoUi.jsIncasso() },
  { nome: 'collaudo.js — l’interruttore vero/di collaudo', codice: () => require('../server/collaudo').js() },
];
// ⚠️ Qui il codice arriva GIÀ come lo vedrà il browser: le interpolazioni sono
// state risolte da JavaScript e gli escape sono già sciolti. Passarci sopra i
// due traduttori di sopra — che servono a leggere il SORGENTE — lo rovinerebbe
// e darebbe errori inventati (ci sono cascato scrivendolo).
for (const d of daiModuli) {
  blocchi.push({ riga: d.nome, codice: d.codice() });
}

let errori = 0;
for (const b of blocchi) {
  n++;
  const f = path.join(tmpDir, `blocco-${n}.js`);
  fs.writeFileSync(f, b.codice);
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' });
    console.log(`✓ blocco ${n} (${typeof b.riga === "number" ? "pagina che comincia a riga " + b.riga : b.riga}): ok`);
  } catch (e) {
    errori++;
    console.log(`✗ blocco ${n} (${typeof b.riga === "number" ? "pagina che comincia a riga " + b.riga : b.riga}) NON VALIDO:`);
    console.log(String(e.stderr).split('\n').slice(0, 6).join('\n'));
  }
}
console.log(`\n${blocchi.length} blocchi controllati, ${errori} con errori.`);

// ═══ FETTA 0.4 DEL RIORDINO (03/09/2026) — LE TRAPPOLE CHE IL COMPILATORE NON VEDE ═══
// Tre controlli sul SORGENTE e sul markup che la finestrella costruisce nel browser.
// Nessuno dei tre è un errore di sintassi: sono cose che compilano e poi si rompono
// in mano al coach. Per questo stanno qui e non in `node --check`.
let guai = 0;
const guaio = (t, dettaglio) => { guai++; console.log('✗ ' + t); if (dettaglio) console.log('    ' + dettaglio); };
const bene = (t) => console.log('✓ ' + t);

// 1 · UN APOSTROFO NEL NOME SPEGNE IL PULSANTE. `esc()` scrive ' come &#39;, ma il
//     browser decodifica l'attributo PRIMA di leggere il JavaScript: dentro
//     onclick="f('D&#39;Amico')" arriva f('D'Amico') e la stringa si chiude a metà.
//     Un valore libero dentro un onclick si scrive con jsStr(), che lo trasforma in
//     una stringa JavaScript vera (JSON) e poi la rende sicura per l'attributo.
{
  const righe = src.split('\n');
  const colpevoli = [];
  righe.forEach((r, i) => {
    // un ${esc(...)} o ${attr(...)} racchiuso da apici SINGOLI dentro un onclick="…"
    if (/onclick="[^"\n]*'\$\{(?:esc|attr)\(/.test(r)) colpevoli.push((i + 1) + ': ' + r.trim().slice(0, 110));
  });
  if (colpevoli.length) guaio(`${colpevoli.length} onclick con esc()/attr() dentro apici singoli (un apostrofo nel nome li spegne)`, colpevoli.join('\n    '));
  else bene('nessun onclick mette un valore libero fra apici singoli con esc()/attr()');
}

// 2 · itDate() SU UN TIMESTAMP (trappola n. 4 del CLAUDE.md): esce «Wed Aug 12».
//     Per un momento nel tempo si usa itDateTime(). Le colonne che sono momenti
//     finiscono tutte per _at o _data col fuso: created_at, updated_at, inviata_data…
{
  const righe = src.split('\n');
  const colpevoli = [];
  righe.forEach((r, i) => {
    if (/\bitDate\([^()]*\b(?:created_at|updated_at|inviata_data|mail1_inviata_data|approvata_data|data_invio)\b/.test(r)) {
      colpevoli.push((i + 1) + ': ' + r.trim().slice(0, 110));
    }
  });
  if (colpevoli.length) guaio(`${colpevoli.length} itDate() su un timestamp`, colpevoli.join('\n    '));
  else bene('itDate() non viene mai chiamata su un timestamp');
}

// 3 · LA FINESTRELLA DEL PIANO costruisce i suoi pulsanti nel browser, quindi il
//     controllo 1 non la vede. Si fa girare DAVVERO il suo JavaScript con un
//     documento finto, un pagatore che si chiama D'Amico e una rata «Sant'Anna»,
//     e si controlla che ogni onclick prodotto, decodificato come farebbe il
//     browser, sia JavaScript valido.
{
  const vm = require('vm');
  const decodifica = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const piani = [{
    key: 'pa-1', pid: 'p1', nome: "Marco D'Amico", ruolo: 'partecipante', quota: 3000, tipo: 'partecipante',
    righe: [
      { id: 'r1', etichetta: "Quota Sant'Anna", importo: 1500, innesco: 'firma', giorni: 30, stato: 'da_chiedere', doc: null, data_incasso: null },
      { id: 'r2', etichetta: "Saldo dell'anno", importo: 1500, innesco: 'fine', giorni: 30, stato: 'chiesta',
        doc: { proformaId: 'pf1', numero: '2026/009', residuo: 1830, stato: 'inviata' }, data_incasso: null },
    ],
  }];
  const tabella = { innerHTML: '' }, finestrella = { innerHTML: '', querySelectorAll: () => [] };
  const documento = {
    getElementById: (id) => id === 'amm-righe' ? tabella : id === 'piano-pagatori' ? finestrella : null,
    querySelectorAll: () => [],
  };
  const ctx = { document: documento, console, azioniPagatore: () => '', fetch: () => Promise.resolve({}), alert: () => {}, confirm: () => true, location: { reload: () => {} }, sessionStorage: { setItem: () => {} } };
  ctx.window = ctx;
  try {
    vm.createContext(ctx);
    vm.runInContext(pianoUi.js({ piani, dataFirma: '2026-10-01', quotaPerPagatore: true }) + '\ndisegnaPiano(); costruisciFinestrella();', ctx);
    const html = tabella.innerHTML + finestrella.innerHTML;
    const onclicks = [...html.matchAll(/onclick="([^"]*)"/g)].map(m => decodifica(m[1]));
    const rotti = onclicks.filter(c => { try { new Function(c); return false; } catch (e) { return true; } });
    if (!onclicks.length) guaio('la finestrella non ha prodotto nessun pulsante: la prova non ha visto niente');
    else if (rotti.length) guaio(`${rotti.length} pulsanti su ${onclicks.length} si rompono con un apostrofo nel nome`, rotti.map(c => c.slice(0, 100)).join('\n    '));
    else bene(`i ${onclicks.length} pulsanti della finestrella reggono un apostrofo nel nome e nella rata`);
  } catch (e) {
    guaio('il JavaScript della finestrella non gira nel documento finto: ' + e.message);
  }
}

console.log(`\n${guai ? '✗' : '✓'} ${guai} trappole trovate.`);
process.exit(errori || guai ? 1 : 0);
