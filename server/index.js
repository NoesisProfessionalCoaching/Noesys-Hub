const path = require('path');
const fs   = require('fs');

// Caricamento manuale di .env (solo per sviluppo locale; su Railway le variabili
// sono già nell'ambiente). Evita dipendenze esterne che chiamano process.cwd(),
// non affidabile in alcuni ambienti sandboxed.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const express      = require('express');
const cookieParser = require('cookie-parser');

const cron   = require('node-cron');
const db     = require('./db');
const routes = require('./routes');
const scan   = require('./scan');
const scanModuli = require('./scan-moduli');
const automazione = require('./automazione');   // l'esito delle passate (fetta 2.2)

const app  = express();
const PORT = process.env.PORT || 3100;

app.use(cookieParser());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'public', 'static')));

app.use('/', routes);

app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>404</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:'Manrope',system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#F4F6F8;color:#6B7280}
    .box{text-align:center}.box h1{font-size:52px;font-weight:800;color:#cfd6df;margin-bottom:8px}.box p{margin-bottom:16px}
    a{color:#1A5280;font-weight:600;text-decoration:none}</style></head>
    <body><div class="box"><h1>404</h1><p>Pagina non trovata</p><a href="/login">← Torna all'inizio</a></div></body></html>
  `);
});

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Noesys Hub`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Automazione report→scheda: controllo dei report Drive ogni 8h (ora italiana).
  // Crea sedute in BOZZA che il coach approva; salta i file già lavorati.
  // ⭐ Fetta 2.2 (04/09/2026): QUATTRO passate separate, ognuna dentro
  //    `automazione.esegui`, che non rilancia mai — se la prima esplode le altre
  //    tre partono lo stesso — e conserva l'esito in `automazione_passate`, da
  //    cui la home dice cosa non è riuscito. Prima stavano in un solo try e
  //    l'esito finiva solo nei log di Railway.
  cron.schedule('0 7,15,23 * * *', async () => {
    const dì = (nome, r) => console.log(`[${nome}] ${new Date().toISOString()} — ${r.ok ? JSON.stringify(r.esito) : 'NON ESEGUITA: ' + r.errore}`);
    dì('report-clienti',    await automazione.esegui('report-clienti',    () => scan.scanClientReports()));
    dì('report-progetti',   await automazione.esegui('report-progetti',   () => scan.scanProjectReports()));
    dì('report-collettivi', await automazione.esegui('report-collettivi', () => scan.scanCollectiveReports()));
    // Moduli compilati (scheda anagrafica, contratto): dall'8 agosto NON scrivono
    // in anagrafica, PROPONGONO (bozza_anagrafica) e il coach approva.
    dì('moduli',            await automazione.esegui('moduli',            () => scanModuli.scanModuliClienti()));
  }, { timezone: 'Europe/Rome' });
  console.log('   ⏱  Report Drive → bozza · Moduli → anagrafica: 07:00 / 15:00 / 23:00 (Europe/Rome)\n');
}).catch(err => {
  console.error('❌ Errore inizializzazione DB:', err);
  process.exit(1);
});
