// L'INVENTARIO SI GENERA, NON SI RICORDA — fetta 1.5 del riordino (04/09/2026).
//
// La ricognizione del 03/09 (Parte D2.2) aveva contato pagine, rotte e moduli a
// mano, e il CLAUDE.md diceva «~8.000 righe» quando erano 9.586: un numero
// scritto in un documento invecchia dal giorno dopo. Qui si contano dal codice e
// si scrivono in INVENTARIO.md, a ogni `npm run prova`. Chi apre una sessione
// parte da lì.
//
//   node scripts/inventario.js            (scrive INVENTARIO.md e lo stampa)
//   node scripts/inventario.js --verifica (esce 1 se INVENTARIO.md non è aggiornato)
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(REPO, 'server', 'routes.js'), 'utf8');
const righe = src.split('\n');

// Le rotte: metodo e indirizzo, nell'ordine del file.
const rotte = [];
for (const m of src.matchAll(/^router\.(get|post|delete|put)\('([^']+)'/gm)) rotte.push({ metodo: m[1].toUpperCase(), path: m[2] });

// Le pagine: le funzioni che finiscono in «Page», con la riga dove cominciano.
const pagine = [];
righe.forEach((r, i) => { const m = r.match(/^function ([A-Za-z]+Page)\(/); if (m) pagine.push({ nome: m[1], riga: i + 1 }); });

// I moduli del server, con le righe e chi tocca il database.
const moduli = fs.readdirSync(path.join(REPO, 'server')).filter(f => f.endsWith('.js')).sort().map(f => {
  const t = fs.readFileSync(path.join(REPO, 'server', f), 'utf8');
  return { file: f, righe: t.split('\n').length, db: /require\('\.\/db'\)/.test(t) };
});

// Le prove: quelle nella catena di `npm run prova`, nell'ordine in cui girano.
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const catena = String(pkg.scripts.prova || '').split('&&').map(s => s.trim().replace(/^npm run /, ''));

const perMondo = (p) => {
  if (p.startsWith('/dashboard/clients')) return 'clienti e percorsi individuali';
  if (p.startsWith('/dashboard/progetti') || p.startsWith('/dashboard/partecipazioni') || p.startsWith('/dashboard/committenti')) return 'progetti e committenti';
  if (p.startsWith('/dashboard/leads')) return 'lead';
  if (p.startsWith('/dashboard/proforma') || p.startsWith('/dashboard/tranche') || p.startsWith('/dashboard/incassi') || p.startsWith('/dashboard/amministrazione') || p.startsWith('/dashboard/contratti')) return 'amministrazione';
  if (p.startsWith('/dashboard/')) return 'altro (home, icf, ricerca, diagnostica, permessi…)';
  return 'accesso e servizio';
};
const gruppi = new Map();
for (const r of rotte) { const k = perMondo(r.path); if (!gruppi.has(k)) gruppi.set(k, []); gruppi.get(k).push(r); }

let out = '';
out += '# Inventario dell\'Hub — generato da `scripts/inventario.js`\n\n';
out += 'Non si modifica a mano: lo riscrive `npm run prova`. Se un numero qui non torna con quello che ricordi, è cambiato il codice.\n\n';
out += `- \`server/routes.js\`: **${righe.length} righe**, **${pagine.length} pagine**, **${rotte.length} rotte**\n`;
out += `- moduli in \`server/\`: **${moduli.length}** (${moduli.filter(m => m.db).length} usano \`db.js\`, ${moduli.filter(m => !m.db).length} no)\n`;
out += `- prove in \`npm run prova\`: **${catena.length}**, in questo ordine: ${catena.join(' → ')}\n\n`;
out += '## Le pagine (funzioni che finiscono in Page, nell\'ordine del file)\n\n';
out += pagine.map(p => `- \`${p.nome}\` (riga ${p.riga})`).join('\n') + '\n\n';
out += '## Le rotte, per mondo\n\n';
for (const [k, lista] of gruppi) {
  out += `### ${k} (${lista.length})\n\n`;
  out += lista.map(r => `- \`${r.metodo} ${r.path}\``).join('\n') + '\n\n';
}
out += '## I moduli del server\n\n';
out += '| file | righe | usa db.js |\n|---|---|---|\n';
out += moduli.map(m => `| \`${m.file}\` | ${m.righe} | ${m.db ? 'sì' : 'no'} |`).join('\n') + '\n';

const dest = path.join(REPO, 'INVENTARIO.md');
if (process.argv.includes('--verifica')) {
  const attuale = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  if (attuale !== out) { console.log('✗ INVENTARIO.md non è aggiornato: lancia node scripts/inventario.js'); process.exit(1); }
  console.log('✓ INVENTARIO.md è aggiornato al codice.');
} else {
  fs.writeFileSync(dest, out);
  console.log(`✓ INVENTARIO.md riscritto: ${righe.length} righe, ${pagine.length} pagine, ${rotte.length} rotte, ${moduli.length} moduli, ${catena.length} prove.`);
}
