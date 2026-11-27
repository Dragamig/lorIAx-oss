/**
 * URL HTTP(S) de sonde pour une URL LiveKit saisie en WebSocket.
 * `wss://` devient `https://` (jamais `http://`, sinon le serveur répond par
 * une redirection que la sonde, sans redirection suivie, compte comme panne).
 */
export function livekitProbeUrl(url: string): string {
  return url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}
