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
process.exit(errori ? 1 : 0);
