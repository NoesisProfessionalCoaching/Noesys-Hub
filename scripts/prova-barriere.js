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

  // ⛔ L'ESENZIONE VALE PER PEZZO DI COMANDO, NON PER L'INTERO COMANDO (03/09/2026).
  //    La ricognizione indipendente ha provato che questi due PASSAVANO: bastava
  //    che `guarda-produzione.js` comparisse da qualche parte, e nello stesso
  //    comando un `&& … azzera-proforma.js --esegui` arrivava alla produzione.
  ['blocca', '🔴 una lettura E POI una scrittura sul database vero, nello stesso comando (&&)',
    `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1" && node --env-file=${REALE} scripts/azzera-proforma.js --esegui`],
  ['blocca', '🔴 una lettura E POI la copia del file di produzione (;)',
    `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1" ; cp ${REALE} /tmp/x`],
  ['blocca', 'una lettura e poi una scrittura, separate da un a capo',
    `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1"\nnode --env-file=${REALE} scripts/tocca.js`],
  ['blocca', 'un backup e poi una scrittura, separati da una pipe',
    `node --env-file=${REALE} scripts/backup-db.js /tmp/dest | node --env-file=${REALE} scripts/tocca.js`],
  // Copiare il file di produzione è come leggerlo: da lì si raggiunge il database.
  ['blocca', 'copiare il file di produzione (cp)', `cp ${REALE} /tmp/x`],
  ['blocca', 'copiare il file di produzione altrove (scp)', `scp ${REALE} altrove:/tmp/x`],
  ['blocca', 'copiare il file di produzione (rsync)', `rsync -a ${REALE} /tmp/`],

  // ── DEVE PASSARE ─────────────────────────────────────────────────────────
  ['passa', 'chiudere solo il Chrome di prova', 'pkill -f "user-data-dir=/tmp/_pz-cdp"'],
  ['passa', 'leggere la produzione', `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1"`],
  ['passa', 'il backup della produzione', `node --env-file=${REALE} scripts/backup-db.js /tmp/dest`],
  ['passa', 'leggere la produzione e filtrare il risultato con una pipe',
    `node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1" | head -5`],
  ['passa', 'entrare nella cartella e poi leggere la produzione',
    `cd /Users/macbook12/Developer/Noesys-Hub && node --env-file=${REALE} scripts/guarda-produzione.js "SELECT 1"`],
  ['passa', '🔴 il nome del file di produzione in un messaggio di commit',
    `git commit -F - <<'EOF'\nUn titolo\n\nSi lancia con: node --env-file=${REALE} scripts/azzera-proforma.js\nEOF`],
  ['passa', '🔴 controllare se il file di produzione esiste', `ls -la ${REALE}`],
  ['passa', '🔴 cancellare in /tmp mentre si SCRIVE in iCloud',
    `rm -rf /tmp/_pz-pdf && node fai-pdf.js sorgente.html "${IC}/Noesys/Piattaforma/foglio.pdf"`],
  ['passa', 'scrivere dentro iCloud senza cancellare niente', `cp /tmp/a.pdf "${IC}/Noesys/b.pdf"`],
  ['passa', 'cancellare fuori da iCloud', 'rm -rf /tmp/_pz-tab-375'],
  ['passa', 'una prova sul database di prova', 'node --env-file=.env scripts/prova-pagine-vive.js'],
];

// ── SE MANCA impronta.js, LE BARRIERE DEVONO RESTARE VIVE (03/09/2026) ──────
// Il guardiano carica `impronta.js` dal repo per la barriera del push. Prima lo
// caricava FUORI dal blocco protetto: se il file mancava (repo spostato, file
// rinominato) l'hook moriva con un errore, e per un hook un errore NON è un
// blocco — tutte e quattro le barriere smettevano di esistere, in silenzio.
// Qui si simula proprio quel caso: una copia del guardiano che punta a un
// impronta.js inesistente. Tre barriere su quattro devono funzionare come
// prima, e la quarta deve FERMARE il push spiegando che manca il file.
const CASI_SENZA_IMPRONTA = [
  ['blocca', '🔬 senza impronta.js: il browser di Germano è ancora protetto', 'pkill -f "Google Chrome"'],
  ['blocca', '🔬 senza impronta.js: il database vero è ancora protetto', `node --env-file=${REALE} scripts/tocca.js`],
  ['blocca', '🔬 senza impronta.js: le cartelle iCloud sono ancora protette', `rm -rf "${IC}/Noesys/roba"`],
  ['blocca', "🔬 senza impronta.js: il push dell'Hub si ferma, con un messaggio che dice cosa manca",
    // (nella copia di prova il file si chiama «impronta-che-non-esiste.js»: si controlla la parola «impronta»)
    'git -C /Users/macbook12/Developer/Noesys-Hub push origin main', /impronta/],
  ['passa', '🔬 senza impronta.js: un comando innocuo passa', 'ls -la /tmp'],
];

function guardianoSenzaImpronta() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const sorgente = fs.readFileSync(HOOK, 'utf8');
  const finto = sorgente.replace(/scripts\/impronta\.js/g, 'scripts/impronta-che-non-esiste.js');
  if (finto === sorgente) throw new Error('il guardiano non nomina impronta.js: la prova non ha senso');
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-barriere-'));
  const file = path.join(cartella, 'barriere-senza-impronta.js');
  fs.writeFileSync(file, finto);
  return file;
}

/** Fa girare il guardiano su ogni caso e conta. `motivo` (facoltativo) è una regex che il messaggio di rifiuto deve contenere. */
function prova(hook, casi) {
  let ok = 0, ko = 0;
  for (const [atteso, nome, cmd, motivo] of casi) {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: cmd },
      cwd: '/Users/macbook12/Developer/Noesys-Hub',
    });
    let out = '';
    try { out = execFileSync('node', [hook], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch (e) { out = String(e.stdout || ''); }
    const bloccato = out.includes('"deny"');
    let giusto = (atteso === 'blocca') === bloccato;
    let perche = `invece ha ${bloccato ? 'BLOCCATO' : 'LASCIATO PASSARE'}`;
    if (giusto && motivo && !motivo.test(out)) {
      giusto = false;
      perche = `ha bloccato, ma il messaggio non dice ${motivo}`;
    }
    if (giusto) { ok++; console.log(`   ✓ ${atteso.padEnd(7)} — ${nome}`); }
    else {
      ko++;
      console.log(`   ✗ ${atteso.padEnd(7)} — ${nome}`);
      console.log(`              ${perche}: ${cmd.replace(/\n/g, ' ⏎ ').slice(0, 100)}`);
    }
  }
  return { ok, ko };
}

console.log(`Guardiano: ${HOOK}`);
const a = prova(HOOK, CASI);
console.log('\n   — e se impronta.js non ci fosse? —');
let b = { ok: 0, ko: CASI_SENZA_IMPRONTA.length };
try { b = prova(guardianoSenzaImpronta(), CASI_SENZA_IMPRONTA); }
catch (e) { console.log(`   ✗ non sono riuscito a costruire il guardiano senza impronta: ${e.message}`); }
const ok = a.ok + b.ok, ko = a.ko + b.ko, tot = CASI.length + CASI_SENZA_IMPRONTA.length;
console.log(`\n${ko === 0 ? '✅' : '🔴'} ${ok} giusti, ${ko} sbagliati  (su ${tot})`);
process.exit(ko === 0 ? 0 : 1);
