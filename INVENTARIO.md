# Inventario dell'Hub — generato da `scripts/inventario.js`

Non si modifica a mano: lo riscrive `npm run prova`. Se un numero qui non torna con quello che ricordi, è cambiato il codice.

- `server/routes.js`: **9906 righe**, **15 pagine**, **92 rotte**
- moduli in `server/`: **27** (8 usano `db.js`, 19 no)
- prove in `npm run prova`: **16**, in questo ordine: prova-file → prova-js → prova-pagine → prova-fiscale → prova-proforma → prova-tranche → prova-incassi → prova-sedute → prova-appuntamenti → prova-final-programmata → prova-migrazione → prova-barriere → prova-conformita → prova-automazione → inventario → prova-timbro

## Le pagine (funzioni che finiscono in Page, nell'ordine del file)

- `loginPage` (riga 4098)
- `homePage` (riga 4117)
- `dashboardPage` (riga 4350)
- `driveDiagPage` (riga 4505)
- `clientDetailPage` (riga 4649)
- `leadsPage` (riga 6735)
- `anomaliePage` (riga 6935)
- `proformaPage` (riga 7089)
- `contrattiAmmPage` (riga 7574)
- `emittentePage` (riga 7689)
- `committentiPage` (riga 7785)
- `progettiPage` (riga 7973)
- `progettoDettaglioPage` (riga 8329)
- `cercaPage` (riga 9769)
- `icfPage` (riga 9851)

## Le rotte, per mondo

### accesso e servizio (5)

- `GET /login`
- `POST /login`
- `GET /logout`
- `GET /`
- `GET /dashboard`

### altro (home, icf, ricerca, diagnostica, permessi…) (12)

- `GET /dashboard/individuali`
- `POST /dashboard/collaudo`
- `GET /dashboard/home`
- `GET /dashboard/diag/drive`
- `POST /dashboard/diag/drive/test-create`
- `GET /dashboard/diag/modelli`
- `POST /dashboard/scan-drive`
- `GET /dashboard/cerca`
- `GET /dashboard/icf`
- `GET /dashboard/icf/export.csv`
- `POST /dashboard/percorsi/:id/piano`
- `POST /dashboard/percorsi/:pid/appuntamento`

### clienti e percorsi individuali (24)

- `POST /dashboard/clients`
- `POST /dashboard/clients/:id/drive-folders`
- `GET /dashboard/clients/:id`
- `POST /dashboard/clients/:id`
- `POST /dashboard/clients/:id/bozza-anagrafica/:azione`
- `POST /dashboard/clients/:id/permessi`
- `POST /dashboard/clients/:id/permessi/:pid/chiudi`
- `GET /dashboard/clients/:id/data`
- `DELETE /dashboard/clients/:id`
- `POST /dashboard/clients/:id/percorsi`
- `POST /dashboard/clients/:id/mail1/invia`
- `POST /dashboard/clients/:id/mail2/invia`
- `POST /dashboard/clients/:id/percorsi/:pid`
- `POST /dashboard/clients/:id/percorsi/:pid/chiudi`
- `DELETE /dashboard/clients/:id/percorsi/:pid`
- `POST /dashboard/clients/:id/percorsi/:pid/sedute`
- `POST /dashboard/clients/:id/percorsi/:pid/sedute/:sid`
- `DELETE /dashboard/clients/:id/percorsi/:pid/sedute/:sid`
- `POST /dashboard/clients/:id/percorsi/:pid/sedute/:sid/approva`
- `GET /dashboard/clients/:id/percorsi/:pid/contratto`
- `GET /dashboard/clients/:id/lettera-privacy`
- `GET /dashboard/clients/:id/agenda`
- `POST /dashboard/clients/:id/scan-moduli`
- `POST /dashboard/clients/:id/proforma`

### progetti e committenti (31)

- `GET /dashboard/progetti/:id/contratto`
- `GET /dashboard/progetti/:id/partecipanti/:partId/contratto`
- `GET /dashboard/progetti/:id/partecipanti/:partId/liberatoria`
- `POST /dashboard/progetti/:id/scan-drive`
- `POST /dashboard/progetti/:id/scan-collettivo`
- `POST /dashboard/progetti/:id/percorsi/:pid/sedute`
- `POST /dashboard/progetti/:id/percorsi/:pid/sedute/:sid`
- `DELETE /dashboard/progetti/:id/percorsi/:pid/sedute/:sid`
- `POST /dashboard/progetti/:id/percorsi/:pid/sedute/:sid/approva`
- `POST /dashboard/progetti/:id/percorsi/:pid/chiudi`
- `POST /dashboard/progetti/:id/tipo`
- `POST /dashboard/progetti/:id/percorsi/:pid/previste`
- `GET /dashboard/committenti`
- `POST /dashboard/committenti`
- `POST /dashboard/committenti/:id`
- `DELETE /dashboard/committenti/:id`
- `POST /dashboard/progetti/:id/piano`
- `POST /dashboard/partecipazioni/:id/piano`
- `GET /dashboard/progetti`
- `POST /dashboard/progetti`
- `POST /dashboard/progetti/:id/drive-folders`
- `POST /dashboard/progetti/:id/percorsi/:pid/drive-folders`
- `POST /dashboard/progetti/:id`
- `DELETE /dashboard/progetti/:id`
- `GET /dashboard/progetti/:id`
- `POST /dashboard/progetti/:id/coachee`
- `DELETE /dashboard/progetti/:id/coachee/:partId`
- `POST /dashboard/progetti/:id/quota`
- `POST /dashboard/progetti/:id/quote-coachee`
- `POST /dashboard/progetti/:id/fasi`
- `DELETE /dashboard/progetti/:id/fasi/:fid`

### amministrazione (15)

- `POST /dashboard/contratti/stato`
- `GET /dashboard/amministrazione`
- `POST /dashboard/tranche/:id/proforma`
- `GET /dashboard/proforma/:id/pdf`
- `POST /dashboard/tranche/:id/stato`
- `GET /dashboard/amministrazione/proforma`
- `POST /dashboard/proforma/:id/invia`
- `POST /dashboard/proforma/:id/drive`
- `POST /dashboard/proforma/:id/annulla`
- `POST /dashboard/proforma/:id/incasso`
- `POST /dashboard/incassi/:id/togli`
- `POST /dashboard/proforma/:id/fattura`
- `GET /dashboard/amministrazione/contratti`
- `GET /dashboard/amministrazione/emittente`
- `POST /dashboard/amministrazione/emittente`

### lead (5)

- `GET /dashboard/leads`
- `POST /dashboard/leads`
- `POST /dashboard/leads/:id`
- `POST /dashboard/leads/:id/convert`
- `DELETE /dashboard/leads/:id`

## I moduli del server

| file | righe | usa db.js |
|---|---|---|
| `appuntamenti.js` | 92 | sì |
| `auth.js` | 31 | sì |
| `automazione.js` | 102 | sì |
| `chiama-ui.js` | 39 | no |
| `claude.js` | 380 | no |
| `collaudo.js` | 82 | no |
| `contratti-stato.js` | 113 | no |
| `contratto-testi.js` | 900 | no |
| `contratto.js` | 292 | no |
| `db.js` | 1093 | no |
| `documenti.js` | 112 | no |
| `fiscale.js` | 501 | no |
| `google-drive.js` | 417 | no |
| `incassi.js` | 271 | no |
| `index.js` | 75 | sì |
| `logo.js` | 37 | no |
| `mailer.js` | 83 | no |
| `maturato.js` | 142 | sì |
| `moduli.js` | 180 | no |
| `piano-ui.js` | 598 | no |
| `proforma.js` | 591 | no |
| `routes.js` | 9906 | sì |
| `scan-moduli.js` | 215 | sì |
| `scan.js` | 416 | sì |
| `sedute.js` | 55 | no |
| `stato-ui.js` | 61 | no |
| `tranche.js` | 279 | no |
