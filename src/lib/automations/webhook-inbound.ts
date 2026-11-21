/**
 * Webhook entrant (Spec 1 §5) — génération token/secret et vérification.
 * Le token identifie l'automatisation dans l'URL publique ; le secret
 * (optionnel) authentifie l'appelant via l'en-tête X-Webhook-Secret.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateWebhookToken(): { token: string; secret: string } {
  return {
    token: randomBytes(24).toString("hex"),
    secret: randomBytes(24).toString("hex"),
  };
}

/**
 * Nettoie la `triggerConfig` d'un déclencheur `webhook_inbound` avant
 * persistance : le token/secret ne doivent JAMAIS venir du client — un
 * créateur/éditeur authentifié pourrait sinon imposer un token faible ou
 * devinable (ex. `0000...0000`), exposant un webhook public à un tiers non
 * authentifié capable de déclencher des actions à effet de bord.
 *
 * - À la création (`existing` absent) : régénère toujours un token/secret
 *   côté serveur (entropie ≥128 bits garantie).
 * - À l'édition (`existing` fourni) : conserve le token/secret déjà en base
 *   (pas de régénération à chaque PATCH non lié au webhook), en ignorant tout
 *   token/secret fourni par le client.
 */
export function sanitizeWebhookTriggerConfig(
  clientConfig: Record<string, unknown>,
  existing?: { token?: string; secret?: string; lastReceived?: unknown }
): Record<string, unknown> {
  const {
    token: _clientToken,
    secret: _clientSecret,
    lastReceived: _clientLast,
    ...rest
  } = clientConfig;
  if (existing) {
    const kept: Record<string, unknown> = { ...rest, token: existing.token, secret: existing.secret };
    if (existing.lastReceived !== undefined) kept.lastReceived = existing.lastReceived;
    return kept;
  }
  return { ...rest, ...generateWebhookToken() };
}

/** Clés de trigger_config gérées par le serveur : jamais acceptées du client. */
export const SERVER_MANAGED_TRIGGER_KEYS = ["token", "secret", "lastReceived"] as const;

/**
 * Calcule la triggerConfig à persister lors d'un PATCH, pour les routes
 * base-liée et autonome (logique commune). Retourne `undefined` quand rien
 * n'est à écrire. Les clés gérées par le serveur ne viennent jamais du client.
 */
export function resolvePatchedTriggerConfig(args: {
  currentTriggerType: string;
  currentConfig: unknown;
  nextTriggerType?: string;
  clientConfig?: Record<string, unknown>;
  regenerate?: boolean;
}): Record<string, unknown> | undefined {
  const { currentTriggerType, clientConfig, regenerate } = args;
  const current = (args.currentConfig ?? {}) as {
    token?: string;
    secret?: string;
    lastReceived?: unknown;
  };
  const nextType = args.nextTriggerType ?? currentTriggerType;
  if (nextType === "webhook_inbound") {
    const switching = currentTriggerType !== "webhook_inbound";
    const mustRegenerate = regenerate === true || switching || !current.token;
    // Rien à écrire : évite de réécrire (et de concurrencer lastReceived).
    if (!mustRegenerate && clientConfig === undefined) return undefined;
    return mustRegenerate
      ? sanitizeWebhookTriggerConfig(clientConfig ?? {})
      : sanitizeWebhookTriggerConfig(clientConfig ?? {}, current);
  }
  if (currentTriggerType === "webhook_inbound" && clientConfig !== undefined) {
    const {
      token: _t,
      secret: _s,
      lastReceived: _l,
      ...cleaned
    } = clientConfig;
    return cleaned;
  }
  return clientConfig;
}

/** Plafond du corps conservé dans `lastReceived` (octets de JSON). */
export const LAST_RECEIVED_MAX_BYTES = 16 * 1024;

export type LastReceived = {
  at: string;
  size: number;
  body: unknown;
  truncated?: true;
};

/** Dernier corps reçu, sans en-tête ; body = null + truncated si > 16 Ko. */
export function buildLastReceived(body: unknown, now: Date = new Date()): LastReceived {
  let json = "";
  try {
    json = JSON.stringify(body) ?? "";
  } catch {
    json = "";
  }
  const size = Buffer.byteLength(json, "utf-8");
  if (size > LAST_RECEIVED_MAX_BYTES) {
    return { at: now.toISOString(), size, body: null, truncated: true };
  }
  return { at: now.toISOString(), size, body };
}

/** Retire les clés sensibles du trigger_config d'un webhook entrant (lecture sans droit de gestion). */
export function redactWebhookTriggerConfig<T extends { triggerType: string; triggerConfig: unknown }>(
  row: T
): T {
  if (row.triggerType !== "webhook_inbound") return row;
  const { token: _t, secret: _s, lastReceived: _l, ...rest } = (row.triggerConfig ?? {}) as Record<
    string,
    unknown
  >;
  return { ...row, triggerConfig: rest };
}

/**
 * Comparaison à temps constant du secret configuré vs celui fourni par
 * l'appelant. Si aucun secret n'est configuré, le webhook est public :
 * on accepte toute requête (le token dans l'URL sert alors seul de secret).
 */
export function verifyWebhookSecret(config: { secret?: string }, provided: string | null): boolean {
  if (!config.secret) return true; // webhook public (pas de secret configuré)
  if (!provided) return false;
  const a = Buffer.from(config.secret);
  const b = Buffer.from(provided);
  // timingSafeEqual exige des buffers de même longueur : on compare d'abord la
  // longueur (fuite négligeable) avant l'égalité à temps constant du contenu.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Enveloppe le corps de la requête entrante pour l'interpolation `{{variables.body...}}`. */
export function buildWebhookPayload(body: unknown): { variables: { body: unknown } } {
  return { variables: { body } };
}
