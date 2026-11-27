/** Raison d'échec d'un appel à l'API des tableaux de bord, traduisible côté client. */
export type DashboardApiFailure =
  | { kind: "forbidden" }
  | { kind: "notFound" }
  | { kind: "unauthenticated" }
  | { kind: "message"; message: string }
  | { kind: "generic" };

/**
 * Traduit une réponse en échec en raison affichable. Les refus (401, 403,
 * 404) ont un libellé traduit dédié ; une erreur de validation (400) remonte
 * le message de l'API, rédigé pour l'usager ; le reste tombe sur un message
 * générique (jamais de trace technique).
 */
export function classifyDashboardApiFailure(status: number, body: unknown): DashboardApiFailure {
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "notFound" };
  if (status === 400 && body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim() !== "") return { kind: "message", message: error };
  }
  return { kind: "generic" };
}
