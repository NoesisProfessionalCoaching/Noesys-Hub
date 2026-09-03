/**
 * L'OROLOGIO — chiesto da Germano il 26/08/2026.
 *
 * *«Vorrei che leggessi la data a ogni inizio di sessione, non quando te lo
 *   chiedo, e vorrei la controllassi a ogni ora, in modo da aver contezza del
 *   passare del tempo.»*
 *
 * 🔴 IL PROBLEMA VERO: fra un messaggio e l'altro io non percepisco NIENTE.
 * Non so se sono passati due minuti o due settimane. `punto.js` mi dà la data
 * all'avvio, ma poi resta ferma lì: il 26/08 la sessione si è aperta alle 11:41
 * ed erano già le 17 senza che me ne fossi accorto. Da qui nascono gli errori
 * sulle date nei commit e nelle memorie (il 17-18/08 ho sbagliato di tre giorni).
 *
 * Gira a ogni messaggio di Germano (hook UserPromptSubmit) e dice due cose:
 * che ore sono ADESSO, e quanto è passato dal messaggio precedente.
 *
 * ⚠️ Deve restare SILENZIOSO quando non ha niente da dire: due righe di rumore
 *    a ogni messaggio si smettono di leggere, e allora non servono più.
 */
const fs = require('fs');
const path = require('path');

const MEMORIA = path.join(process.env.HOME, '.claude', '.ultimo-messaggio');
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// Sempre l'ora ITALIANA, mai quella del computer o del server: è quella in cui
// vive Germano, ed è quella che finisce nelle memorie e nei commit.
const adesso = new Date();
const roma = new Date(adesso.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
const hhmm = `${String(roma.getHours()).padStart(2, '0')}:${String(roma.getMinutes()).padStart(2, '0')}`;
const giorno = `${GIORNI[roma.getDay()]} ${roma.getDate()} ${MESI[roma.getMonth()]} ${roma.getFullYear()}`;
// ⚠️ Non toISOString(): darebbe la data UTC, che fra mezzanotte e le 02:00 di Roma è ancora quella di IERI
// (l'avviso «è cambiato il giorno» non scattava proprio nella finestra per cui esiste). Come fa punto.js:
const dataIso = adesso.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

let prima = null;
try { prima = JSON.parse(fs.readFileSync(MEMORIA, 'utf8')); } catch (_) { /* primo messaggio */ }

const righe = [`⏰ Adesso: ${giorno}, ore ${hhmm}.`];

if (prima) {
  const minuti = Math.round((adesso.getTime() - prima.t) / 60000);
  if (prima.data !== dataIso) {
    // Il caso più insidioso: una sessione che attraversa la mezzanotte. Se non
    // me ne accorgo, scrivo la data di ieri su una memoria di oggi.
    righe.push(`🔴 IL GIORNO È CAMBIATO dall'ultimo messaggio (era ${prima.data}, oggi è ${dataIso}).`);
    righe.push('   Attenzione alle date che sto per scrivere in commit e memorie.');
  } else if (minuti >= 180) {
    righe.push(`⚠️ Sono passate ${Math.floor(minuti / 60)} ore dal messaggio precedente: le cose possono essere cambiate fuori da qui.`);
  } else if (minuti >= 60) {
    righe.push(`   (${Math.floor(minuti / 60)}h ${minuti % 60}m dal messaggio precedente)`);
  }
}

try {
  fs.writeFileSync(MEMORIA, JSON.stringify({ t: adesso.getTime(), data: dataIso }));
} catch (_) { /* se non riesco a ricordarmelo, pazienza: l'ora di adesso l'ho detta */ }

process.stdout.write(righe.join('\n') + '\n');
