/**
 * IL TIMBRO — l'ultimo anello di `npm run prova`.
 *
 * Gira solo se tutti i controlli prima di lui sono passati (la fila in
 * `package.json` è legata con `&&`: se uno fallisce, qui non si arriva).
 * Scrive `.prova-passata` con l'impronta del codice appena verificato.
 *
 * A che serve: la barriera del `git push` (`~/.claude/hooks/barriere.js`)
 * legge questo file. Se manca, o se l'impronta non combacia con il codice di
 * adesso, il push non parte. Così «provare prima di pubblicare» smette di
 * essere una promessa e diventa una condizione.
 *
 * ⚠️ Il timbro NON si scrive a mano. Scriverlo senza aver lanciato le prove
 *    servirebbe solo a far passare per fatta una verifica che non è stata
 *    fatta — cioè a rompere l'unica cosa che questo file protegge.
 */
const fs = require('fs');
const { TIMBRO, improntaHub } = require('./impronta.js');

const timbro = {
  impronta: improntaHub(),
  quando: new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' }),
};
fs.writeFileSync(TIMBRO, JSON.stringify(timbro, null, 2) + '\n');
console.log(`\n🔓 Timbro messo (${timbro.quando}): il push di questo codice è sbloccato.`);
