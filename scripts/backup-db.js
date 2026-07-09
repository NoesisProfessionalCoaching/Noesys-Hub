// Backup completo del database Noesys in un file JSON.
// Uso:  node scripts/backup-db.js <DATABASE_URL> <cartella-destinazione>
// Salva: noesys-backup-AAAA-MM-GG-HHMM.json con tutte le righe di tutte le tabelle.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TABELLE = ['coach', 'clients', 'sessions', 'leads', 'percorsi', 'sedute', 'payments'];

async function main() {
  const url = process.argv[2];
  const destDir = process.argv[3];
  if (!url || !destDir) {
    console.error('Uso: node scripts/backup-db.js <DATABASE_URL> <cartella-destinazione>');
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const backup = { creato_il: new Date().toISOString(), tabelle: {} };
  for (const t of TABELLE) {
    try {
      const r = await client.query(`SELECT * FROM ${t}`);
      backup.tabelle[t] = r.rows;
      console.log(`  ${t}: ${r.rows.length} righe`);
    } catch (e) {
      backup.tabelle[t] = { errore: e.message };
      console.log(`  ${t}: ERRORE — ${e.message}`);
    }
  }
  await client.end();

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const file = path.join(destDir, `noesys-backup-${stamp}.json`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\n✅ Backup salvato: ${file}`);
}

main().catch(err => { console.error('❌ Backup fallito:', err.message); process.exit(1); });
