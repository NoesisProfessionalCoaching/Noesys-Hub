/**
 * LO STATO DELLA PAGINA NON SI PERDE — fetta 2.4 del riordino (04/09/2026).
 *
 * Quasi ogni azione dell'Hub ricarica la pagina, e la pagina la ridisegna il
 * server: il testo scritto nella casella di ricerca e le sezioni che il coach
 * aveva aperto sparivano a ogni salvataggio (B5). Qui due promemoria nel
 * browser (sessionStorage, che vive finché la scheda è aperta):
 *   · ricordaFiltro()   — la casella #cerca: si salva a ogni lettera, si
 *                         rimette al caricamento e si riapplica il filtro;
 *   · ricordaSezioni()  — i <details class="sec">: si salva quali sono aperte
 *                         (per titolo, che è stabile), si riaprono al ritorno.
 * Le chiavi sono per pagina (il percorso dell'indirizzo), così il filtro dei
 * lead non finisce sui clienti. È lo stesso meccanismo di «pdf-appena-nata».
 * ⚠️ sessionStorage può non esserci (finestra privata, blocco dei dati): ogni
 *    lettura e scrittura è dentro un try, e senza promemoria la pagina è quella
 *    di sempre.
 */
function js() {
  return `
    function ricordaFiltro() {
      var casella = document.getElementById('cerca');
      if (!casella) return;
      var chiave = 'filtro:' + location.pathname;
      try {
        var salvato = sessionStorage.getItem(chiave);
        if (salvato && !casella.value) { casella.value = salvato; if (typeof filtra === 'function') filtra(); }
      } catch (e) {}
      casella.addEventListener('input', function () {
        try { sessionStorage.setItem(chiave, casella.value); } catch (e) {}
      });
    }
    function ricordaSezioni() {
      var sezioni = document.querySelectorAll('details.sec');
      if (!sezioni.length) return;
      var chiave = 'sezioni:' + location.pathname;
      // Il titolo senza numeri e cifre: «Percorsi (4)» e «Percorsi (5)» sono la
      // stessa sezione, e «Da chiedere: 0,00» cambia a ogni incasso.
      var titolo = function (d) { var s = d.querySelector('summary'); return s ? s.textContent.replace(/[\\d.,€()+:]/g, '').replace(/\\s+/g, ' ').trim().slice(0, 60) : ''; };
      var aperte = null;
      try { aperte = JSON.parse(sessionStorage.getItem(chiave) || 'null'); } catch (e) { aperte = null; }
      if (Array.isArray(aperte)) {
        sezioni.forEach(function (d) { var t = titolo(d); if (t) d.open = aperte.indexOf(t) >= 0; });
      }
      var salva = function () {
        var lista = [];
        document.querySelectorAll('details.sec').forEach(function (d) { if (d.open) { var t = titolo(d); if (t) lista.push(t); } });
        try { sessionStorage.setItem(chiave, JSON.stringify(lista)); } catch (e) {}
      };
      sezioni.forEach(function (d) { d.addEventListener('toggle', salva); });
    }
    // Parte quando la pagina è tutta letta: il blocco può stare in testa allo
    // script, e filtra() — dichiarata più sotto nello stesso blocco — c'è già.
    (function avviaPromemoria() {
      var via = function () { ricordaFiltro(); ricordaSezioni(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', via);
      else via();
    })();`;
}

module.exports = { js };
