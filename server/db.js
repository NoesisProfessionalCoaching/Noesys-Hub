const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// Le colonne DATE (OID 1082) vanno restituite come stringa 'AAAA-MM-GG', non come
// oggetto Date (che verrebbe formattato male, es. "Thu Jul 02").
types.setTypeParser(1082, v => v);

// SSL: la rete privata di Railway (*.railway.internal) non usa SSL; le connessioni
// pubbliche/proxy sì. Rileviamo dall'URL così funziona in entrambi i casi.
function sslConfig() {
  const url = process.env.DATABASE_URL || '';
  if (url.includes('.railway.internal') || url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// Schema condiviso con Coaching-Tools (stesso database Postgres).
// L'Hub non tocca `sessions` (dati degli strumenti): quella resta di competenza
// della piattaforma strumenti. Qui l'Hub possiede lead/percorsi/pagamenti.
async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS coach (
      id         SERIAL PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT,
      token      TEXT UNIQUE NOT NULL,
      active     BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen  TIMESTAMPTZ
    )
  `);

  // `sessions` appartiene alla piattaforma strumenti; l'Hub la legge in sola
  // lettura (conteggio strumenti compilati per cliente). Sul DB reale esiste già.
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tool       TEXT NOT NULL,
      data       TEXT DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Versioni multiple per strumento (gestite dalla piattaforma): ogni riga è una
  // versione datata. Idempotente qui così l'ordine di deploy non conta.
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);

  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS telefono TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo_percorso TEXT DEFAULT 'Individuale'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS note_preliminari TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stato_percorso TEXT DEFAULT 'attivo'`);

  // Espansione anagrafica cliente (A2.4)
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS data_nascita DATE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS citta TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS indirizzo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS via TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS cap TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS provincia TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS social_tipo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS professione TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS altro_recapito TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS area TEXT DEFAULT 'Personal'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT 'altro'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS obiettivo TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stato_cliente TEXT DEFAULT 'attivo'`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prossima_azione TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS prossima_azione_data DATE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS drive_url TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS consenso_privacy BOOLEAN DEFAULT FALSE`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS consenso_data DATE`);
  // Documentazione nuovo cliente (Fetta 1c): quando è stata inviata la Mail 1 di
  // benvenuto (lettera + scheda anagrafica + Codice ICF). NULL = non ancora inviata.
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mail1_inviata_data TIMESTAMPTZ`);
  // Mail 2 (Fetta 2): contratto + agenda, inviata dopo la seduta di Intake.
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS mail2_inviata_data TIMESTAMPTZ`);

  // Nome/Cognome separati (A6): servono per nominare le cartelle Drive "Cognome Nome"
  // e in generale per un'anagrafica pulita. Il campo unico `name` resta (lo legge anche
  // la piattaforma strumenti) e viene tenuto sincronizzato = "Nome Cognome".
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS nome TEXT`);
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS cognome TEXT`);
  // Società/azienda del cliente (utile Personal, importante Business e futuri Team/Group).
  await query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS societa TEXT`);
  // Backfill una-tantum dei clienti già esistenti: ultima parola = cognome, il resto = nome.
  // Gira solo dove cognome è ancora vuoto → dopo il primo avvio non tocca più nulla.
  // I casi strani (cognomi composti tipo "De Luca") li corregge il coach a mano nell'Hub.
  await query(`
    UPDATE clients SET
      cognome = CASE WHEN position(' ' in btrim(name)) > 0
                     THEN regexp_replace(btrim(name), '^.*\\s+(\\S+)$', '\\1')
                     ELSE btrim(name) END,
      nome    = CASE WHEN position(' ' in btrim(name)) > 0
                     THEN regexp_replace(btrim(name), '^(.*)\\s+\\S+$', '\\1')
                     ELSE '' END
    WHERE cognome IS NULL AND name IS NOT NULL AND btrim(name) <> ''
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id                     TEXT PRIMARY KEY,
      nome                   TEXT NOT NULL,
      cognome                TEXT,
      email                  TEXT,
      telefono               TEXT,
      fonte                  TEXT DEFAULT 'altro',
      stato                  TEXT DEFAULT 'nuovo',
      note                   TEXT,
      data_prossimo_contatto DATE,
      created_at             TIMESTAMPTZ DEFAULT NOW(),
      updated_at             TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS percorsi (
      id                  TEXT PRIMARY KEY,
      client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tipo                TEXT DEFAULT 'Individuale',
      n_sessioni_previste INTEGER DEFAULT 8,
      n_sessioni_fatte    INTEGER DEFAULT 0,
      prezzo              NUMERIC(10,2),
      promo               BOOLEAN DEFAULT FALSE,
      sconto_note         TEXT,
      stato               TEXT DEFAULT 'attivo',
      data_inizio         DATE,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Espansione percorsi (2026-07-02): modalità di pagamento (Scambio servizi conta
  // come pagato per ICF), ore svolte (requisito certificazione ICF), data fine.
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS modalita TEXT DEFAULT 'Standard'`);
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS ore_fatte NUMERIC(6,1) DEFAULT 0`);
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS data_fine DATE`);

  // Diario sessioni di coaching (A8): una riga per seduta (Intake/Ongoing/Final),
  // con ore e "scheda" (riepilogo dei punti salienti, testo unico Markdown).
  // Distinta da `sessions` (che sono gli strumenti compilati dal cliente).
  // Quando un percorso ha sedute, ore_fatte/n_sessioni_fatte si ricalcolano da qui.
  await query(`
    CREATE TABLE IF NOT EXISTS sedute (
      id          TEXT PRIMARY KEY,
      percorso_id TEXT NOT NULL REFERENCES percorsi(id) ON DELETE CASCADE,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL DEFAULT 'Ongoing',
      data        DATE,
      ore         NUMERIC(4,1) DEFAULT 0,
      scheda      TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Automazione report→scheda (Fase 3): una seduta creata dall'automazione nasce
  // come BOZZA e non conta le ore ICF finché il coach non la approva (stato→confermata).
  // source_file_id = impronta del file Drive di origine (idempotenza: no doppioni +
  // tracciabilità). Le sedute preesistenti diventano 'confermata' (DEFAULT sotto).
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS stato          TEXT DEFAULT 'confermata'`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS origine        TEXT DEFAULT 'manuale'`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS source_file_id TEXT`);

  // Campi della Scheda Cliente (una riga per sessione: la tabella storica di Cowork).
  // data + tipo esistono già (= colonne DATA e SESSIONE). Questi sono i 6 restanti.
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS obiettivo  TEXT`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS argomenti  TEXT`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS attivita   TEXT`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS scadenza   TEXT`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS eseguita   TEXT`);
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS note       TEXT`);
  // Ora del PROSSIMO appuntamento (2026-07-30). La data ce l'ha già `scadenza`
  // ("di norma la data della sessione successiva"): qui va solo l'orario, HH:MM,
  // così il promemoria in home dice giorno E ora senza duplicare la data.
  // Testo e non TIME perché l'estrattore scrive "—" quando il report non lo dà.
  await query(`ALTER TABLE sedute ADD COLUMN IF NOT EXISTS prossima_ora TEXT`);

  // Fetta B (2026-07-23) — sessioni COLLETTIVE (team/group). La riga di una sessione
  // di gruppo appartiene al percorso CONDIVISO, non a un singolo cliente: il titolare
  // della reportistica è il progetto. Perciò client_id diventa NULLABILE (resta
  // valorizzato per le sedute individuali, mondo di oggi: nessun dato toccato).
  await query(`ALTER TABLE sedute ALTER COLUMN client_id DROP NOT NULL`);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id             TEXT PRIMARY KEY,
      client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      percorso_id    TEXT REFERENCES percorsi(id) ON DELETE SET NULL,
      importo        NUMERIC(10,2) NOT NULL,
      data_pagamento DATE,
      tipo           TEXT DEFAULT 'sessione',
      stato          TEXT DEFAULT 'atteso',
      note           TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Committente/Sponsor (Fase 1): il terzo che commissiona/paga un percorso
  // (azienda o persona — es. genitore). È un contatto a sé, NON entra nell'Hub e
  // non ha login. Un committente potrà avere più clienti/progetti collegati (Fase 2/3).
  // I campi fatturazione servono per emettere la fattura al committente senza rifare
  // il lavoro quando arriveranno documenti e fatture vere.
  await query(`
    CREATE TABLE IF NOT EXISTS committenti (
      id             TEXT PRIMARY KEY,
      tipo           TEXT NOT NULL DEFAULT 'azienda',   -- 'azienda' | 'persona'
      denominazione  TEXT NOT NULL,                     -- ragione sociale o "Nome Cognome"
      referente      TEXT,                              -- persona di contatto (HR, dirigente, genitore…)
      ruolo          TEXT,                              -- ruolo del referente
      email          TEXT,
      telefono       TEXT,
      codice_fiscale TEXT,                              -- CF (tipico persona)
      partita_iva    TEXT,                              -- P.IVA (tipico azienda)
      indirizzo      TEXT,                              -- indirizzo di fatturazione (una riga)
      pec_sdi        TEXT,                              -- PEC o codice SDI (fattura elettronica)
      note           TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Progetto (Fase 2): il percorso commissionato da un committente. In Business e
  // Young-con-sponsor il progetto È il "lead" (nasce in pre-intake) e porta la
  // pipeline (pre-intake→proposta→attivo→chiuso). I coachee si agganciano al
  // progetto in Fase 3, con la divisione delle quote (committente/coachee).
  // ON DELETE RESTRICT: non si cancella un committente che ha progetti (la rotta
  // committenti dà un messaggio chiaro invece di far esplodere il vincolo).
  await query(`
    CREATE TABLE IF NOT EXISTS progetti (
      id             TEXT PRIMARY KEY,
      committente_id TEXT NOT NULL REFERENCES committenti(id) ON DELETE RESTRICT,
      titolo         TEXT NOT NULL,
      area           TEXT NOT NULL DEFAULT 'Business',    -- 'Business' | 'Young'
      tipo           TEXT NOT NULL DEFAULT 'individuale',  -- 'individuale' | 'team' | 'group'
      stato          TEXT NOT NULL DEFAULT 'attivo',       -- stato della relazione: attivo | in pausa | concluso
      obiettivi      TEXT,
      note           TEXT,
      data_inizio    DATE,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Partecipazione (Fase 3): collega un coachee (client) a un progetto. Le colonne
  // delle quote nascono ORA ma restano vuote: la 3a collega solo i coachee, la 3b
  // riempirà la divisione della quota (committente/coachee) e lo stato pagamenti —
  // così non si rifà la tabella. UNIQUE: stesso coachee non due volte sullo stesso
  // progetto. ON DELETE CASCADE: cancellare progetto o cliente toglie il legame
  // (NON cancella il cliente dall'anagrafica quando si toglie dal progetto: quello
  // lo fa la rotta, che elimina solo la riga di partecipazione).
  await query(`
    CREATE TABLE IF NOT EXISTS partecipazioni (
      id                    TEXT PRIMARY KEY,
      progetto_id           TEXT NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
      client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      quota_totale          NUMERIC(10,2),
      quota_committente     NUMERIC(10,2),
      quota_coachee         NUMERIC(10,2),
      stato_pag_committente TEXT DEFAULT 'atteso',
      stato_pag_coachee     TEXT DEFAULT 'atteso',
      note                  TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (progetto_id, client_id)
    )
  `);

  // Fase 3B — le quote. La quota si decide in pre-intake sul PROGETTO intero:
  // un totale + quanto paga il committente (una fattura sola al committente);
  // il resto lo dividono i coachee (quota_coachee sulle partecipazioni). Perciò
  // totale/quota-committente/stato-pagamento-committente stanno sul progetto (il
  // committente è UN pagamento, non uno per coachee). Additivo: restano vuoti
  // finché il coach non compila. Le vecchie colonne quota_totale/quota_committente
  // su `partecipazioni` (nate con un modello precedente) restano inutilizzate.
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS quota_totale          NUMERIC(10,2)`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS quota_committente     NUMERIC(10,2)`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS stato_pag_committente TEXT DEFAULT 'atteso'`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS data_pag_committente  DATE`);
  await query(`ALTER TABLE partecipazioni ADD COLUMN IF NOT EXISTS data_pag_coachee DATE`);

  // Anagrafica progetto (2026-07-16) — il REFERENTE è un ruolo sul PROGETTO, non
  // sul committente: lo stesso committente può avere referenti diversi su progetti
  // diversi. referente_modo = 'sponsor' (coincide col committente, quando è persona
  // fisica e segue lui) | 'altra' (persona fisica distinta → si compilano nome/ruolo/
  // email). Additivo: i vecchi progetti restano su 'sponsor' di default.
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS referente_modo  TEXT DEFAULT 'sponsor'`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS referente_nome  TEXT`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS referente_ruolo TEXT`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS referente_email TEXT`);

  // Reportistica A (2026-07-19) — cartella Drive del progetto: dove il coach salva i
  // report Zoom delle fasi (Pre-Intake/Intake/Kick-Off/Final). Punto d'ingresso
  // dell'automazione report→riga-fase, come drive_url per il cliente.
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS drive_url TEXT`);

  // Reportistica A / mattone 2 — l'OBIETTIVO UFFICIALE del progetto (SMARTER) nasce
  // dalla fase Intake (non più dall'anagrafica: il vecchio `obiettivi` esce di scena
  // dalla UI). `parametri` = parametri di verifica del successo, sempre dall'Intake.
  // Una sola verità sul progetto; a questi punteranno gli obiettivi di sessione.
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS obiettivo_smarter TEXT`);
  await query(`ALTER TABLE progetti ADD COLUMN IF NOT EXISTS parametri         TEXT`);

  // B1 (2026-07-16) — un percorso può appartenere a un PROGETTO. Opzionale e nullo
  // per tutti i percorsi esistenti (individuali fuori progetto = mondo di oggi).
  // ON DELETE SET NULL: se si elimina il progetto, il percorso sopravvive e si
  // stacca (non si perde il lavoro fatto). La gerarchia progetto→percorsi→sedute
  // del documento parte da qui; i partecipanti multipli (team/group) arrivano in B2.
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS progetto_id TEXT REFERENCES progetti(id) ON DELETE SET NULL`);

  // Fetta 2a (2026-07-18) — l'AREA vive sul PERCORSO, non sulla persona: la stessa
  // persona può avere percorsi in aree diverse (es. un Personal individuale + un
  // Business dentro un progetto). `clients.area` resta come area di DEFAULT della
  // persona (nuovo cliente, cartelle Drive, fallback per chi non ha percorsi).
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS area TEXT`);
  // Backfill: percorso dentro un progetto → area del progetto; altrimenti → area
  // della persona. Solo dove non ancora valorizzata (idempotente).
  await query(`
    UPDATE percorsi p SET area = COALESCE(
      (SELECT g.area FROM progetti g WHERE g.id = p.progetto_id),
      (SELECT c.area FROM clients c WHERE c.id = p.client_id),
      'Personal'
    ) WHERE p.area IS NULL
  `);

  // Fetta 2a — generazione automatica RETROATTIVA: i percorsi individuali nascono
  // dal progetto (tipo + partecipante). Per i clienti GIÀ collegati a un progetto
  // individuale/individuale-multiplo senza ancora un percorso, lo creo qui. Team e
  // group NON generano nulla (usano la macchina percorso_partecipanti, fetta 2b).
  // Idempotente: NOT EXISTS → dopo la prima volta è un no-op.
  await query(`
    INSERT INTO percorsi (id, client_id, tipo, area, progetto_id, stato)
    SELECT gen_random_uuid()::text, pa.client_id, 'Individuale', g.area, g.id, 'attivo'
    FROM partecipazioni pa
    JOIN progetti g ON g.id = pa.progetto_id
    WHERE g.tipo IN ('individuale','individuale-multiplo')
      AND NOT EXISTS (
        SELECT 1 FROM percorsi p
        WHERE p.client_id = pa.client_id AND p.progetto_id = pa.progetto_id
      )
  `);

  // Fetta 2b (2026-07-18) — TEAM/GROUP: un percorso CONDIVISO appartiene a più
  // persone insieme. Serve una lista partecipanti agganciata al percorso (oggi il
  // percorso è appeso a un solo client_id). percorso_partecipanti = (percorso ↔
  // cliente). UNIQUE: stessa persona non due volte sullo stesso percorso. ON DELETE
  // CASCADE: cancellare il percorso o la persona toglie il legame.
  await query(`
    CREATE TABLE IF NOT EXISTS percorso_partecipanti (
      id          TEXT PRIMARY KEY,
      percorso_id TEXT NOT NULL REFERENCES percorsi(id) ON DELETE CASCADE,
      client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (percorso_id, client_id)
    )
  `);
  // Il percorso condiviso (team/group) NON ha un singolo proprietario: i partecipanti
  // stanno in percorso_partecipanti, quindi il suo client_id è NULL. Perciò la colonna
  // diventa NULLABILE (resta valorizzata per i percorsi individuali, mondo di oggi).
  await query(`ALTER TABLE percorsi ALTER COLUMN client_id DROP NOT NULL`);

  // Fetta B (2026-07-23) — il percorso CONDIVISO (team/group) ha una SUA cartella Drive
  // dentro il progetto ({Progetto}/Percorso Team|Group/{Intake,Ongoing,Final}), da cui
  // l'automazione leggerà i report di sessione collettiva. Gli individuali NON la usano
  // (ancorati alla cartella del cliente). Additiva, nullabile.
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS drive_url TEXT`);

  // 2026-07-27 — ORE E SESSIONI PRECEDENTI ALL'AUTOMAZIONE.
  // Regola di Germano: le ore vengono dalle sessioni, e una sessione esiste solo
  // se esiste il suo report. Ma tre percorsi sono anteriori all'automazione dei
  // report (Giulio Sudano 9h, Marika Rappo 4h, Rebecca Ros 3h = 16 ore ICF vere):
  // non hanno nessuna seduta che le documenti, quindi il ricalcolo dalle sedute
  // le azzererebbe. Vivono qui, a parte, e si SOMMANO al calcolato in
  // recomputePercorso — così la regola vale per tutto il resto senza perdere lo
  // storico. Additive; il travaso è una-tantum e idempotente.
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS ore_storiche NUMERIC(6,1) DEFAULT 0`);
  await query(`ALTER TABLE percorsi ADD COLUMN IF NOT EXISTS sessioni_storiche INTEGER DEFAULT 0`);
  // Travaso: SOLO i percorsi che hanno numeri scritti a mano e NESSUNA seduta
  // confermata. Chi ha già sedute non viene toccato (i suoi numeri sono già la
  // somma). La condizione sulle colonne storiche a zero rende la cosa ripetibile
  // senza raddoppiare nulla.
  await query(`
    UPDATE percorsi p SET
      ore_storiche      = COALESCE(p.ore_fatte, 0),
      sessioni_storiche = COALESCE(p.n_sessioni_fatte, 0)
    WHERE COALESCE(p.ore_storiche, 0) = 0
      AND COALESCE(p.sessioni_storiche, 0) = 0
      AND (COALESCE(p.ore_fatte, 0) > 0 OR COALESCE(p.n_sessioni_fatte, 0) > 0)
      AND NOT EXISTS (
        SELECT 1 FROM sedute s WHERE s.percorso_id = p.id AND s.stato <> 'bozza'
      )
  `);

  // Fase 3a (2026-07-18) — le FASI del progetto (tappe con lo sponsor). Timeline a
  // livello di PROGETTO, distinta dalle sessioni del percorso (Intake/Ongoing/Final).
  // tipo = pre-intake | intake-sponsor | kick-off | chiusura-open | chiusura-sponsor.
  // Pre-Intake è ripetibile (più righe); le altre di norma una sola; chiusura-open è
  // facoltativa (0 o 1). Ogni tappa: data + note + fatta. I REPORT veri verso il
  // committente sono la reportistica progetto (fetta 4), non qui.
  await query(`
    CREATE TABLE IF NOT EXISTS fasi_progetto (
      id          TEXT PRIMARY KEY,
      progetto_id TEXT NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL,
      data        DATE,
      note        TEXT DEFAULT '',
      fatta       BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Reportistica A / mattone 2 — il CONTENUTO della fase (le voci del report, diverse
  // per tipo) in una "scatola" flessibile JSON, così affinare l'elenco delle voci non
  // richiede di rifare la tabella. stato/origine/source_file_id predispongono
  // l'automazione (mattone 3): le righe da report nascono in BOZZA e si approvano con
  // un clic, come le sedute dei percorsi individuali. Manuale = già confermata.
  await query(`ALTER TABLE fasi_progetto ADD COLUMN IF NOT EXISTS contenuto      JSONB DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE fasi_progetto ADD COLUMN IF NOT EXISTS stato          TEXT DEFAULT 'confermata'`);
  await query(`ALTER TABLE fasi_progetto ADD COLUMN IF NOT EXISTS origine        TEXT DEFAULT 'manuale'`);
  await query(`ALTER TABLE fasi_progetto ADD COLUMN IF NOT EXISTS source_file_id TEXT`);
  // Travaso una-tantum del vecchio campo `note` (3a) nella nuova scatola, così le fasi
  // già inserite non perdono la nota. Idempotente.
  await query(`UPDATE fasi_progetto SET contenuto = jsonb_build_object('note', note)
               WHERE COALESCE(note,'') <> '' AND (contenuto IS NULL OR contenuto = '{}'::jsonb)`);

  // Fase 0 (2026-07-15) — stato del progetto = stato della relazione, 3 valori
  // come per il cliente individuale: attivo | in pausa | concluso. I vecchi stati
  // di pipeline (pre-intake/proposta/chiuso/perso) vengono rimappati una tantum.
  await query(`UPDATE progetti SET stato='attivo'   WHERE stato IN ('pre-intake','proposta')`);
  await query(`UPDATE progetti SET stato='concluso' WHERE stato IN ('chiuso','perso')`);

  // 2026-07-31 — PERMESSI A TERMINE sugli strumenti (decisione di Germano).
  // Fino a oggi l'accesso era tutto-o-niente e senza scadenza: `clients.active`
  // acceso = il cliente apre tutti gli strumenti, per sempre. Il nuovo modello:
  // ogni permesso ha una fine.
  //   tool NULL      = il portale intero (tutti gli strumenti) — link dell'intake
  //   tool 'swot'    = quel solo strumento — il compito fra una sessione e l'altra
  //   durata_ore     = permesso "a ore": il conto NON parte quando il coach copia
  //                    il link, ma quando il cliente lo apre la PRIMA volta (così
  //                    il link si può mandare la sera prima senza che muoia)
  //   scade_il       = permesso a data fissa (fine giornata della sessione successiva,
  //                    compresa: durante quella sessione il lavoro si apre insieme)
  // Un permesso ha SEMPRE una sola delle due (ore oppure data). `clients.active`
  // resta l'interruttore generale: spento, non entra comunque.
  await query(`
    CREATE TABLE IF NOT EXISTS permessi_strumenti (
      id            TEXT PRIMARY KEY,
      client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tool          TEXT,
      durata_ore    INTEGER,
      scade_il      TIMESTAMPTZ,
      primo_accesso TIMESTAMPTZ,
      revocato_il   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS permessi_strumenti_client_idx ON permessi_strumenti (client_id)`);
  // 31/07 — il TERZO tipo di permesso, chiesto da Germano: «in caso la data della
  // sessione successiva non fosse pianificata, la scadenza rimane libera fino a
  // che la data viene decisa». Non a ore e non a data fissa: aspetta la data.
  // Appena il report della prossima sessione la porta, il permesso si fissa a quel
  // giorno (lo scrive Coaching-Tools alla prima apertura utile del cliente) e
  // `attende_sessione` torna falso.
  await query(`ALTER TABLE permessi_strumenti ADD COLUMN IF NOT EXISTS attende_sessione BOOLEAN DEFAULT FALSE`);

  // UNA SOLA VERITÀ sulla scadenza. La regola la leggono due applicazioni diverse
  // (l'Hub per dire al coach com'è messo, Coaching-Tools per aprire o non aprire la
  // porta): se vivesse scritta due volte, prima o poi direbbero cose diverse. Vive
  // qui, e tutt'e due interrogano questa vista.
  //   `fine` = quando il permesso smette di valere:
  //     - data fissa            → quella data
  //     - in attesa della data  → fine giornata della prima sessione futura che i
  //                               report conoscono; se non ce n'è ancora nessuna,
  //                               NON scade (è la regola voluta: resta libero
  //                               finché la data non viene decisa)
  //     - a ore e già aperto    → prima apertura + le ore
  //     - a ore e MAI aperto    → 30 giorni dalla creazione. Un link preparato e mai
  //                               usato non può restare buono a vita.
  await query(`
    CREATE OR REPLACE VIEW permessi_validi AS
    SELECT p.id, p.client_id, p.tool, p.durata_ore, p.scade_il, p.primo_accesso,
           p.attende_sessione, p.created_at,
           CASE
             WHEN p.scade_il IS NOT NULL      THEN p.scade_il
             WHEN p.attende_sessione          THEN COALESCE(
                    (SELECT ((s.scadenza::date + INTERVAL '1 day' - INTERVAL '1 second')
                             AT TIME ZONE 'Europe/Rome')
                       FROM sedute s
                      WHERE s.client_id = p.client_id AND s.stato = 'confermata'
                        AND s.scadenza ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                        AND s.scadenza::date >= (NOW() AT TIME ZONE 'Europe/Rome')::date
                      ORDER BY s.scadenza LIMIT 1),
                    TIMESTAMPTZ 'infinity')
             WHEN p.primo_accesso IS NOT NULL THEN p.primo_accesso + (COALESCE(p.durata_ore,0) || ' hours')::interval
             ELSE p.created_at + INTERVAL '30 days'
           END AS fine
      FROM permessi_strumenti p
     WHERE p.revocato_il IS NULL
  `);

  // Stesso account coach della piattaforma strumenti (solo per il DB di test:
  // sul DB reale condiviso la riga esiste già).
  const existing = await query('SELECT id FROM coach WHERE username = $1', ['Germano']);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync('ProfessionalCoaching', 10);
    await query('INSERT INTO coach (username, password) VALUES ($1, $2)', ['Germano', hash]);
    console.log('✅ Coach account creato: Germano');
  }
}

module.exports = { query, init };
