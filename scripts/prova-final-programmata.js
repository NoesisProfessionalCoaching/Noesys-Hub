// ═══════════════════════════════════════════════════════════════════════════
// PROVA DELLA REGOLA «UNA FINAL, UNA RIGA SOLA» — server/scan.js.
//
// A cosa serve. Dal 21/08/2026 il coach FISSA la Final e scrive la sua riga
// nella Scheda Cliente prima che la sessione avvenga: è da quella riga che nasce
// il Documento di chiusura, che lui legge e approva prima di entrare in sessione.
// Quando poi carica il report della Final su Drive, l'automazione deve RIEMPIRE
// quella riga. Se ne creasse una seconda, il coach si ritroverebbe la Final in
// doppio: ore sbagliate, documento agganciato alla riga morta, pulizia a mano.
// È un guasto silenzioso — nessun errore, solo una riga di troppo — e quindi
// esattamente il tipo che va provato dalla macchina, non a occhio.
//
// Come. Stanza temporanea sul database di SVILUPPO (come prova-appuntamenti.js),
// dentro i casi veri, e si fa girare `scan.salvaRigaReport` — la funzione VERA,
// non una copia: se qualcuno cambia quella regola, questa prova gira sulla
// versione nuova.
//
//   node --env-file=.env scripts/prova-final-programmata.js
// ═══════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ Manca DATABASE_URL. Lancia con: node --env-file=.env scripts/prova-final-programmata.js');
  process.exit(1);
}
// ⚠️ La stanza si crea SEMPRE sul database di sviluppo.
const host = (url.match(/@([^:/]+)/) || [])[1] || '(sconosciuto)';
if (host.startsWith('reseau')) {
  console.error('✗ Questo è il database VERO. La prova gira solo sullo sviluppo.');
  process.exit(1);
}
const schema = 'prova_final_' + process.pid + '_' + Date.now().toString(36);
const ssl = () => (url.includes('.railway.internal') || url.includes('localhost')) ? false : { rejectUnauthorized: false };

let falliti = 0;
function prova(titolo, atteso, ottenuto) {
  const a = JSON.stringify(atteso), o = JSON.stringify(ottenuto);
  if (a === o) console.log(`✓ ${titolo}`);
  else { falliti++; console.log(`✗ ${titolo}\n    atteso:   ${a}\n    ottenuto: ${o}`); }
}

// La riga che l'IA ricava dal report: qui il contenuto non conta, conta dove finisce.
const RIGA = {
  obiettivo: 'Bilancio di chiusura', argomenti: '- primo', attivita: '- secondo',
  scadenza: '—', ora: '—', eseguita: '—', note: 'note del coach',
};
// Un report come lo vede lo scanner (il nome porta la data, all'italiana).
const report = (tipo, nome) => ({ id: 'file-' + randomUUID().slice(0, 8), name: nome, tipo, modifiedTime: '2026-08-20T10:00:00Z' });

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
    const scan = require('../server/scan.js');
    await db.init();

    // Un cliente e il suo percorso, uguali per tutti i casi.
    async function nuovoPercorso(nome) {
      const cid = randomUUID(), pid = randomUUID();
      await db.query('INSERT INTO clients (id, name, token) VALUES ($1,$2,$3)', [cid, nome, randomUUID()]);
      await db.query('INSERT INTO percorsi (id, client_id) VALUES ($1,$2)', [pid, cid]);
      return { cliente: { id: cid, name: nome }, percorso: { id: pid } };
    }
    const contaFinal = pid => db.query("SELECT count(*)::int n FROM sedute WHERE percorso_id=$1 AND tipo='Final'", [pid])
      .then(r => r.rows[0].n);

    // ── CASO 1 · la Final fissata in anticipo si riempie, non si sdoppia ─────
    {
      const { cliente, percorso } = await nuovoPercorso('Caso 1');
      await db.query(
        `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, stato, origine)
         VALUES ($1,$2,$3,'Final','2026-09-10',1.0,'bozza','manuale')`,
        [randomUUID(), percorso.id, cliente.id]);

      const esito = await scan.salvaRigaReport({ percorso, cliente, riga: RIGA, rep: report('Final', "Report Final 10 settembre '26.docx") });
      const righe = await db.query("SELECT tipo, data, ore, stato, obiettivo, source_file_id FROM sedute WHERE percorso_id=$1", [percorso.id]);

      prova('la Final fissata in anticipo resta UNA riga', 1, await contaFinal(percorso.id));
      prova('la riga risulta riempita, non creata', true, esito.riempita);
      prova('il contenuto del report è finito in quella riga', 'Bilancio di chiusura', righe.rows[0].obiettivo);
      prova("le ore scritte dal coach non si perdono", '1.0', String(righe.rows[0].ore));
      prova('la riga resta in bozza: la approva lui', 'bozza', righe.rows[0].stato);
      prova('la riga adesso è collegata al suo file', true, !!righe.rows[0].source_file_id);
    }

    // ── CASO 2 · senza riga in attesa, il report crea la sua (come sempre) ───
    {
      const { cliente, percorso } = await nuovoPercorso('Caso 2');
      const esito = await scan.salvaRigaReport({ percorso, cliente, riga: RIGA, rep: report('Final', "Report Final 3 luglio '26.docx") });
      prova('senza riga in attesa la Final si crea da sola', 1, await contaFinal(percorso.id));
      prova('e risulta creata, non riempita', false, esito.riempita);
    }

    // ── CASO 3 · un report ONGOING non ruba la riga della Final in attesa ────
    {
      const { cliente, percorso } = await nuovoPercorso('Caso 3');
      await db.query(
        `INSERT INTO sedute (id, percorso_id, client_id, tipo, data, ore, stato, origine)
         VALUES ($1,$2,$3,'Final','2026-09-10',1.0,'bozza','manuale')`,
        [randomUUID(), percorso.id, cliente.id]);

      const esito = await scan.salvaRigaReport({ percorso, cliente, riga: RIGA, rep: report('Ongoing', "Report 4 agosto '26.docx") });
      const attesa = await db.query("SELECT source_file_id FROM sedute WHERE percorso_id=$1 AND tipo='Final'", [percorso.id]);
      prova("l'ongoing si fa la sua riga", false, esito.riempita);
      prova('la Final in attesa è rimasta intatta', true, attesa.rows[0].source_file_id === null);
    }

    // ── CASO 4 · una Final già collegata al suo report non viene sovrascritta ─
    {
      const { cliente, percorso } = await nuovoPercorso('Caso 4');
      await scan.salvaRigaReport({ percorso, cliente, riga: RIGA, rep: report('Final', "Report Final 3 luglio '26.docx") });
      const esito = await scan.salvaRigaReport({ percorso, cliente, riga: RIGA, rep: report('Final', "Report Final 4 luglio '26.docx") });
      prova('un secondo file Final non si mangia la riga del primo', false, esito.riempita);
      prova('e resta visibile come riga a sé', 2, await contaFinal(percorso.id));
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
