// Scrive un PDF di ESEMPIO della proforma, per guardarlo a occhio.
// Non è una prova automatica (non entra in `npm run prova`): serve a vedere il
// documento mentre lo si disegna, senza dover creare dati veri nell'Hub.
//
//   node scripts/prova-proforma-pdf.js [cartella-di-destinazione]

const fs = require('fs');
const path = require('path');
const os = require('os');
const pf = require('../server/proforma');

const dest = process.argv[2] || '.';

// La carta intestata si legge dal Drive MONTATO sul computer, non dall'API: così
// l'esempio si genera anche senza le chiavi Google, e si vede subito se il
// ritaglio dell'intestazione combacia ancora col modello vero.
const CARTA = path.join(os.homedir(),
  'Library/CloudStorage/GoogleDrive-noesys.professionalcoaching@gmail.com',
  'Il mio Drive/Noesys-Drive/Noesys/Modelli/Carta Intestata OK.pdf');
if (!fs.existsSync(CARTA)) {
  console.error('✗ Carta intestata non trovata:\n  ' + CARTA
    + '\n  (serve il Drive di Noesys montato sul computer)');
  process.exit(1);
}
const cartaBytes = fs.readFileSync(CARTA);

const emittente = {
  denominazione: 'Noesys Professional Coaching', nome: 'Germano', cognome: 'Guerriero',
  via: 'Via di Prova 1', cap: '20100', citta: 'Milano', provincia: 'MI', paese: 'IT',
  partita_iva: '12345678901', codice_fiscale: 'GRRGMN80A01F205X', regime: 'ordinario',
  iban: 'IT60 X054 2811 1010 0000 0123 456', banca: 'Banca di Prova',
  intestatario: 'Germano Guerriero',
  email: 'noesys.professionalcoaching@gmail.com', telefono: '+39 333 1234567',
};

const sedute = [
  { id: 's1', percorso_id: 'p1', data: '2026-07-06', tipo: 'Intake',  prezzo: 100 },
  { id: 's2', percorso_id: 'p1', data: '2026-07-20', tipo: 'Ongoing', prezzo: 100 },
  { id: 's3', percorso_id: 'p1', data: '2026-07-31', tipo: 'Ongoing', prezzo: 100 },
];

// Due esempi: il caso normale (privato) e quello con la ritenuta, che è il
// documento con più righe di conto e quindi il più difficile da far stare bene.
const CASI = [
  { file: 'proforma-esempio-privato.pdf', numero: '2026/001',
    cliente: { nome: 'Prova', cognome: 'Soldi', paese: 'IT',
      codice_fiscale: 'PRVSLD80A01F205X', via: 'Via delle Prove 12', cap: '20121',
      citta: 'Milano', provincia: 'MI', email: 'prova@esempio.it' } },
  { file: 'proforma-esempio-sostituto.pdf', numero: '2026/002',
    cliente: { nome: 'Studio', cognome: 'Bianchi', paese: 'IT',
      partita_iva: '98765432109', regime: 'ordinario', pec: 'studio@pec.it',
      codice_fiscale: 'BNCMRA75B02F205Y', via: 'Corso Italia 4', cap: '20122',
      citta: 'Milano', provincia: 'MI', email: 'studio@esempio.it' } },
];

(async () => {
  for (const c of CASI) {
    const righe = pf.righeDaSedute(sedute);
    const d = pf.componiProforma({ righe, cliente: c.cliente, emittente,
      dataEmissione: '2026-08-03' });
    // La forma con cui il documento sta nel database: è quella che riceve la
    // stampa, così l'esempio prova davvero il percorso vero e non una scorciatoia.
    const bytes = await pf.generaPdf({
      numero: c.numero, data_emissione: d.dataEmissione,
      periodo_da: d.periodoDa, periodo_a: d.periodoA,
      categoria_fiscale: d.categoria,
      emittente_dati: d.emittenteDati, destinatario_dati: d.destinatarioDati,
      imponibile: d.conti.imponibile, iva: d.conti.iva, ritenuta: d.conti.ritenuta,
      bollo: d.conti.bollo, totale_documento: d.conti.totaleDocumento,
      da_pagare: d.conti.daPagare,
      righe: d.righe,
    }, cartaBytes);
    const out = path.join(dest, c.file);
    fs.writeFileSync(out, bytes);
    console.log(`✓ ${out}  (${(bytes.length / 1024).toFixed(1)} kB) — ${d.conti.daPagare} € da bonificare`);
  }
})().catch(e => { console.error('✗', e.message); process.exit(1); });
