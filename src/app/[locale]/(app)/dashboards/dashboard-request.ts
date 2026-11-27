"use client";

import { toast } from "sonner";
import { classifyDashboardApiFailure } from "@/lib/dashboards/api-error";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Appel à l'API des tableaux de bord avec toast d'erreur explicite : le titre
 * dit ce qui a échoué (`errorKey`, sous `dashboards.errors`), la description
 * dit pourquoi (droit refusé, élément disparu, validation, réseau). Rend la
 * réponse si elle est en succès, sinon `null`.
 */
export async function dashboardRequest(
  url: string,
  init: RequestInit | undefined,
  t: Translate,
  errorKey: string
): Promise<Response | null> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    toast.error(t(`errors.${errorKey}`), { description: t("errors.network") });
    return null;
  }
  if (res.ok) return res;
  const body: unknown = await res.json().catch(() => null);
  const failure = classifyDashboardApiFailure(res.status, body);
  const description = failure.kind === "message" ? failure.message : t(`errors.${failure.kind}`);
  toast.error(t(`errors.${errorKey}`), { description });
  return null;
}

/** En-têtes et corps JSON d'une écriture. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
