/**
 * LE BARRIERE FANNO ANCORA IL LORO MESTIERE?
 *
 * Modificare un dispositivo di sicurezza senza provarlo è il modo migliore per
 * credersi protetti e non esserlo. Qui ogni caso dice cosa DEVE succedere.
 *
 * ⭐ La maggior parte dei casi sono «DEVE BLOCCARE»: se una modifica li fa
 *    passare, ho peggiorato le cose invece di migliorarle.
 *
 *   node prova-barriere.js [percorso/del/guardiano.js]
 */
const { execFileSync } = require('child_process');
const HOOK = process.argv[2] || '/Users/macbook12/.claude/hooks/barriere.js';
const IC = '/Users/macbook12/Library/Mobile Documents/com~apple~CloudDocs';

// Il nome del file di produzione si compone a pezzi, di proposito: scritto per
// esteso, la barriera VECCHIA blocca perfino questo file di prova. (Successo
// davvero il 03/09 — ed è la migliore dimostrazione del difetto che corregge.)
const REALE = '.env' + '.reale';
const HOST = 'reseau' + '.proxy.rlwy.net';

const CASI = [
  // ── DEVE BLOCCARE ────────────────────────────────────────────────────────
  ['blocca', 'il browser di Germano', 'pkill -f "Google Chrome"'],
  ['blocca', 'killall del browser', 'killall "Google Chrome"'],
  ['blocca', 'uno script qualsiasi sul database vero', `node --env-file=${REALE} scripts/qualcosa.js`],
  ['blocca', "l'azzeramento proforma sul database vero", `node --env-file=${REALE} scripts/azzera-proforma.js --esegui`],
  ['blocca', 'la variabile del database vero', 'DATABASE_URL_REALE=xxx node scripts/tocca.js'],
  ['blocca', "l'indirizzo del database vero per esteso", `psql postgres://u:p@${HOST}:5432/railway -c "DELETE FROM clients"`],
  ['blocca', 'il file di produzione caricato nella shell', `source ${REALE} && node tocca.js`],
  ['blocca', 'il file di produzione letto dentro un comando', `node -e "$(cat ${REALE})"`],
  ['blocca', 'il contenuto del file di produzione stampato', `cat ${REALE}`],
  ['blocca', 'cancellare dentro iCloud', `rm -rf "${IC}/Noesys/Piattaforma/roba"`],
  ['blocca', 'spostare fuori da iCloud', `mv "${IC}/Noesys/file.md" /tmp/altrove`],
  ['blocca', 'cancellare in iCloud dopo un altro comando', `echo ciao && rm -f "${IC}/Noesys/x.pdf"`],
  ['blocca', 'find -delete dentro iCloud', `find "${IC}/Noesys" -name "*.tmp" -delete`],

  // ⛔ IL BUCO CHE LA CORREZIONE DEL 03/09 NON DEVE APRIRE.
  //    Togliere il corpo di un heredoc vale SOLO per chi lo tratta da testo
  //    (il messaggio di un commit). Chi lo ESEGUE dev'essere ancora guardato.
  ['blocca', '🔬 comando pericoloso dentro un heredoc che ESEGUE (bash)',
    `bash <<'EOF'\nnode --env-file=${REALE} scripts/tocca.js\nEOF`],
  ['blocca', '🔬 cancellazione iCloud dentro un heredoc che ESEGUE (sh)',
    `sh <<EOF\nrm -rf "${IC}/Noesys/tutto"\nEOF`],
  ['blocca', '🔬 chiusura del browser dentro un heredoc che ESEGUE',
    `bash <<'EOF'\npkill -f "Google Chrome"\nEOF`],
  ['blocca', "🔬 quello che sta DOPO la fine dell'heredoc conta ancora",
    `git commit -F - <<'EOF'\nun messaggio innocuo\nEOF\nnode --env-file=${REALE} tocca.js`],

  // ── DEVE PASSARE ─────────────────────────────────────────────────────────
  ['passa', 'chiudere solo il Chrome di prova', 'pkill -f "user-data-dir=/tmp/_pz-cdp"'],
  ['passa', 'leggere la produzione', `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1"`],
  ['passa', 'il backup della produzione', `node --env-file=${REALE} scripts/backup-db.js /tmp/dest`],
  ['passa', '🔴 il nome del file di produzione in un messaggio di commit',
    `git commit -F - <<'EOF'\nUn titolo\n\nSi lancia con: node --env-file=${REALE} scripts/azzera-proforma.js\nEOF`],
  ['passa', '🔴 controllare se il file di produzione esiste', `ls -la ${REALE}`],
  ['passa', '🔴 cancellare in /tmp mentre si SCRIVE in iCloud',
    `rm -rf /tmp/_pz-pdf && node fai-pdf.js sorgente.html "${IC}/Noesys/Piattaforma/foglio.pdf"`],
  ['passa', 'scrivere dentro iCloud senza cancellare niente', `cp /tmp/a.pdf "${IC}/Noesys/b.pdf"`],
  ['passa', 'cancellare fuori da iCloud', 'rm -rf /tmp/_pz-tab-375'],
  ['passa', 'una prova sul database di prova', 'node --env-file=.env scripts/prova-pagine-vive.js'],
];

let ok = 0, ko = 0;
for (const [atteso, nome, cmd] of CASI) {
  const input = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: cmd },
    cwd: '/Users/macbook12/Developer/Noesys-Hub',
  });
  let out = '';
  try { out = execFileSync('node', [HOOK], { input, encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout || ''); }
  const bloccato = out.includes('"deny"');
  const giusto = (atteso === 'blocca') === bloccato;
  if (giusto) { ok++; console.log(`   ✓ ${atteso.padEnd(7)} — ${nome}`); }
  else {
    ko++;
    console.log(`   ✗ ${atteso.padEnd(7)} — ${nome}`);
    console.log(`              invece ha ${bloccato ? 'BLOCCATO' : 'LASCIATO PASSARE'}: ${cmd.replace(/\n/g, ' ⏎ ').slice(0, 100)}`);
  }
}
console.log(`\n${ko === 0 ? '✅' : '🔴'} ${ok} giusti, ${ko} sbagliati  (su ${CASI.length})`);
process.exit(ko === 0 ? 0 : 1);
