import { isTranscriptionEnabled } from "@/lib/meet/transcribe";
import logger from "@/lib/logger";

const log = logger.child({ module: "voice-notes-availability" });

/**
 * Durée de vie du cache de disponibilité, en millisecondes.
 *
 * `isTranscriptionEnabled()` lit `system_settings` puis retombe sur les
 * variables d'environnement : plusieurs requêtes à chaque appel. Le bloc, lui,
 * interroge l'API à chaque montage et à chaque sondage. On garde donc la
 * réponse quelques secondes : une activation faite en administration est prise
 * en compte au plus tard une demi minute plus tard, ce qui est indolore.
 */
const CACHE_TTL_MS = 30_000;

let cached: { value: boolean; expiresAt: number } | null = null;

/**
 * Un moteur de transcription est il configuré sur cette instance ?
 *
 * Sert à désactiver le bloc d'emblée, avant tout enregistrement : sans cette
 * information, l'utilisateur ne découvrirait l'absence de moteur qu'après avoir
 * enregistré et envoyé sa note.
 */
export async function isVoiceNoteTranscriptionAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const value = await isTranscriptionEnabled();
    cached = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (err) {
    // Une panne de lecture de la configuration n'est pas une absence de moteur :
    // on laisse l'utilisateur tenter sa chance plutôt que de bloquer le bloc,
    // et on ne met pas ce résultat en cache.
    log.warn(
      { err: String(err) },
      "Disponibilité de la transcription illisible, bloc laissé actif"
    );
    return true;
  }
}

/** Vide le cache. Réservé aux tests et aux changements de configuration. */
export function resetTranscriptionAvailabilityCache(): void {
  cached = null;
}
