/**
 * L'IMPRONTA DEL CODICE DELL'HUB — scritta in un posto solo.
 *
 * Risponde a UNA domanda: «il codice che sto per pubblicare è lo stesso su cui
 * `npm run prova` è passata?». Guarda il CONTENUTO dei file, non i commit,
 * perché le prove si lanciano PRIMA di committare.
 *
 * La usano in due: `prova-timbro.js`, che mette il timbro quando la fila delle
 * prove arriva in fondo, e la barriera del `git push` (`~/.claude/hooks/
 * barriere.js`), che quel timbro lo controlla. Scritta due volte, prima o poi
 * le due copie direbbero cose diverse — ed è l'errore che tutto questo lavoro
 * esiste per non ripetere.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RADICE = path.join(__dirname, '..');
const TIMBRO = path.join(RADICE, '.prova-passata');

/** Tutti i .js di server/ e scripts/, più package.json, in ordine stabile. */
function improntaHub() {
  const pezzi = [];
  const cammina = (dir) => {
    const voci = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const voce of voci) {
      const p = path.join(dir, voce.name);
      if (voce.isDirectory()) cammina(p);
      else if (voce.name.endsWith('.js')) pezzi.push(p + '\n' + fs.readFileSync(p, 'utf8'));
    }
  };
  for (const c of [path.join(RADICE, 'server'), path.join(RADICE, 'scripts')]) {
    if (fs.existsSync(c)) cammina(c);
  }
  const pkg = path.join(RADICE, 'package.json');
  if (fs.existsSync(pkg)) pezzi.push('package.json\n' + fs.readFileSync(pkg, 'utf8'));
  return crypto.createHash('sha1').update(pezzi.join('\n \n')).digest('hex');
}

module.exports = { RADICE, TIMBRO, improntaHub };
