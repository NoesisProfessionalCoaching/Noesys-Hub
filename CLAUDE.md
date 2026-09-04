# Noesys-Hub — istruzioni per Claude

Il CRM di Noesys. Node/Express, PostgreSQL su Railway. **È IN PRODUZIONE e non deve mai fermarsi.**
Le regole di lavoro con Germano stanno in `~/.claude/CLAUDE.md`. Lo stato dei lavori sta nella
memoria automatica (`noesys-mappa-cantieri`). Qui c'è solo **come è fatta questa applicazione**.

## Com'è fatta

- **Tutto l'HTML è renderizzato dal server** dentro `server/routes.js` (~8.000 righe): ogni pagina è
  una **template literal** che contiene anche il `<script>` del browser. Niente file CSS separati:
  lo stile sta in `baseStyle()`, che è dentro ogni pagina.
- I moduli in `server/` sono **puri dove possibile**, così si possono provare senza database:
  `fiscale.js` (i conti: IVA, ritenuta, bollo) · `proforma.js` · `incassi.js` · `tranche.js` ·
  `maturato.js` · `appuntamenti.js` · `piano-ui.js` (la finestrella del piano, usata da due pagine).
- **Automazioni** (girano da sole alle 07/15/23, `index.js` con node-cron): `scan.js` legge i report
  da Drive e crea sedute in **bozza**; `scan-moduli.js` legge scheda e contratto e propone
  l'anagrafica; `claude.js` è l'estrattore.
- `db.js` fa le migrazioni **a ogni avvio** con `ADD COLUMN IF NOT EXISTS`. Non si cambia impianto.

## 🔴 Le cinque trappole di questo repo

1. **Apostrofi nel JS inline.** Dentro una template literal `\'` diventa `'` e **rompe tutto lo
   script della pagina**: nessun pulsante funziona più. Si scrive **`\\'`**.
2. **Backtick nei commenti** (anche CSS, anche dentro `baseStyle()`): chiudono la stringa e il file
   non compila.
3. **`\d` in una regex del JS inline** diventa `d`: **nessun errore, la regola smette di
   riconoscere qualsiasi cosa**. Si scrive `\\d`. È la più insidiosa: rompe una cosa sola, in silenzio.
4. **`itDate()` NON va usata su un timestamp** (`inviata_data`, `created_at`): esce «Wed Aug 12».
   Per un momento si usa **`itDateTime()`**. `itDate()` vale solo per le colonne DATE.
5. **Confronti fra importi in CENTESIMI INTERI.** In euro `0,1 + 0,2` non fa `0,3` e un documento
   saldato resta «manca 0,00» per sempre.

➜ Le prime tre le prende `npm run prova`. **Ma il JS renderizzato non è il sorgente**: un controllo
sul sorgente non le vede.

## ✅ `npm run prova` — obbligatoria prima di ogni pubblicazione

Undici controlli in fila: i file del server compilano · il JS renderizzato delle pagine · i conti
fiscali · proforma · rate · incassi · appuntamenti · Final programmata · documenti · migrazione.
**Il push è bloccato da una barriera se non è passata** (`~/.claude/hooks/barriere.js`).

Quando si aggiunge una prova nuova, **la si rompe apposta una volta** per vedere che sappia fallire.
⭐ La regola dietro tutto questo: *una regola che vive solo in una memoria e non nella rete di
sicurezza prima o poi salta.*

## 🗄️ I DUE database — dirlo SEMPRE

| | Indirizzo | Cos'è |
|---|---|---|
| `.env` → `DATABASE_URL` | `thomas.proxy.rlwy.net` | **PROVA**: 3 clienti inventati, nessun dato vero |
| `.env.reale` → `DATABASE_URL_REALE` | `reseau.proxy.rlwy.net` | **PRODUZIONE**: i clienti veri |

🔴 **Ogni volta che mostro un risultato dell'Hub, la frase deve dire da quale database viene.**

**Guardare i dati veri senza poterli toccare** (la sola lettura è garantita dal codice: Postgres
rifiuta le scritture, e accetta una sola query che cominci per SELECT/WITH):
```
node --env-file=/Users/macbook12/Developer/Noesys-Hub/.env.reale \
     /Users/macbook12/Developer/Noesys-Hub/scripts/guarda-produzione.js "SELECT …"
```
⛔ **Non lanciare mai il server con `--env-file=.env.reale`**: farebbe girare le migrazioni sulla
produzione fuori dal deploy. Una barriera lo impedisce.

**Accendere l'Hub in locale** (stesso codice, dati finti, porta 3100):
`node --env-file=.env server/index.js` → si entra con `Germano` / `ProfessionalCoaching`.
⚠️ `npm start` non passa `--env-file`. ⚠️ Un processo Node lanciato da una cartella iCloud muore
(`uv_cwd`): serve un avviatore che faccia `process.chdir` sul repo.

## 💾 Backup e manutenzione

`node --env-file=.env.reale scripts/backup-db.js "~/…/iCloud/Noesys/Backup DB"` — l'elenco delle
tabelle **lo chiede al database**, quindi comprende anche quelle future. **Farne uno prima di ogni
manutenzione.** ⚠️ Contiene dati personali dei clienti: non entra nel repo.

Quando Railway annuncia una **patch di sicurezza del Postgres**: si lascia fare, non si tocca
niente, ⛔ non si usa «update the image yourself». L'unica cosa che si fa è la copia qui sopra.

## 📐 Regole di dati che non si violano

- **Le ore vengono dalle sessioni, e una sessione esiste solo se esiste il suo report.** Le ore si
  correggono sulla **singola seduta**, mai sul percorso (`recomputePercorso` le sovrascriverebbe).
- **Le sedute in bozza non contano** le ore ICF. Nell'Estratto ICF entra solo un percorso con
  almeno una sessione fatta.
- **`di_collaudo`** su `clients`, `committenti`, `progetti` dice chi è vero. **L'elenco vive in
  `db.js`** (blocco «CHI È VERO E CHI È DI COLLAUDO») e da nessun'altra parte. `NULL` = non ancora
  classificato: non entra in nessun conto e `punto.js` lo segnala.
- **Mai `ON DELETE CASCADE` su un documento di soldi**: cancellare un cliente non può far sparire
  una proforma emessa (`SET NULL`). Una proforma con un incasso sopra non si cancella affatto.
- **Un numero di proforma bruciato non si riusa**, nemmeno se il documento è annullato.

## ⚠️ Dove si registra una cosa nuova

Uno **strumento** nuovo va registrato in **sei punti** (quattro in Coaching-Tools, due qui:
elenco strumenti e `case` dell'anteprima). Dimenticarne uno = uno strumento invisibile da qualche parte.
➜ Dal 04/09 lo controlla `npm run prova` (`prova-conformita.js`): legge i sorgenti dei due repo e
dice quale punto manca. Non serve ricordarselo: serve che la prova passi.

## 🚀 Pubblicazione

GitHub → Railway (progetto `amused-perfection`, servizio `Noesys-Hub`).
URL vero: **`noesys-hub-production-8e52.up.railway.app`** (col `-8e52`!).
⚠️ `noesys-hub-production.up.railway.app` **senza** il suffisso è un doppione stale senza le chiavi
Google: non usarlo per verificare.

**Quando un deploy non atterra**, tre cause diverse: push ravvicinati (il commit c'è su GitHub ma
non esiste un deploy → commit vuoto per ri-innescare) · coda lenta (il deploy c'è ed è `QUEUED` →
aspettare) · Railway ha sospeso i deploy durante un incidente (→ `status.railway.com`, il commit
vuoto è sprecato). **Sonda che non richiede login:** `curl …/login | grep <pezzo di CSS nuovo>`.
⚠️ **Un deploy non cambia una pagina già aperta nel browser**: prima di cercare un difetto, far ricaricare.
