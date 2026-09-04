/**
 * LA CHIAMATA CHE LEGGE LA RISPOSTA — fetta 2.1 del riordino (04/09/2026).
 *
 * Fino al 04/09 sedici pulsanti dell'Hub facevano così:
 *     await fetch(url, …);  location.reload();
 * cioè chiamavano il server e ricaricavano la pagina SENZA guardare cosa aveva
 * risposto. Se il server diceva di no (400, 404, 409, 500), la pagina si
 * ricaricava uguale e il coach non sapeva che il suo salvataggio non c'era
 * stato. La ricognizione del 03/09 (B4): «L'Hub tace».
 *
 * Qui c'è UNA funzione per tutte le pagine: chiama, legge la risposta, e se è
 * un rifiuto lo DICE (con le parole del server, che sono scritte per essere
 * lette) e restituisce null, così chi la usa non ricarica. Il pattern giusto
 * esisteva già in `muoviContratto`: questa è la sua forma condivisa.
 *
 * Uso nelle pagine (dentro il <script>, dopo aver incluso `js()` una volta):
 *     const d = await chiamaHub(url, { method: 'POST', headers: …, body: … });
 *     if (!d) return;            // il server ha detto no, e l'ha già detto al coach
 *     location.reload();
 * `chiamaHub(url)` da solo fa un POST senza corpo.
 */
function js() {
  return `
    async function chiamaHub(url, opzioni) {
      var r;
      try { r = await fetch(url, opzioni || { method: 'POST' }); }
      catch (e) { alert('Errore di rete: ' + e.message + '\\n\\nNiente è stato salvato. Controlla la connessione e riprova.'); return null; }
      var d = {};
      try { d = await r.json(); } catch (e) { d = {}; }
      if (!r.ok || (d && d.error)) {
        alert('Non salvato. ' + ((d && d.error) || ('Il server ha risposto ' + r.status + '.')));
        return null;
      }
      return d || {};
    }`;
}

module.exports = { js };
