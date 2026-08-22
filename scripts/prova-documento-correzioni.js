// ═══════════════════════════════════════════════════════════════════════════
// ⭐ LA PROVA CHE CONTA DI PIÙ IN QUESTA FETTA:
//    «arriva la ruota della Final, le correzioni del coach restano quelle».
//
// Il documento di chiusura CONTINUA A CRESCERE dopo che il coach l'ha letto e
// approvato: durante la sessione arriva la seconda ruota, dopo la sessione arriva
// il report della Final. Ogni volta la macchina riscrive la parte generata.
// Se generato e correzioni vivessero nello stesso posto, ogni arrivo cancellerebbe
// quello che lui ha riscritto — e se ne accorgerebbe davanti al cliente.
// Qui si prova, sul database vero (in una stanza temporanea), che non succede.
//
//   node --env-file=.env scripts/prova-documento-correzioni.js
// ═══════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const url = process.env.DATABASE_URL;
if (!url) { console.error('✗ Manca DATABASE_URL. Lancia con: node --env-file=.env scripts/prova-documento-correzioni.js'); process.exit(1); }
const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';
if (host.startsWith('reseau')) { console.error('✗ Questo è il database VERO. La prova gira solo sullo sviluppo.'); process.exit(1); }
const schema = 'prova_doc_' + process.pid + '_' + Date.now().toString(36);
const ssl = () => (url.includes('.railway.internal') || url.includes('localhost')) ? false : { rejectUnauthorized: false };

let falliti = 0;
// ⚠️ Confronto che NON guarda l'ordine delle chiavi: Postgres restituisce il jsonb
// riordinato a modo suo, e un confronto ingenuo griderebbe al guasto su una cosa
// che guasto non è (già successo il 21/08: due «✗» erano prove sbagliate, non codice rotto).
function stabile(x) {
  if (Array.isArray(x)) return '[' + x.map(stabile).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stabile(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
function prova(titolo, atteso, ottenuto) {
  const a = stabile(atteso), o = stabile(ottenuto);
  if (a === o) console.log(`✓ ${titolo}`);
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

// Due versioni dello stesso documento: la prima (una ruota sola) e quella
// rigenerata dopo che è arrivata la seconda ruota.
const PRIMA = {
  filo: { titolo: 'Il filo, come lo ha visto la macchina', corpo: ['primo paragrafo'] },
  momenti: [{ titolo: 'Primo momento', corpo: ['come lo ha scritto la macchina'] }],
  chiusura: { titolo: 'Francesco', messaggio: 'saluto generato' },
};
const DOPO = {
  filo: { titolo: 'Il filo, riscritto dalla macchina', corpo: ['primo paragrafo, rifatto'] },
  momenti: [{ titolo: 'Primo momento', corpo: ['riscritto dopo la seconda ruota'] }],
  chiusura: { titolo: 'Francesco', messaggio: 'saluto rigenerato' },
  variazioni: { salite: 3, scese: 1 },   // la parte nuova, che prima non c'era
};

(async () => {
  const admin = new Pool({ connectionString: url, ssl: ssl() });
  let creata = false;
  try {
    console.log(`Database: ${host}\nStanza di prova: ${schema}\n`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    creata = true;
    const sep = url.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${url}${sep}options=${encodeURIComponent('-c search_path=' + schema)}`;
    const db = require('../server/db.js');
    const doc = require('../server/documento-chiusura.js');
    await db.init();

    const cid = randomUUID(), pid = randomUUID();
    await db.query('INSERT INTO clients (id, name, token) VALUES ($1,$2,$3)', [cid, 'Cliente di prova', randomUUID()]);
    await db.query('INSERT INTO percorsi (id, client_id) VALUES ($1,$2)', [pid, cid]);

    // 1. Il documento nasce con una ruota sola.
    const id = await doc.salvaGenerato({ percorsoId: pid, clientId: cid, sedutaId: null, contenuti: PRIMA,
      ruote: { intake: { id: 'ruota-intake' }, final: null } });

    // 2. Il coach legge, corregge due pezzi e approva.
    await doc.salvaCorrezione({ documentoId: id, sentiero: 'chiusura.messaggio', testo: 'Il saluto come lo scrivo io.' });
    await doc.salvaCorrezione({ documentoId: id, sentiero: 'momenti.0.corpo.0', testo: 'Questo momento lo racconto così.' });

    // 3. Durante la sessione arriva la SECONDA RUOTA: la macchina rigenera.
    const id2 = await doc.salvaGenerato({ percorsoId: pid, clientId: cid, sedutaId: null, contenuti: DOPO,
      ruote: { intake: { id: 'ruota-intake' }, final: { id: 'ruota-final' } } });
    prova('la rigenerazione non crea un secondo documento', id, id2);

    const riga = await doc.caricaDocumento({ percorsoId: pid });
    prova('la parte generata è quella nuova', 'Il filo, riscritto dalla macchina', riga.generato.filo.titolo);
    prova('la seconda ruota è agganciata', 'ruota-final', riga.ruota_final_id);

    // ⭐ IL CUORE DELLA PROVA
    prova('⭐ le correzioni del coach sono ancora TUTTE lì',
      { 'chiusura.messaggio': 'Il saluto come lo scrivo io.', 'momenti.0.corpo.0': 'Questo momento lo racconto così.' },
      riga.correzioni);

    // 4. Come si vede il documento: dove c'è una correzione, vince la correzione.
    const visto = doc.unisci(riga.generato, riga.correzioni);
    prova('nel documento mostrato vince quello che ha scritto il coach',
      ['Il saluto come lo scrivo io.', 'Questo momento lo racconto così.'],
      [visto.chiusura.messaggio, visto.momenti[0].corpo[0]]);
    prova('e il resto è la versione nuova della macchina',
      ['Il filo, riscritto dalla macchina', { salite: 3, scese: 1 }],
      [visto.filo.titolo, visto.variazioni]);
    prova('unire non sporca gli originali nel magazzino',
      'saluto rigenerato', riga.generato.chiusura.messaggio);

    // 5. Una correzione su un pezzo che non esiste più non fa danni e non si perde.
    await doc.salvaCorrezione({ documentoId: id, sentiero: 'momenti.5.corpo.0', testo: 'correzione orfana' });
    const riga2 = await doc.caricaDocumento({ percorsoId: pid });
    const visto2 = doc.unisci(riga2.generato, riga2.correzioni);
    prova('una correzione rimasta orfana non fa cadere niente', 1, visto2.momenti.length);
    prova('e resta nel magazzino, non si butta via il lavoro del coach',
      'correzione orfana', riga2.correzioni['momenti.5.corpo.0']);

    // ── ⭐ IL REPORT DELLA FINAL NON ENTRA NELLA GENERAZIONE ─────────────────
    // Il documento si prepara PRIMA della Final: quel report non esiste ancora.
    // (Su Francesco esiste, ed è l'unico caso: senza questa regola l'unica prova
    // disponibile racconterebbe cose che in una Final vera non si sanno.)
    {
      const cid2 = randomUUID(), pid2 = randomUUID();
      await db.query('INSERT INTO clients (id, name, token) VALUES ($1,$2,$3)', [cid2, 'Con la Final', randomUUID()]);
      await db.query('INSERT INTO percorsi (id, client_id) VALUES ($1,$2)', [pid2, cid2]);
      for (const [tipo, data] of [['Intake','2026-04-22'], ['Ongoing','2026-05-04'], ['Final','2026-07-13']]) {
        await db.query(
          `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, stato) VALUES ($1,$2,$3,$4,$5,1,'confermata')`,
          [randomUUID(), pid2, cid2, tipo, data]);
      }
      const m = await doc.raccogliMateriale({ percorsoId: pid2 });
      prova('⭐ nel materiale della generazione NON c\'è nessun report della Final',
        ['Intake', 'Ongoing'], m.report.map(r => r.tipo));
      prova('le sedute restano tutte e tre (è solo la lettura che salta la Final)',
        ['Intake', 'Ongoing', 'Final'], m.sedute.map(x => x.tipo));

      const conFinal = await doc.raccogliMateriale({ percorsoId: pid2, conFinal: true });
      prova('e quando servirà per il documento da consegnare, la Final si può leggere',
        ['Intake', 'Ongoing', 'Final'], conFinal.report.map(r => r.tipo));
    }

    console.log(falliti ? `\n✗ ${falliti} controlli falliti.` : '\n✓ Tutti i controlli passati.');
  } catch (e) {
    falliti++;
    console.error('\n✗ Errore nella prova:', e.message);
  } finally {
    if (creata) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    process.exit(falliti ? 1 : 0);
  }
})();
