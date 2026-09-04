// PROVA DELL'AUTOMAZIONE — fetta 2.3 del riordino (04/09/2026), «Drive completo».
//
// Tre difetti della ricognizione (B4/B2), provati coi numeri e senza rete:
//  1. Drive restituisce al massimo 100 file per cartella e l'Hub leggeva una
//     pagina sola: oltre il 100° elemento i report NON ESISTEVANO.
//  2. Nessun timeout e nessun ritentativo verso Drive e Gmail: un 503 di un
//     istante faceva saltare la passata.
//  3. Un report di un percorso concluso finiva nel percorso ATTIVO: lo scanner
//     prendeva un solo percorso per cliente ma leggeva le cartelle di tutti.
//
//   node scripts/prova-automazione.js

const drive = require('../server/google-drive');
const scan = require('../server/scan');

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) { console.log(`✓ ${titolo}`); }
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

(async () => {
  console.log('— 1 · TUTTE LE PAGINE DI DRIVE, NON SOLO LA PRIMA —');
  prova('raccogliPagine esiste', 'function', typeof drive.raccogliPagine);
  if (typeof drive.raccogliPagine === 'function') {
    // Un Drive finto che risponde a pagine: 100 + 100 + 37 file.
    const pagine = { '': { files: Array.from({ length: 100 }, (_, i) => ({ id: 'a' + i })), nextPageToken: 'p2' },
                     p2: { files: Array.from({ length: 100 }, (_, i) => ({ id: 'b' + i })), nextPageToken: 'p3' },
                     p3: { files: Array.from({ length: 37 }, (_, i) => ({ id: 'c' + i })) } };
    const chieste = [];
    const tutti = await drive.raccogliPagine(async (token) => { chieste.push(token || ''); return pagine[token || '']; });
    prova('237 file su tre pagine arrivano tutti', 237, tutti.length);
    prova('  e le pagine sono state chieste in ordine, col loro segnalibro', ['', 'p2', 'p3'], chieste);
    prova('  il 101° file esiste (prima no)', 'b0', tutti[100].id);
    prova('una cartella vuota dà un elenco vuoto, non un errore', [], await drive.raccogliPagine(async () => ({})));
    // 🔬 un Drive che rimanda sempre alla stessa pagina non deve far girare in tondo
    let giri = 0;
    const loop = await drive.raccogliPagine(async () => { giri++; return { files: [{ id: 'x' }], nextPageToken: 'sempre' }; });
    prova('🔬 un segnalibro che si ripete all\'infinito viene fermato', true, giri <= 50 && loop.length === giri);
  }

  console.log('\n— 2 · UN INTOPPO PASSEGGERO SI RITENTA, UN ERRORE VERO NO —');
  prova('conRitentativo esiste', 'function', typeof drive.conRitentativo);
  if (typeof drive.conRitentativo === 'function') {
    let n = 0;
    const ok = await drive.conRitentativo(async () => { n++; if (n === 1) { const e = new Error('Drive API 503: backend'); e.status = 503; throw e; } return 'fatto'; }, { attesaMs: 1 });
    prova('un 503 al primo colpo, poi va: si ritenta UNA volta e passa', ['fatto', 2], [ok, n]);
    n = 0;
    const ok2 = await drive.conRitentativo(async () => { n++; if (n === 1) { const e = new Error('Drive API 429: rate'); e.status = 429; throw e; } return 'fatto'; }, { attesaMs: 1 });
    prova('anche un 429 (troppe richieste)', ['fatto', 2], [ok2, n]);
    n = 0;
    let err = null;
    try { await drive.conRitentativo(async () => { n++; const e = new Error('Drive API 404: not found'); e.status = 404; throw e; }, { attesaMs: 1 }); } catch (e) { err = e.message; }
    prova('🔬 un 404 NON si ritenta: è un errore vero, si dice subito', ['Drive API 404: not found', 1], [err, n]);
    n = 0; err = null;
    try { await drive.conRitentativo(async () => { n++; const e = new Error('Drive API 503: giù'); e.status = 503; throw e; }, { attesaMs: 1 }); } catch (e) { err = e.message; }
    prova('🔬 due 503 di fila: si ritenta una volta sola, poi si dice', ['Drive API 503: giù', 2], [err, n]);
    n = 0;
    const ok3 = await drive.conRitentativo(async () => { n++; if (n === 1) { const e = new Error('fetch failed'); e.name = 'TypeError'; throw e; } return 'fatto'; }, { attesaMs: 1 });
    prova('un errore di rete (fetch failed) si ritenta come un 503', ['fatto', 2], [ok3, n]);
    prova('il timeout verso Drive esiste ed è ragionevole (10-60 s)', true, drive.TIMEOUT_MS >= 10000 && drive.TIMEOUT_MS <= 60000);
  }

  console.log('\n— 3 · IL REPORT VA NEL PERCORSO DELLA SUA CARTELLA —');
  prova('percorsoPerReport esiste', 'function', typeof scan.percorsoPerReport);
  if (typeof scan.percorsoPerReport === 'function') {
    const percorsi = [
      { id: 'vecchio', stato: 'concluso', tipo: 'Individuale', drive_url: 'https://drive.google.com/drive/folders/CART-VECCHIA', created_at: '2026-01-01' },
      { id: 'nuovo',   stato: 'attivo',   tipo: 'Individuale', drive_url: 'https://drive.google.com/drive/folders/CART-NUOVA',   created_at: '2026-06-01' },
      { id: 'senza',   stato: 'attivo',   tipo: 'Individuale', drive_url: null, created_at: '2026-08-01' },
    ];
    const per = (rep) => (scan.percorsoPerReport(percorsi, rep) || {}).id;
    prova('un report nella cartella del percorso CONCLUSO va lì, non nell\'attivo', 'vecchio', per({ percorsoFolderId: 'CART-VECCHIA', percorsoFolderName: 'Percorso 2026-01' }));
    prova('un report nella cartella del percorso nuovo va nel nuovo', 'nuovo', per({ percorsoFolderId: 'CART-NUOVA' }));
    prova('senza cartella riconosciuta si ripiega sull\'attivo più recente (regola di prima)', 'senza', per({ percorsoFolderId: 'CART-SCONOSCIUTA' }));
    prova('la struttura semplificata (report sotto la cartella cliente) ripiega allo stesso modo', 'senza', per({}));
    prova('con un solo percorso, va lì comunque', 'unico', (scan.percorsoPerReport([{ id: 'unico', stato: 'concluso', drive_url: null }], { percorsoFolderId: 'X' }) || {}).id);
    prova('senza percorsi: null, non un errore', null, scan.percorsoPerReport([], { percorsoFolderId: 'X' }));
  }

  console.log('\n— 4 · L\'AUTOMAZIONE SI VEDE (fetta 2.2): il riassunto e le voci della home —');
  const au = require('../server/automazione');
  const r1 = au.riassunto({ processed: [{}, {}], skipped: 3, clients: 4,
    errors: [{ cliente: 'Rossi', file: 'Report X.docx', err: 'Word vuoto' }, { cliente: 'Bianchi', file: 'Report Y.docx', err: 'limite per passata raggiunto' }],
    ignorati: [{ cliente: 'Rossi', file: 'Appunti.docx' }] });
  prova('il riassunto conta fatti, saltati, soggetti', [2, 3, 4], [r1.fatti, r1.saltati, r1.soggetti]);
  prova('gli errori veri restano, il tetto raggiunto diventa «rimasti»', [1, 1], [r1.errori.length, r1.rimasti]);
  prova('gli ignorati portano cliente e file', [{ chi: 'Rossi', file: 'Appunti.docx' }], r1.ignorati);
  const r2 = au.riassunto({ proposte: [{}], letti: 5, clients: 2, errors: [{ dove: 'configurazione', errore: 'Drive non configurato' }] });
  prova('regge anche il formato dei moduli (proposte/letti, dove/errore)', [1, 2, 'Drive non configurato'], [r2.fatti, r2.soggetti, r2.errori[0].err]);
  const voci = au.perHome([
    { passata: 'report-clienti', ok: false, errore: 'Chiavi Google mancanti' },
    { passata: 'report-progetti', ok: true, esito: r1 },
    { passata: 'moduli', ok: true, esito: { fatti: 0, errori: [], ignorati: [], rimasti: 0 } },
  ]);
  prova('una passata esplosa diventa una voce grave con la causa', true, voci.some(v => v.grave && /Chiavi Google mancanti/.test(v.testo) && /report dei clienti/.test(v.testo)));
  prova('un report illeggibile è una voce grave col nome del file', true, voci.some(v => v.grave && /Rossi/.test(v.testo) && /Report X\.docx/.test(v.testo) && /Word vuoto/.test(v.testo)));
  prova('un file ignorato per nome è una voce NON grave che dice di rinominarlo', true, voci.some(v => !v.grave && /Appunti\.docx/.test(v.testo) && /Rinominalo/.test(v.testo)));
  prova('il tetto raggiunto è una voce che dice quanti restano', true, voci.some(v => /1 report lasciato/.test(v.testo)));
  prova('una passata pulita non produce voci', 0, au.perHome([{ passata: 'moduli', ok: true, esito: { errori: [], ignorati: [] } }]).length);
  prova('nessuna passata: nessuna voce, non un errore', [], au.perHome([]));

  console.log(falliti ? `\n🔴 ${falliti} prove fallite` : '\n✅ automazione: tutte le prove passano');
  process.exit(falliti ? 1 : 0);
})();
