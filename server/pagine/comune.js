/**
 * CIÒ CHE LE PAGINE HANNO IN COMUNE — fetta 4.1 del riordino (04/09/2026).
 *
 * Fino al 04/09 tutto stava in routes.js (9.800 righe: 3.700 di rotte e 6.000 di
 * pagine). Qui c'è quello che più pagine — e le rotte — usano: lo stile, la
 * barra in alto con le briciole, gli aiutanti per scrivere HTML sicuro (esc,
 * attr, jsStr), le date in italiano, le costanti (aree, stati, strumenti), la
 * riga di una sessione, la sezione pieghevole, la finestrella del PDF,
 * l'anteprima degli strumenti. Le pagine stanno in questa cartella, una per
 * mondo; le rotte restano in routes.js. Lo spostamento è stato meccanico:
 * nessuna riga di logica è cambiata.
 */
const { logoCompact } = require('../logo');
const dateIt = require('../date-it');
const fiscale = require('../fiscale');

// URL della piattaforma strumenti (app separata). Il link di accesso del cliente
// porta agli STRUMENTI, non all'Hub: qui gestiamo solo il CRM.
const PLATFORM_URL = process.env.PLATFORM_URL || 'https://coaching-tools-production.up.railway.app';

// Gli strumenti della piattaforma, NELL'ORDINE IN CUI LI VEDE IL CLIENTE nel suo
// portale: le tre famiglie decise da Germano il 28/07 — chi sei · cosa senti ·
// cosa fai. Le famiglie non hanno un titolo scritto nemmeno lì: a farle leggere
// sono l'ordine e lo stacco. Qui servono a due cose che devono restare d'accordo:
// la tendina «scegli lo strumento» (senza icone) e le etichette dello storico
// «Strumenti utilizzati» (con icone). Una lista sola, perciò, non due.
// Aggiungendo uno strumento in Coaching-Tools: aggiungerlo anche qui.
const STRUMENTI = [
  { key: 'valori',            nome: 'Scheda Valori',             icona: '💎' },
  { key: 'abilita',           nome: 'Scheda Abilità',            icona: '⭐' },
  { key: 'genogramma',        nome: 'Genogramma Relazionale',    icona: '🔗' },
  { key: 'lineavita',         nome: 'Linea della Vita',          icona: '📈' },
  { key: 'ruotavita',         nome: 'Ruota della Vita',          icona: '🎯' },
  { key: 'ruota-leadership',  nome: 'Ruota della Leadership',    icona: '👑' },
  { key: 'ruota-management',  nome: 'Ruota del Management',      icona: '📊' },
  { key: 'logica-cartesiana', nome: 'Logica Cartesiana',         icona: '🧭' },
  { key: 'swot',              nome: 'SWOT Analysis',             icona: '⚖️' },
  { key: 'covey-eisenhower',  nome: 'Matrice Covey/Eisenhower',  icona: '⏳' },
  { key: 'brainstorming',     nome: 'Brainstorming',             icona: '💡' },
];

const TOOL_LABEL = Object.fromEntries(STRUMENTI.map(t => [t.key, `${t.icona} ${t.nome}`]));

// Quante ore dura il permesso "per oggi" (il link dell'intake, e il compito che
// il cliente deve fare durante la sessione). Il conto NON parte quando il coach
// copia il link, ma quando il cliente lo apre la prima volta: così il link si può
// preparare la sera prima senza che arrivi già scaduto.
const PERMESSO_ORE_SESSIONE = 3;

// Fonti condivise tra lead e clienti (niente Calendly: non è una fonte).
const FONTI = ['sito', 'social', 'linkedin', 'passaparola', 'ebook', 'altro'];

const FONTE_LABEL = { sito:'Sito', social:'Social', linkedin:'LinkedIn', passaparola:'Passaparola', ebook:'E-book', altro:'Altro' };

const SOCIAL = ['Facebook', 'Instagram', 'LinkedIn', 'Altro'];

const AREE = ['Personal', 'Business', 'Young'];

const AREA_COLOR = { Personal:'#1A5280', Business:'#4F8B73', Young:'#D8AE2E' };

const STATO_CLIENTE = {
  attivo:    { label:'Attivo',   cls:'badge-active' },
  'in pausa':{ label:'In pausa', cls:'badge-pausa' },
  concluso:  { label:'Concluso', cls:'badge-inactive' },
};

// ═══════════════════════════════════════════════════════
// AUTH COACH (stesso account della piattaforma strumenti)
// ═══════════════════════════════════════════════════════

const ORE_TIPO = { Intake: 2, Ongoing: 1, Final: null };

/**
 * SU QUALE PERCORSO SI FA IL CONTRATTO — regola scritta una volta sola.
 * La usa la scheda cliente (per il pulsante, gli avvisi e l'anteprima nella
 * finestrella della Mail 2). ⭐ Fetta 0.5 (04/09): la rotta della Mail 2 NON
 * sceglie più: riceve dalla finestrella l'id del percorso di cui ha mostrato
 * l'anteprima. Due scelte in due momenti diversi, anche con la stessa regola,
 * potevano dare un contratto mostrato e uno spedito su percorsi diversi.
 * ⛔ Mai un percorso legato a un progetto: quello ha il suo contratto, che
 *    nasce dalla partecipazione e non da qui.
 */
function scegliPercorsoContratto(percorsi) {
  const suoi = (percorsi || []).filter(p => !p.progetto_id);
  return suoi.find(p => p.stato === 'attivo') || suoi.slice(-1)[0] || null;
}

function baseStyle() {
  return `
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap" rel="stylesheet">
    <style>
      :root {
        --blue:#1A5280; --blue-dark:#134265; --navy:#223B6E;
        --gold:#D8AE2E; --green:#4F8B73; --lime:#B7B342;
        --ink:#2C3E50; --muted:#6B7280; --hint:#9AA0AA;
        --bg:#FAFBFC; --card:#FFFFFF; --line:#E6E9EE;
        --grad:linear-gradient(90deg,#D8AE2E,#B7B342,#4F8B73,#1A5280);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      /* Fondo BIANCO LUMINOSO. ⛔ NON rifarlo caldo/avorio: provato il 28/07
         e bocciato ("caldo non mi piace"). La luce va data dai riflessi, non
         da una tinta: un bagliore chiaro in alto, come una luce da studio, e
         un riflesso a pavimento in basso. */
      body { font-family: 'Manrope', system-ui, -apple-system, sans-serif; color: var(--ink); min-height: 100vh; -webkit-font-smoothing: antialiased;
        background-color: var(--bg);
        background-image:
          radial-gradient(1100px 640px at 50% -14%, rgba(255,255,255,1), rgba(255,255,255,0) 66%),
          radial-gradient(1300px 480px at 50% 106%, rgba(206,216,228,0.5), rgba(206,216,228,0) 72%);
        background-repeat: no-repeat; background-attachment: fixed; }
      ${/* 11/08 — le pagine passano da 980 a 1200px. Le schede si sono riempite
            (anagrafica + fatturazione + azioni + percorsi + amministrazione) e in
            una colonna sola diventavano lunghe da scorrere. 1200 e non di più:
            oltre, su un monitor grande, le righe diventano lunghe da seguire con
            l'occhio. Sotto i 1200 il limite non fa niente — decide la finestra. */ ''}
      .container { max-width: 1200px; margin: 0 auto; padding: 28px 18px; }
      /* La scheda è un oggetto appoggiato, non un rettangolo: DUE ombre
         sovrapposte — una stretta di contatto sotto il bordo, una più larga
         intorno — più un filo di luce sul bordo alto e una schiaritura verso
         il basso, che è il riflesso della luce che viene da sopra. */
      .card { background: var(--card); background-image: linear-gradient(180deg, #FFFFFF 0%, #FCFDFE 42%, #F9FBFC 100%); border: 1px solid var(--line); border-radius: 14px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 3px rgba(16,33,60,0.13), 0 7px 14px rgba(16,33,60,0.18);
        padding: 22px; margin-bottom: 16px; }
      .btn { display: inline-block; padding: 9px 20px; border: none; border-radius: 22px; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.15s; text-decoration: none; }
      .btn-primary  { background: var(--blue); color: #fff; }
      .btn-primary:hover { background: var(--blue-dark); }
      .btn-gold     { background: var(--gold); color: #3d3008; }
      .btn-gold:hover { background: #c89e1f; }
      .btn-danger   { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; }
      .btn-danger:hover { background: #fbe4e1; }
      .btn-neutral  { background: #eef1f5; color: #4a5568; }
      .btn-neutral:hover { background: #e2e7ee; }
      .btn-sm { padding: 6px 13px; font-size: 12px; }
      /* Correzione a mano di un numero già scritto (ore, sessioni): non è
         un'azione sul record, quindi non ha l'aspetto di un pulsante pieno. */
      /* Pulsante di una funzione ancora da sviluppare: il posto è riservato e si
         vede, ma è spento (metodo dei "posti riservati", come nel menù ⚙). */
      .btn-off { background: #f2f4f7; color: #b6bcc6; border: 1px dashed #d8dde5; cursor: default; }
      /* ── ZONE DI UNA SCHEDA ─────────────────────────────────────────────────
         Regola: sopra i DATI, in fondo TUTTE le azioni e TUTTI i link, raccolti
         in una zona sola e divisi per funzione (niente pulsanti in mezzo ai
         dati, niente stessa cosa in due posti). .az-bar esce dai margini della
         card (padding 22px) per fare fascia piena in fondo. */
      .zona-tit { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 14px; }
      ${/* Le due colonne della scheda cliente. `align-items: start` perché le due
            colonne hanno altezze diverse e non devono stirarsi a pareggio.
            Il filo verticale separa senza pesare; sotto i 1024px diventa un filo
            orizzontale, che è il modo giusto di separare due blocchi impilati. */ ''}
      ${/* La colonna DESTRA è la più larga anche se sembra controintuitivo: è
            quella che cresce (dati fiscali + note + prossima azione), mentre a
            sinistra i campi sono pochi e corti. Dandole più spazio i dati fiscali
            stanno su tre colonne invece che due e le due metà finiscono più o
            meno alla stessa altezza, invece di lasciare un buco bianco. */ ''}
      .scheda-2col { display: grid; grid-template-columns: 1fr 1.1fr; gap: 30px; align-items: start; }
      .scheda-2col > div + div { border-left: 1px solid var(--line); padding-left: 30px; }
      .az-bar { background: #FAFBFC; border-top: 1px solid var(--line); border-radius: 0 0 14px 14px; margin: 22px -22px -22px; padding: 18px 22px 14px; }
      .az-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 26px; }
      .az-gruppo { border-left: 2px solid var(--line); padding-left: 14px; min-width: 0; }
      .az-nome { font-size: 10px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 8px; }
      .az-btns { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
      .az-stato { font-size: 11px; color: var(--hint); margin-top: 7px; line-height: 1.6; }
      .az-link { font-size: 12px; color: var(--muted); word-break: break-all; margin-bottom: 7px; }
      .az-fatto { color: var(--green); font-weight: 700; }
      .az-danger { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px dashed var(--line); margin-top: 18px; padding-top: 12px; }
      @media (max-width: 700px) { .az-grid { grid-template-columns: 1fr; } }
      /* ── HOME ────────────────────────────────────────────────────────────────
         Il pittogramma del marchio fa da sfondo (grande e trasparente, scelta di
         Germano 28/07): sta SOTTO le porte, che sono bianche appena traslucide
         così il segno si intravede senza disturbare la lettura. */
      .hm-hero { position: relative; padding: 30px 0 34px; }
      /* Come sul sito Noesys: il pittogramma è ENORME e ancorato al bordo destro,
         quindi si vede solo una PORZIONE delle curve. Non fa il protagonista — dà
         movimento alla pagina con la linea. Posizione fissa: così non genera mai
         barre di scorrimento e resta un fondo stabile mentre si scorre.
         ATTENZIONE: qui siamo dentro un template literal, niente backtick nei
         commenti — chiudono la stringa e rompono tutto il file. */
      .hm-picto { position: fixed; top: -250px; right: -580px; width: 1180px; height: 1180px; opacity: 0.09; line-height: 0; pointer-events: none; z-index: 0; }
      .hm-picto svg { width: 100%; height: 100%; }
      .hm-porte { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .hm-porta { display: block; background: rgba(255,255,255,0.88); border: 1px solid var(--line); border-radius: 14px; padding: 20px; text-decoration: none; color: var(--ink); box-shadow: 0 1px 3px rgba(16,33,60,0.04); transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
      .hm-porta:hover { transform: translateY(-2px); border-color: #cdd7e1; box-shadow: 0 8px 24px rgba(16,33,60,0.09); }
      .hm-porta-nome { display: block; font-size: 15px; font-weight: 700; margin-bottom: 12px; }
      .hm-porta-num { font-size: 32px; font-weight: 800; color: var(--blue); line-height: 1; }
      .hm-porta-unita { font-size: 12px; color: var(--hint); margin-left: 5px; }
      .hm-porta-desc { display: block; font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 10px; }
      .hm-gruppo { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(16,33,60,0.04); }
      .hm-gruppo-nome { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 4px; }
      .hm-voce { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; border-top: 1px solid #eef1f5; font-size: 13px; color: var(--ink); text-decoration: none; }
      .hm-voce:hover { color: var(--blue); }
      .hm-voce-coda { font-size: 12px; color: var(--hint); white-space: nowrap; flex: 0 0 auto; }
      @media (max-width: 720px) { .hm-porte { grid-template-columns: 1fr; } .hm-picto { display: none; } }
      input, select, textarea { width: 100%; padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 9px; font-size: 13px; font-family: inherit; color: var(--ink); outline: none; transition: border-color 0.15s, box-shadow 0.15s; background: #fff; }
      input:focus, select:focus, textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(26,82,128,0.12); }
      textarea { resize: vertical; min-height: 64px; }
      label { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-bottom: 5px; }
      .form-group { margin-bottom: 14px; }
      h1 { font-size: 23px; font-weight: 800; color: var(--blue); letter-spacing: -0.01em; margin-bottom: 4px; }
      h2 { font-size: 16px; font-weight: 700; color: var(--ink); margin-bottom: 14px; }
      a { color: var(--blue); }
      .badge { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; }
      .badge-active   { background: #e7f1ec; color: #2e6b52; }
      .badge-inactive { background: #eef1f5; color: #7a8089; }
      .badge-pausa    { background: #fff8dc; color: #7a5c00; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; padding: 10px 14px; border-bottom: 1px solid var(--line); }
      td { padding: 13px 14px; border-bottom: 1px solid #f1f3f6; font-size: 13px; vertical-align: middle; }
      tr:last-child td { border-bottom: none; }
      .empty { text-align: center; color: var(--hint); font-style: italic; padding: 34px; font-size: 14px; }
      .flash-error { background: #fdf0ef; color: #c0392b; border: 1px solid #f3c9c4; border-radius: 9px; padding: 11px 14px; margin-bottom: 16px; font-size: 13px; }
      .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:100; align-items:center; justify-content:center; padding:16px; }
      .modal-box { background:#fff; border-radius:12px; padding:26px; width:520px; max-width:100%; box-shadow:0 8px 32px rgba(0,0,0,0.18); max-height:90vh; overflow-y:auto; }
      /* Su uno schermo da portatile la finestrella della sessione e' piu' lunga
         dello schermo: le Note (ultima voce) e i pulsanti finivano fuori, e su
         macOS la barra di scorrimento non si vede, quindi niente lo diceva.
         Rimedio senza toccare il contenuto: il titolo resta appeso in alto e la
         riga dei pulsanti in basso, scorrono solo i campi in mezzo. Cosi' Salva
         e Annulla sono sempre a portata e non si perde mai il punto in cui si e'.
         dvh accanto a vh: sui tablet segue la tastiera, dove vh non la vede. */
      .modal-box > h2 { position:sticky; top:-26px; z-index:2; background:#fff; margin:-26px -26px 12px; padding:26px 26px 12px; border-radius:12px 12px 0 0; }
      .modal-box > div:last-child { position:sticky; bottom:-26px; z-index:2; background:#fff; margin:8px -26px -26px; padding:14px 26px 26px; border-top:1px solid var(--line); border-radius:0 0 12px 12px; }
      @supports (max-height: 90dvh) { .modal-box { max-height:90dvh; } }
      ${/* 11/08 — etichette 11→12px, valori 13→15px. Erano misure tarate su una
            scheda che conteneva la metà delle cose di oggi. Il valore deve
            risaltare sull'etichetta: è il dato che si legge, l'etichetta dice
            solo che cos'è. Sotto i 1024px l'etichetta torna a 11px (regola della
            portabilità), il valore no: sul telefono deve restare leggibile. */ ''}
      .field-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; font-weight:600; margin-bottom:4px; }
      .field-value { font-size:15px; color:var(--ink); line-height:1.45; }
      /* Accordion — report sessioni / strumenti */
      details > summary { list-style: none; }
      details > summary::-webkit-details-marker { display: none; }
      .sec-caret { display:inline-block; color: var(--hint); font-size: 11px; transition: transform 0.15s; flex:0 0 auto; }
      details[open] > summary .sec-caret { transform: rotate(90deg); }
      details.acc { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; background:#fff; }
      details.acc > summary { display:flex; align-items:center; gap:8px; cursor: pointer; padding: 11px 14px; font-size:13px; user-select:none; }
      details.acc > summary:hover { background: #f8f9fb; border-radius: 10px; }
      .acc-body { padding: 4px 14px 14px 14px; border-top: 1px solid var(--line); font-size:13px; line-height:1.6; }
      /* Scheda Cliente — tabella una-riga-per-sessione */
      .scheda-cliente td { vertical-align: top; font-size: 12px; line-height: 1.45; padding: 11px 12px; }
      .scheda-cliente th { white-space: nowrap; font-size: 10.5px; }
      .scheda-cliente td:nth-child(1) { width: 76px; white-space: nowrap; color: var(--muted); }
      .scheda-cliente td:nth-child(2) { white-space: nowrap; }
      .scheda-cliente td:nth-child(3) { min-width: 155px; }
      .scheda-cliente td:nth-child(4) { min-width: 180px; }
      .scheda-cliente td:nth-child(5) { min-width: 175px; }
      .scheda-cliente td:nth-child(6) { width: 92px; white-space: nowrap; }
      .scheda-cliente td:nth-child(7) { width: 42px; }
      .scheda-cliente td:nth-child(8) { min-width: 260px; }
      .scheda-cliente ul { margin: 0; padding-left: 16px; }
      /* ── Header brandizzato Noesys — namespace nh-, l'unico dell'Hub ── */
      .nh { position: sticky; top: 0; z-index: 60; background: #fff; border-bottom: 1px solid var(--line); }
      .nh-row { max-width: 980px; margin: 0 auto; padding: 0 18px; }
      .nh-top { display: flex; align-items: center; gap: 14px; padding-top: 9px; padding-bottom: 9px; }
      .nh-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; flex: 0 0 auto; line-height: 0; }
      .nh-payoff { font-size: 9.5px; letter-spacing: 0.17em; text-transform: uppercase; color: #5A5A5A; font-weight: 700; line-height: 1.35; border-left: 1px solid var(--line); padding-left: 12px; }
      .nh-spacer { flex: 1 1 auto; }
      .nh-search { position: relative; flex: 0 1 290px; }
      /* la casella è viva dalla fase 1c: sparita l'etichetta "in arrivo" che
         stava dentro, è sparito anche il padding a destra che le faceva posto */
      .nh-search input { padding: 7px 13px; font-size: 12.5px; border-radius: 20px; background: #f7f9fb; }
      .nh-search input:focus { background: #fff; }
      .nh-menu { position: relative; flex: 0 0 auto; }
      .nh-menu > summary { cursor: pointer; width: 34px; height: 34px; border-radius: 50%; background: #eef1f5; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #4a5568; }
      .nh-menu > summary:hover { background: #e2e7ee; }
      .nh-menu-box { position: absolute; right: 0; top: 42px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 28px rgba(16,33,60,0.12); padding: 6px; min-width: 215px; z-index: 70; }
      .nh-menu-box a, .nh-menu-box .nh-off { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 8px; font-size: 13px; text-decoration: none; color: var(--ink); }
      .nh-menu-box a:hover { background: #f4f7fa; }
      .nh-menu-box .nh-off { color: #B9BFC7; cursor: not-allowed; }
      .nh-tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; color: #C4C9D0; }
      .nh-sep { height: 1px; background: var(--line); margin: 5px 8px; }
      .nh-band { border-top: 1px solid #f1f3f6; }
      .nh-mondi { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
      .nh-mondo { padding: 9px 14px; font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none; border-bottom: 2.5px solid transparent; white-space: nowrap; }
      .nh-mondo:hover { color: var(--ink); }
      .nh-mondo.on { color: var(--blue); border-bottom-color: var(--blue); }
      ${/* `flex-wrap` aggiunto l'11/08: la riga dei mondi andava già a capo da
            sola, questa no, e su uno schermo stretto le sotto-voci uscivano dal
            bordo. Vale anche con due sole voci, se i nomi sono lunghi. */ ''}
      .nh-sub { display: flex; align-items: center; gap: 3px; margin-left: auto; flex-wrap: wrap; }
      .nh-sub a { font-size: 12px; color: var(--muted); text-decoration: none; padding: 5px 11px; border-radius: 16px; white-space: nowrap; }
      .nh-sub a.on { background: #eef4f9; color: var(--blue); font-weight: 600; }
      ${/* Le sezioni dell'area Amministrazione: stanno DENTRO la pagina, sotto il
            titolo, non nella barra in alto (scelta di Germano, 11/08). Le voci
            spente sono le fasi 3, 4 e 5 del cantiere: si vedono per far capire
            dove si sta andando, e si accendono una per volta. */ ''}
      .am-nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 22px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
      .am-nav a, .am-nav span { font-size: 13px; padding: 7px 14px; border-radius: 18px; text-decoration: none; white-space: nowrap; }
      .am-nav a { color: var(--muted); }
      .am-nav a:hover { background: #f4f7fa; color: var(--ink); }
      .am-nav a.on { background: #eef4f9; color: var(--blue); font-weight: 700; }
      .am-nav span { color: #C4C9D0; cursor: not-allowed; }
      .nh-bric { display: flex; align-items: center; gap: 7px; padding: 7px 0; font-size: 12px; color: var(--hint); flex-wrap: wrap; }
      .nh-bric a { color: var(--muted); text-decoration: none; }
      .nh-bric a:hover { color: var(--blue); text-decoration: underline; }
      .nh-bric b { color: var(--ink); font-weight: 600; }
      .nh-accent { height: 3px; background: var(--grad); }
      @media (max-width: 640px) { .nh-search, .nh-payoff { display: none; } }

      /* ── COL DITO (31/07) ───────────────────────────────────────────────
         Germano ha usato l'Hub dal telefono e ha dovuto ruotarlo più volte per
         riuscire a toccare le cose. Questo foglio di stile sta in OGNI pagina
         dell'Hub, quindi qui si sistemano tutte in un punto solo.
         44px è la misura sotto la quale un dito non prende il bersaglio al
         primo colpo; i campi di testo a 16px perché sotto quella soglia Safari
         su iPhone ingrandisce da solo la pagina appena li tocchi — ed è uno dei
         motivi per cui la pagina "salta" mentre scrivi.
         Fino a 1024px: telefoni e tablet. Sul Mac a schermo intero non cambia
         niente. La misura si controlla con la prova di portabilità. */
      @media (max-width: 1024px) {
        .btn { min-height: 44px; padding: 12px 20px; display: inline-flex; align-items: center; justify-content: center; }
        .btn-sm { min-height: 44px; padding: 11px 16px; font-size: 13px; }
        input, select, textarea { min-height: 44px; font-size: 16px; }
        input[type="checkbox"], input[type="radio"] { min-height: 0; width: 22px; height: 22px; }
        .field-label, .az-nome, .nh-tag, .zona-tit { font-size: 11px; }
        ${/* Due colonne su un telefono sarebbero due strisce strette: si impilano,
              e il filo che le separava passa da verticale a orizzontale. */ ''}
        .scheda-2col { grid-template-columns: 1fr; gap: 22px; }
        .scheda-2col > div + div { border-left: none; padding-left: 0; border-top: 1px solid var(--line); padding-top: 22px; }
        /* Una finestrella con sei campi non ci sta in uno schermo di telefono:
           si scorre, e va bene — purché TITOLO e PULSANTI restino appesi in
           alto e in basso (lo fa il foglio di stile delle finestrelle, che i
           controlli verificano). Qui si toglie solo il superfluo, per accorciare
           quanto si deve scorrere. */
        /* ⚠️ 18/08 — «width: auto» qui SEMBRA sbagliato e non lo è. Misurando la
           finestrella dell'incasso l'avevo vista larga 52px e stavo per
           cambiarla: erano i 26+26 di padding attorno a un contenuto largo zero,
           perché il pannello del browser di prova era collassato. A finestra
           vera (900px) «auto» e «100%» danno lo stesso identico risultato: 440px,
           cioè il limite scritto sulla finestrella. Non si tocca. */
        .modal-box { width: auto !important; max-width: 100%; }
        .modal-box textarea { min-height: 110px !important; }
        /* I link di NAVIGAZIONE (i tre mondi, il menu, le briciole) sono
           bersagli come i pulsanti. I link dentro un testo NON si toccano:
           ingrandirli spezzerebbe la riga in cui stanno. */
        .nh-mondo { padding: 13px 14px; }
        .nh-menu-box a, .nh-menu-box .nh-off { padding: 13px 12px; }
        .nh-bric a { display: inline-block; padding: 14px 0; }
        .am-nav a, .am-nav span { padding: 13px 16px; }
      }
    </style>
  `;
}

// Header brandizzato Noesys — l'UNICO dell'Hub dal 28/07: tutte le pagine sono
// migrate, la vecchia appBar() e le sue regole CSS non esistono più.
// Tre fasce: identità · i tre mondi · dove sei.
//   mondo    → 'individuali' | 'progetti' | 'lead' | '' (funzione trasversale)
//   sub      → sotto-voce attiva del mondo (i Committenti vivono dentro Progetti)
//   briciole → [{label, href}] dalla radice alla pagina; l'ultima non è un link
// Il descrittore "Professional Coaching" è TESTO accanto al logo, non dentro
// l'SVG: scelta di Germano 26/07 — nel marchio esteso, alle misure da header,
// il descrittore scende sotto i 6px e diventa illeggibile.
function headerNoesys({ mondo = '', sub = '', briciole = [], q = '' } = {}) {
  const MONDI = [
    { key: 'individuali', label: 'Percorsi Individuali', href: '/dashboard/individuali' },
    { key: 'progetti',    label: 'Progetti Strutturati', href: '/dashboard/progetti' },
    { key: 'lead',        label: 'Lead',                 href: '/dashboard/leads' },
    // 11/08 — QUARTO MONDO. Scelta di Germano: tenere separata la gestione del
    // lavoro (le persone) da quella amministrativa (i soldi). Non ha una porta
    // nella home come gli altri tre — è un'area di servizio, non un mondo di
    // persone — e ci si arriva solo da qui.
    { key: 'amministrazione', label: 'Amministrazione', href: '/dashboard/amministrazione' },
  ];
  const SOTTOVOCI = {
    progetti: [
      { key: 'progetti',    label: 'Progetti',    href: '/dashboard/progetti' },
      { key: 'committenti', label: 'Committenti', href: '/dashboard/committenti' },
    ],
    // ⚠️ Amministrazione NON ha sotto-voci qui: le sue sezioni stanno DENTRO la
    // pagina (scelta di Germano, 11/08). La barra in alto porta ai mondi, non
    // dentro un mondo.
  };
  const mondiHtml = MONDI.map(m =>
    `<a class="nh-mondo${m.key === mondo ? ' on' : ''}" href="${m.href}">${m.label}</a>`).join('');
  const sottoHtml = (SOTTOVOCI[mondo] || []).map(s =>
    `<a href="${s.href}"${s.key === sub ? ' class="on"' : ''}>${s.label}</a>`).join('');
  // ⭐ Fetta 3.1 (04/09/2026): le briciole ci sono SU OGNI PAGINA, e cominciano
  //    sempre da «Home». Prima stavano su 4 pagine su 15 e la home si
  //    raggiungeva solo dal logo: da Proforma si tornava col tasto del browser.
  //    Chi passa le sue briciole le tiene; chi non le passa le riceve dal mondo
  //    (e dalla sotto-voce) in cui sta. La home stessa non ne ha.
  const ETICHETTE_SUB = { anomalie: 'Anomalie', proforma: 'Proforma', contratti: 'Contratti', emittente: 'Chi emette',
                          progetti: 'Progetti', committenti: 'Committenti' };
  const mondoDi = MONDI.find(m => m.key === mondo);
  let crumbs = briciole.length ? briciole.slice()
    : mondoDi ? [{ label: mondoDi.label, href: mondoDi.href }, ...(sub && ETICHETTE_SUB[sub] && sub !== mondo ? [{ label: ETICHETTE_SUB[sub] }] : [])]
    : (q ? [{ label: 'Ricerca' }] : []);
  if (crumbs.length && crumbs[0].href !== '/dashboard') crumbs = [{ label: 'Home', href: '/dashboard' }, ...crumbs];
  const bricHtml = crumbs.map((b, i) => {
    const ultima = i === crumbs.length - 1;
    const voce = (b.href && !ultima) ? `<a href="${b.href}">${esc(b.label)}</a>` : `<b>${esc(b.label)}</b>`;
    return (i ? '<span>›</span>' : '') + voce;
  }).join('');

  return `<header class="nh">
    <div class="nh-row nh-top">
      <a class="nh-brand" href="/dashboard" aria-label="Noesys Professional Coaching">${logoCompact(44)}<span class="nh-payoff">Professional<br>Coaching</span></a>
      <span class="nh-spacer"></span>
      <form class="nh-search" action="/dashboard/cerca" method="get" role="search">
        <input type="search" name="q" value="${esc(q)}" placeholder="Cerca cliente, committente, progetto…" aria-label="Cerca">
      </form>
      <details class="nh-menu">
        <summary title="Funzioni">⚙</summary>
        <div class="nh-menu-box">
          <a href="/dashboard/icf">Estratto ICF</a>
          <div class="nh-off">Prenotazioni <span class="nh-tag">in arrivo</span></div>
          ${/* «Fatturazione — in arrivo» stava qui: tolta l'11/08. Adesso quella
                roba ha una porta vera, il mondo Amministrazione nella barra, e
                due porte per la stessa cosa confondono e basta. */ ''}
          <div class="nh-sep"></div>
          <a href="/dashboard/diag/drive">Verifica Google Drive</a>
          <div class="nh-sep"></div>
          <a href="/logout">Esci</a>
        </div>
      </details>
    </div>
    <div class="nh-band"><div class="nh-row nh-mondi">${mondiHtml}${sottoHtml ? `<span class="nh-sub">${sottoHtml}</span>` : ''}</div></div>
    ${bricHtml ? `<div class="nh-band"><div class="nh-row nh-bric">${bricHtml}</div></div>` : ''}
    <div class="nh-accent"></div>
  </header>`;
}

function fonteOptions(sel) {
  return FONTI.map(f => `<option value="${f}"${f===sel?' selected':''}>${FONTE_LABEL[f]}</option>`).join('');
}

function areaOptions(sel) {
  return AREE.map(a => `<option value="${a}"${a===sel?' selected':''}>${a}</option>`).join('');
}

function socialOptions(sel) {
  return `<option value="">—</option>` + SOCIAL.map(s => `<option value="${s}"${s===sel?' selected':''}>${s}</option>`).join('');
}

// Compone l'indirizzo in una riga leggibile: "Via Roma 12, 20100 Milano (MI)".
function composeAddress(c) {
  const parts = [];
  if (c.via) parts.push(c.via);
  const cc = [c.cap, c.citta].filter(Boolean).join(' ');
  if (cc) parts.push(cc);
  let addr = parts.join(', ');
  if (c.provincia) addr += ` (${c.provincia})`;
  return addr;
}

// ═══════════════════════════════════════════════════════
// PAGINE
// ═══════════════════════════════════════════════════════

// Formattatori celle della Scheda Cliente.
function boldify(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }

function cellText(v) {
  if (!v || !String(v).trim() || String(v).trim() === '—') return '<span style="color:#ccc">—</span>';
  return String(v).trim().split(/\r?\n/).map(l => boldify(l)).join('<br>');
}

function cellList(v) {
  if (!v || !String(v).trim() || String(v).trim() === '—') return '<span style="color:#ccc">—</span>';
  const s = String(v).trim();
  let items = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullety = items.filter(l => /^[-•*]\s+/.test(l)).length >= Math.ceil(items.length / 2);
  if (items.length > 1 && bullety) items = items.map(l => l.replace(/^[-•*]\s+/, ''));
  else if (items.length === 1 && (s.match(/;/g) || []).length >= 1) items = s.split(/;\s*/).map(x => x.trim()).filter(Boolean);
  if (items.length <= 1) return cellText(v);
  return '<ul style="margin:0;padding-left:16px">' + items.map(x => '<li style="margin-bottom:3px">' + boldify(x) + '</li>').join('') + '</ul>';
}

function cellDate(v) {
  const s = v ? String(v).trim() : '';
  if (!s || s === '—') return '<span style="color:#ccc">—</span>';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? itDate(s) : esc(s);
}

function cellEseg(v) {
  const s = v ? String(v).trim() : '';
  if (s === '✓') return '<span style="color:#2e6b52;font-weight:700;font-size:15px">✓</span>';
  if (s === '✗' || /^x$/i.test(s)) return '<span style="color:#c0392b;font-weight:700;font-size:15px">✗</span>';
  return '<span style="color:#ccc">—</span>';
}

// Una riga della Scheda Cliente (una per sessione).
function renderSedutaRow(s) {
  const T = { Intake: { bg: '#e8f4fd', c: '#1A5280' }, Ongoing: { bg: '#eafaf1', c: '#4F8B73' }, Final: { bg: '#fff8ec', c: '#8a6d1e' } }[s.tipo] || { bg: '#eee', c: '#555' };
  const isProg = isProgrammata(s);
  const isBozza = s.stato === 'bozza' && !isProg;
  const cell = v => (v && String(v).trim() && String(v).trim() !== '—') ? esc(String(v)) : '<span style="color:#ccc">—</span>';
  const noteVal = (s.note && s.note.trim()) ? s.note : (s.scheda || ''); // recupera il vecchio formato
  const approvaBtn = isBozza
    ? `<button onclick="approvaSeduta('${s.id}','${s.percorso_id}')" class="btn btn-sm" style="background:#e7f1ec;color:#2e6b52;display:block;margin-bottom:5px" title="Approva">✓ Approva</button>` : '';
  return `<tr style="${isBozza ? 'background:#fffdf3' : (isProg ? 'background:#f6faff' : '')}">
    <td style="white-space:nowrap">${s.data ? itDate(s.data) : '—'}</td>
    <td style="white-space:nowrap"><span class="badge" style="background:${T.bg};color:${T.c}">${esc(s.tipo)}</span>${isBozza ? '<div style="margin-top:5px"><span class="badge" style="background:#fdf6e3;color:#8a6d1e;border:1px solid #efdfa8">bozza</span></div>' : ''}${isProg ? '<div style="margin-top:5px"><span class="badge" style="background:#eef4fb;color:#1A5280;border:1px solid #cfe0f0">in programma</span></div>' : ''}</td>
    <td>${cellText(s.obiettivo)}</td>
    <td>${cellList(s.argomenti)}</td>
    <td>${cellList(s.attivita)}</td>
    <td style="white-space:nowrap">${cellDate(s.scadenza)}${/^\d{1,2}:\d{2}$/.test(s.prossima_ora || '') ? `<div style="font-size:11px;color:var(--hint);margin-top:2px">ore ${esc(s.prossima_ora)}</div>` : ''}</td>
    <td style="text-align:center">${cellEseg(s.eseguita)}</td>
    <td>${cellText(noteVal)}</td>
    <td style="white-space:nowrap">${approvaBtn}<button onclick="editSeduta('${s.id}')" class="btn btn-neutral btn-sm" title="Modifica">✎</button> <button onclick="delSeduta('${s.id}','${s.percorso_id}')" class="btn btn-danger btn-sm" title="${isBozza ? 'Scarta' : 'Elimina'}">🗑</button></td>
  </tr>`;
}

/**
 * UNA SEZIONE PIEGHEVOLE — nata nella scheda del cliente, dal 30/08 comune anche
 * alla pagina del progetto. Germano: «la pagina dei progetti occupa troppo
 * spazio, voglio poter aprire solo le sezioni che mi interessano».
 *
 * ⚠️ I pulsanti che finiscono nel <summary> DEVONO fermare il clic
 *    (`event.stopPropagation()`), altrimenti premerli chiude la sezione invece di
 *    fare quello che dicono. È la trappola numero uno di questo meccanismo.
 * ⭐ `aperta` non è un capriccio: una sezione si apre da sola quando ha qualcosa
 *    in sospeso, e riposa chiusa quando non chiede niente. È il modo in cui la
 *    pagina dice dove guardare senza che tu debba aprirle tutte.
 * ⚠️ L'intestazione (anagrafica del cliente, testata del progetto) NON si piega:
 *    è quella che dice dove sei.
 */
const sezionePieghevole = (titolo, corpo, aperta, azioni, id) => `
  <div class="card"${id ? ` id="${id}"` : ''}>
    <details class="sec"${aperta ? ' open' : ''}>
      <summary style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer">
        <span style="display:flex;align-items:center;gap:8px"><span class="sec-caret">▸</span>${titolo}</span>
        ${azioni ? `<span style="display:inline-flex;gap:8px;align-items:center">${azioni}</span>` : ''}
      </summary>
      <div style="margin-top:14px">${corpo}</div>
    </details>
  </div>`;

// ═══════════════════════════════════════════════════════
// PAGINA COMMITTENTI / SPONSOR (Fase 1)
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// PAGINA ANOMALIE — «cosa sistemare prima di fatturare»
//
// Layout secondo la spec §8: pochi colori, testo grande sui dati, ogni voce è
// un blocco chiuso, il ruolo (Cliente / Committente / Progetto) è etichettato
// ed è anche colorato. Si legge mentre si lavora, quindi niente decorazioni.
// ═══════════════════════════════════════════════════════
// Le sezioni dell'area Amministrazione. Stanno QUI, sotto il titolo della
// pagina, non nella barra in alto: la barra porta ai quattro mondi, dove si va
// dentro un mondo lo decide il mondo (regola di Germano, 11/08).
// Una funzione sola per tutte le pagine dell'area: due copie della stessa barra
// sono due occasioni di dimenticarsi di aggiornarne una.
// Le voci spente sono le fasi 4 e 5 del cantiere fatturazione.
function amNav(attiva) {
  const voci = [
    { key: 'anomalie',  label: 'Anomalie',             href: '/dashboard/amministrazione' },
    { key: 'contratti', label: 'Contratti',            href: '/dashboard/amministrazione/contratti' },
    { key: 'proforma',  label: 'Proforma',             href: '/dashboard/amministrazione/proforma' },
    { key: 'incassi',   label: 'Incassi',              off: true },
    { key: 'fatture',   label: 'Fatture da preparare', off: true },
    { key: 'emittente', label: 'Chi emette',           href: '/dashboard/amministrazione/emittente' },
  ];
  return `<nav class="am-nav" style="margin-top:14px">${voci.map(v => v.off
    ? `<span title="In arrivo">${v.label}</span>`
    : `<a href="${v.href}"${v.key === attiva ? ' class="on"' : ''}>${v.label}</a>`).join('')}</nav>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGINA PROFORMA (Fase 3, Tappa 3) — la lista dei passaggi.
//
// ⭐ Questa pagina NON è un prospetto di numeri da interpretare: è una sequenza
// di cose da fare, dall'alto in basso — chiedi → rileggi → (manda). È la
// richiesta di Germano del 12/08, ed è un requisito, non una premura:
// l'amministrazione gli pesa, quindi ogni riga deve dire l'AZIONE, col numero
// accanto, e non deve mai restare ferma in silenzio.
//
// I tre passaggi ci sono solo se hanno qualcosa dentro, tranne quando non c'è
// proprio niente: in quel caso lo dice, invece di lasciare la pagina bianca.
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ 18/08 — IL PDF SI APRE, E SI CHIUDE.
// Germano il 17/08: «ho provato ad aprire il pdf della proforma, si è aperto,
// ma non c'è la possibilità di chiuderlo». Il PDF si apriva in una SCHEDA NUOVA
// (target="_blank"), servita «inline»: in una scheda aperta così il tasto
// «indietro» del browser è spento, perché quella scheda non ha una storia. Non
// c'era niente di rotto — semplicemente l'Hub non offriva nessuna via d'uscita
// e per uscire bisognava sapere di dover chiudere la scheda.
// ⭐ Adesso il documento si apre DENTRO l'Hub, con la sua X e il suo «Chiudi».
// ⚠️ Resta anche «Apri in una scheda nuova»: per stampare o salvare il file
// serve il visualizzatore vero del browser, e su un telefono un PDF dentro un
// riquadro si legge male. Una via sola non basterebbe per tutti e due i casi.
// ═══════════════════════════════════════════════════════════════════════════
function modalePdf() {
  return `
    ${/* z-index sopra le altre finestrelle (che stanno a 100): l'anteprima si
          apre anche da DENTRO «Rivedi e manda», e deve starci sopra invece che
          sotto — altrimenti si aprirebbe e non si vedrebbe. */ ''}
    <div class="modal-overlay" id="modal-pdf" style="z-index:150">
      <div class="modal-box" style="max-width:900px;width:900px;padding:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <strong id="pdf-titolo" style="font-size:15px"></strong>
          <span style="flex:1"></span>
          <a id="pdf-scheda" href="#" target="_blank" class="btn btn-neutral btn-sm">Apri in una scheda nuova</a>
          <button onclick="chiudiPdf()" class="btn btn-neutral btn-sm" title="Chiudi">✕</button>
        </div>
        <iframe id="pdf-telaio" title="Anteprima del documento"
                style="width:100%;height:70vh;border:1px solid var(--line);border-radius:8px;background:#f7f9fb"></iframe>
        ${/* ⚠️ Questa riga c'è SEMPRE, e non è pigrizia. Non tutti i browser
              mostrano un PDF dentro un riquadro (su iPhone spesso no), e non
              c'è modo di saperlo da qui: se l'anteprima resta vuota, senza
              questa riga si tornerebbe al vicolo cieco di partenza — un
              documento aperto che non si sa come guardare né come chiudere. */ ''}
        <div style="font-size:11.5px;color:var(--hint);margin-top:6px">
          Non si vede il documento qui sopra? Aprilo in una scheda nuova con il pulsante in alto.
        </div>
        <div class="modal-actions" style="margin-top:12px">
          <span style="flex:1"></span>
          <button onclick="chiudiPdf()" class="btn btn-primary">Chiudi</button>
        </div>
      </div>
    </div>`;
}

function jsModalePdf() {
  return `
    function apriPdf(id, titolo) {
      var t = document.getElementById('pdf-telaio');
      document.getElementById('pdf-titolo').textContent = titolo || 'Documento';
      document.getElementById('pdf-scheda').href = '/dashboard/proforma/' + id + '/pdf';
      t.src = '/dashboard/proforma/' + id + '/pdf';
      document.getElementById('modal-pdf').style.display = 'flex';
    }
    function chiudiPdf() {
      // ⚠️ Si svuota il telaio: senza, il PDF resta caricato sotto la pagina e
      // alla riapertura si vedrebbe per un istante quello di prima.
      document.getElementById('pdf-telaio').src = 'about:blank';
      document.getElementById('modal-pdf').style.display = 'none';
    }
    // ⭐ 18/08 — UNA PROFORMA APPENA NATA SI FA VEDERE DA SOLA.
    // Chi la crea sta su un'altra pagina (la scheda del cliente, quella del
    // progetto) e poi viene portato qui: l'id viaggia nel sessionStorage, e qui
    // la finestrella si apre da sé. Prima al suo posto c'era una scheda nuova
    // del browser — cioè il vicolo cieco che stiamo togliendo.
    try {
      var appenaNata = sessionStorage.getItem('pdf-appena-nata');
      if (appenaNata) {
        sessionStorage.removeItem('pdf-appena-nata');
        var q = JSON.parse(appenaNata);
        if (q && q.id) apriPdf(q.id, q.titolo);
      }
    } catch (e) {}
    // Il tasto Esc chiude, come ci si aspetta da una finestrella.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById('modal-pdf')
          && document.getElementById('modal-pdf').style.display === 'flex') chiudiPdf();
    });`;
}

// Anteprima delle tre MATRICI. Un disegno solo: cambiano le etichette (cfg) e,
// per Covey, la percentuale di tempo su ogni voce più il subtotale del quadrante.
function renderMatrice(d, cfg) {
  const pesi = (cfg.pesi && d.pesi) ? d.pesi : null;
  const chip = (testo, p) => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(testo)}${p ? ` <strong style="color:#223B6E">${p}%</strong>` : ''}</span>`;
  let totale = 0;
  const blocks = cfg.quads.map(qd => {
    const voci = (d[qd.key] || []).filter(c => c && c.text);
    const sub = pesi ? voci.reduce((s, c) => s + (Number(pesi[c.id]) || 0), 0) : null;
    if (sub) totale += sub;
    return `<div style="margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:#6B7280;display:inline-flex;align-items:center">
        <span style="display:inline-block;min-width:18px;height:16px;line-height:16px;text-align:center;padding:0 4px;border-radius:8px;background:#223B6E;color:#fff;font-size:10px;font-weight:700;margin-right:6px">${qd.r}</span>${esc(qd.q)}${sub != null ? ` <span style="color:#9AA0AA;font-weight:600;margin-left:6px">${sub}% del tempo</span>` : ''}</span><br>
      ${voci.length ? voci.map(c => chip(c.text, pesi ? (Number(pesi[c.id]) || 0) : null)).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}
    </div>`;
  }).join('');
  const testa = d.decisione
    ? `<div style="margin-bottom:10px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">${esc(cfg.campo)}</span><br><span style="font-size:14px;font-weight:700;color:#223B6E">${esc(d.decisione)}</span></div>`
    : '';
  const coda = (pesi && totale)
    ? `<div style="font-size:11px;color:#9AA0AA;margin-top:6px">Tempo distribuito: <strong style="color:${totale === 100 ? '#4F8B73' : '#9AA0AA'}">${totale}%</strong></div>`
    : '';
  return `${testa}${blocks}${coda}`;
}

function renderSessionData(tool, jsonStr) {
  let d;
  try { d = JSON.parse(jsonStr); } catch(e) { return '<em style="color:#aaa">Dati non leggibili</em>'; }

  switch(tool) {
    case 'valori': {
      const top5 = (d.top5 || []).filter(Boolean);
      const zone = (d.zone || []).map(z => z.value).filter(Boolean);
      const altri = zone.filter(v => !top5.includes(v));
      return `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Top 5</span><br>
        ${top5.length ? top5.map((v,i) => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#1A5280;color:#fff;font-size:12px;font-weight:600">${i+1}. ${esc(v)}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}</div>
        ${altri.length ? `<div><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Altri valori selezionati</span><br>${altri.map(v => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(v)}</span>`).join('')}</div>` : ''}`;
    }
    case 'abilita': {
      const abilita = (d.zone || []).map(z => z.value).filter(Boolean);
      return `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Abilità selezionate</span><br>
        ${abilita.length ? abilita.map(v => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(v)}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}`;
    }
    // Le due ruote nuove salvano esattamente come la Ruota della Vita
    // ({areas:[{name,value}]}): stesso disegno, nessuna riga in più.
    case 'ruotavita':
    case 'ruota-leadership':
    case 'ruota-management': {
      const aree = (d.areas || []).filter(a => a.value !== null && a.value !== undefined);
      return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${aree.map(a => {
          const pct = Math.round((a.value / 10) * 100);
          const col = a.value >= 7 ? '#4F8B73' : a.value >= 4 ? '#D8AE2E' : '#C0392B';
          return `<div style="background:#f8f9fb;border-radius:8px;padding:8px 10px">
            <div style="font-size:11px;font-weight:700;color:#6B7280;margin-bottom:4px">${esc(a.name)}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:#e6e9ee;border-radius:3px"><div style="width:${pct}%;height:100%;background:${col};border-radius:3px"></div></div>
              <span style="font-size:13px;font-weight:800;color:${col}">${a.value}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }
    case 'lineavita': {
      const eventi = (d.events || []).slice().sort((a,b) => a.year - b.year);
      return eventi.length ? `<div style="display:flex;flex-direction:column;gap:6px">
        ${eventi.map(e => `<div style="display:flex;gap:10px;align-items:baseline">
          <span style="font-size:12px;font-weight:800;color:#1A5280;min-width:38px">${e.year}</span>
          <span style="font-size:11px;color:${e.type==='negative'?'#C0392B':'#4F8B73'}">${e.type==='negative'?'↓':'↑'}</span>
          <span style="font-size:12px;color:#2C3E50">${esc(e.desc)}</span>
        </div>`).join('')}
      </div>` : '<span style="color:#aaa;font-size:12px">Nessun evento</span>';
    }
    case 'brainstorming': {
      const esplorate = (d.exploreCards || []).map(c => c.text).filter(Boolean);
      const selezionate = (d.selectCards || []).map(c => c.text).filter(Boolean);
      return `${esplorate.length ? `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Idee esplorate</span><br>${esplorate.map(t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(t)}</span>`).join('')}</div>` : ''}
        ${selezionate.length ? `<div><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Idee selezionate</span><br>${selezionate.map(t => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#1A5280;color:#fff;font-size:12px">${esc(t)}</span>`).join('')}</div>` : ''}
        ${!esplorate.length && !selezionate.length ? '<span style="color:#aaa;font-size:12px">—</span>' : ''}`;
    }
    case 'genogramma': {
      const persone = (d.persons || []).filter(p => p.name);
      return `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9AA0AA">Persone</span><br>
        ${persone.length ? persone.map(p => `<span style="display:inline-block;margin:3px 4px 3px 0;padding:3px 10px;border-radius:14px;background:#eef1f5;color:#4a5568;font-size:12px">${esc(p.name)}${p.role ? ` <em style="color:#9AA0AA">${esc(p.role)}</em>` : ''}</span>`).join('') : '<span style="color:#aaa;font-size:12px">—</span>'}`;
    }
    // Le tre MATRICI (Logica Cartesiana, SWOT, Covey/Eisenhower) sono lo stesso
    // strumento con parole diverse: un campo in cima + quattro elenchi di voci
    // {id,text}. Cambiano solo le etichette. Covey ha in più la percentuale di
    // tempo per singola voce (la sua Fase 2): quella si mostra, ed è il motivo per
    // cui lo strumento esiste (deciso da Germano 28/07).
    case 'logica-cartesiana':
      return renderMatrice(d, { campo: 'Decisione', quads: [
        { r:'I',   key:'accade_faccio',       q:'Cosa accade se lo faccio?' },
        { r:'II',  key:'accade_nonfaccio',    q:'Cosa accade se non lo faccio?' },
        { r:'III', key:'nonaccade_faccio',    q:'Cosa non accade se lo faccio?' },
        { r:'IV',  key:'nonaccade_nonfaccio', q:'Cosa non accade se non lo faccio?' },
      ] });
    case 'swot':
      return renderMatrice(d, { campo: 'Attività analizzata', quads: [
        { r:'I',   key:'forze',       q:'Forze · interni, positivi' },
        { r:'II',  key:'debolezze',   q:'Debolezze · interni, negativi' },
        { r:'III', key:'opportunita', q:'Opportunità · esterni, positivi' },
        { r:'IV',  key:'minacce',     q:'Minacce · esterni, negativi' },
      ] });
    case 'covey-eisenhower':
      // NIENTE nomi dei quadranti (Crisi/Qualità/Delega/Sprechi): Germano li ha
      // fatti togliere dallo strumento perché giudicanti. Restano gli assi.
      return renderMatrice(d, { campo: 'Ambito osservato', pesi: true, quads: [
        { r:'I',   key:'crisi',    q:'Urgente · importante' },
        { r:'II',  key:'qualita',  q:'Non urgente · importante' },
        { r:'III', key:'delega',   q:'Urgente · non importante' },
        { r:'IV',  key:'sprechi',  q:'Non urgente · non importante' },
      ] });
    default:
      // Le quattro anteprime mancanti (ruote leadership/management, SWOT,
      // Covey/Eisenhower) sono una fetta a sé: qui si dichiara, non si finge.
      return '<span style="color:#aaa;font-size:12px">Anteprima in arrivo per questo strumento. Intanto la scheda si legge dagli strumenti del cliente.</span>';
  }
}

// ═══════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════

// Data e ora all'italiana (12/06/2026 10:40). Prima usciva in formato tecnico
// (2026-06-12 10:40), l'unico posto in tutto l'Hub che non parlava italiano.
// ⭐ Fetta 4.3 (04/09/2026): le date vivono in `date-it.js`. Questi tre nomi
//    restano perché le pagine li usano centinaia di volte; il corpo è uno solo.
//    `fmtDate` è sparita: tagliava l'ora di Greenwich da un timestamp (e l'unico
//    punto che la usava ora chiama itDateTime).
function oggiIso() { return dateIt.oggiRoma(); }

// Una sessione FISSATA ma non ancora avvenuta. Sta in tabella come bozza — così non
// conta né ore né sessioni, come tutte le bozze — ma non è una proposta da approvare:
// è un appuntamento preso, ed è la riga da cui nasce il Documento di chiusura.
// Si riconosce dalla data: nel futuro = deve ancora succedere.
function isProgrammata(s) {
  return s && s.stato === 'bozza' && !!s.data && String(s.data).slice(0, 10) > oggiIso();
}

function itDate(d) { return dateIt.dataIt(d); }

// Momento preciso (data + ora) in ORA ITALIANA: '11/08/2026 alle 10:30'.
// Serve per le scadenze dei permessi, dove l'ora conta davvero. Non si può usare
// fmtDate: quella taglia la stringa ISO, cioè mostra l'ora di Greenwich, e d'estate
// scriverebbe due ore in meno di quella che il coach e il cliente hanno all'orologio.
function itDateTime(d) { return dateIt.dataOraIt(d); }

// Data ISO (2026-07-11) → nome cartella Drive italiano con trattini (11-07-2026).
// Trattini e non "/" perché lo slash non è ammesso nei nomi di cartella su Drive.
function itFolderDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// '2026-01' → 'gennaio 2026'. Il giorno 15 e il fuso di Roma evitano che il mese
// scivoli a quello prima passando per l'ora di Greenwich.
function meseEsteso(aaaaMm) {
  const m = String(aaaaMm || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(aaaaMm || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long', year: 'numeric' }).format(d);
}

// Il prezzo di un percorso da solo è ambiguo: 900 € può essere il costo di una sessione
// o il totale di un pacchetto. Qui si scrive sempre accanto cosa significa, così la
// cifra che finirà nel contratto si legge senza doverla interpretare.
function prezzoPercorso(p) {
  if (!p.prezzo) return '<span style="color:#aaa">—</span>';
  const cifra = `€ ${fiscale.euro(p.prezzo)}`;
  if (p.modalita === 'Pacchetto') {
    const n = Number(p.n_sessioni_previste) || 0;
    return `${cifra}<br><span style="font-size:11px;color:#aaa">pacchetto${n ? ` di ${n} sessioni` : ''}</span>`;
  }
  return `${cifra}<br><span style="font-size:11px;color:#aaa">a sessione</span>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Per valori dentro ATTRIBUTI HTML (value="…", data-url="…"): è esc(), e basta.
// ⛔ 0.4 (03/09/2026) — NON dentro un onclick: lì si usa jsStr(). Prima questa
//    funzione prometteva di coprire anche «stringhe JS inline» e non faceva niente
//    (sostituiva &#39; con &#39;): una sicurezza che non esisteva.
function attr(str) {
  return esc(str);
}

// ⭐ 0.4 — UN VALORE LIBERO DENTRO UN onclick="…". Il browser decodifica le entità
// dell'attributo PRIMA di leggere il JavaScript: con esc() «D'Amico» diventa
// f('D&#39;Amico') → f('D'Amico') e la stringa si chiude a metà, il pulsante muore.
// Qui il valore diventa una stringa JavaScript vera (JSON, fra doppi apici, con
// gli escape giusti) e POI si rende sicura per l'attributo: il browser restituisce
// al JavaScript esattamente "D'Amico". Si scrive SENZA apici attorno:
//   onclick="apri(${jsStr(nome)})"
function jsStr(v) {
  return esc(JSON.stringify(String(v == null ? '' : v)));
}

// Ore con al più un decimale, senza ".0" inutile: 25 → "25", 1.5 → "1,5" (virgola IT).
function fmtOre(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',');
}

module.exports = { PLATFORM_URL, STRUMENTI, TOOL_LABEL, PERMESSO_ORE_SESSIONE, FONTI, FONTE_LABEL, SOCIAL, AREE, AREA_COLOR, STATO_CLIENTE, ORE_TIPO, scegliPercorsoContratto, baseStyle, headerNoesys, fonteOptions, areaOptions, socialOptions, composeAddress, boldify, cellText, cellList, cellDate, cellEseg, renderSedutaRow, sezionePieghevole, amNav, modalePdf, jsModalePdf, renderMatrice, renderSessionData, oggiIso, isProgrammata, itDate, itDateTime, itFolderDate, meseEsteso, prezzoPercorso, esc, attr, jsStr, fmtOre };
