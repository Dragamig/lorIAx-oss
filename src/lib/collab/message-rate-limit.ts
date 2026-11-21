import * as decoding from "lib0/decoding";

/**
 * Limiteur de débit par connexion Hocuspocus (fenêtre fixe, sans timer).
 *
 * L'état est une simple Map purgée à la déconnexion : aucun setInterval à
 * arrêter. L'horloge est injectable pour les tests.
 */

// Types de message du protocole Hocuspocus (MessageType, @hocuspocus/server 3.x)
export const MESSAGE_TYPE = {
  Sync: 0,
  Awareness: 1,
  QueryAwareness: 3,
  Stateless: 5,
  BroadcastStateless: 6,
} as const;

/** Messages applicatifs (stateless, diffusion, requête d'awareness) par minute. */
export const CONTROL_MESSAGES_PER_MINUTE = 60;

/**
 * Plafond anti-flood pour la synchro Yjs et l'awareness. 60/min couperait une
 * frappe rapide (un update par touche, plus les curseurs) : on borne donc à
 * un niveau très au-dessus de l'usage humain (50 messages par seconde).
 */
export const SYNC_MESSAGES_PER_MINUTE = 3000;

export const RATE_WINDOW_MS = 60_000;

/** Code de fermeture WebSocket (plage privée 4xxx) pour un dépassement. */
export const RATE_LIMIT_CLOSE_CODE = 4429;

type Bucket = "control" | "sync";

interface WindowState {
  start: number;
  count: number;
}

/** Lit le type du message : varString (nom du document) puis varUint (type). */
export function readMessageType(update: Uint8Array): number | null {
  try {
    const decoder = decoding.createDecoder(update);
    decoding.readVarString(decoder);
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

function bucketOf(type: number | null): Bucket {
  if (
    type === MESSAGE_TYPE.Stateless ||
    type === MESSAGE_TYPE.BroadcastStateless ||
    type === MESSAGE_TYPE.QueryAwareness
  ) {
    return "control";
  }
  return "sync";
}

export function createMessageRateLimiter(now: () => number = Date.now) {
  const states = new Map<string, WindowState>();

  return {
    /** Retourne false quand la connexion dépasse son quota. */
    allow(connectionKey: string, update: Uint8Array): boolean {
      const bucket = bucketOf(readMessageType(update));
      const limit =
        bucket === "control" ? CONTROL_MESSAGES_PER_MINUTE : SYNC_MESSAGES_PER_MINUTE;
      const key = `${connectionKey}|${bucket}`;
      const t = now();
      let w = states.get(key);
      if (!w || t - w.start >= RATE_WINDOW_MS) {
        w = { start: t, count: 0 };
        states.set(key, w);
      }
      w.count += 1;
      return w.count <= limit;
    },
    /** À appeler à la déconnexion : libère l'état de la connexion. */
    release(connectionKey: string): void {
      states.delete(`${connectionKey}|control`);
      states.delete(`${connectionKey}|sync`);
    },
    size: () => states.size,
  };
}
