/**
 * IL RINNOVO DEL TOKEN GOOGLE, UNA VOLTA SOLA — fetta 4.3 del riordino (04/09/2026).
 *
 * Drive e Gmail avevano due `getAccessToken` identiche, ognuna con la sua cache:
 * stesso scambio (refresh_token → access_token a breve vita), stesse righe.
 * Qui c'è una funzione sola, con una cache PER refresh token: Drive e Gmail
 * usano due refresh token diversi (GOOGLE_REFRESH_TOKEN e
 * GMAIL_SEND_REFRESH_TOKEN) e non devono scambiarsi il token l'uno dell'altro.
 * Nessuna credenziale è scritta qui o restituita al chiamante oltre al token.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// refresh_token → { token, scadenza }
const cache = new Map();

/**
 * L'access token per un refresh token. `etichetta` entra nel messaggio d'errore
 * («Rinnovo token Gmail fallito: …»), così chi legge sa quale collegamento è rotto.
 * @param {{ clientId:string, clientSecret:string, refreshToken:string, etichetta?:string, adesso?:number, chiama?:Function }} o
 */
async function tokenGoogle({ clientId, clientSecret, refreshToken, etichetta = 'Google', adesso, chiama }) {
  const now = adesso != null ? adesso : Date.now();
  const inCache = cache.get(refreshToken);
  if (inCache && now < inCache.scadenza) return inCache.token;
  const res = await (chiama || fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // data.error tipico: 'invalid_grant' (refresh_token errato/revocato) o
    // 'invalid_client' (client_id/secret incollati male). Utile in diagnosi.
    throw new Error('Rinnovo token ' + etichetta + ' fallito: ' + (data.error_description || data.error || res.status));
  }
  // si rinnova 60 s prima della scadenza reale
  cache.set(refreshToken, { token: data.access_token, scadenza: now + ((data.expires_in || 0) - 60) * 1000 });
  return data.access_token;
}

/** Solo per le prove: svuota la cache. */
function dimentica() { cache.clear(); }

module.exports = { tokenGoogle, dimentica, TOKEN_URL };
