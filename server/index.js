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

const db     = require('./db');
const routes = require('./routes');

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
}).catch(err => {
  console.error('❌ Errore inizializzazione DB:', err);
  process.exit(1);
});
