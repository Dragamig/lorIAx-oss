import type { ViewDef, ViewScope } from "./view-scope";

export type ViewApiResult<T = unknown> = { ok: true; data: T } | { ok: false; status: number; error: string | null };

async function call<T>(url: string, method: string, body?: unknown): Promise<ViewApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true, data: (await res.json().catch(() => ({}))) as T };
    let error: string | null = null;
    try {
      const json = await res.json();
      if (json && typeof json.error === "string") error = json.error;
    } catch {
      // corps absent ou non JSON
    }
    return { ok: false, status: res.status, error };
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

const base = (databaseId: string) => `/api/databases/${databaseId}/views`;

export const viewsApi = {
  create: (databaseId: string, view: { name: string; type: string; scope: ViewScope; config?: Record<string, unknown> }) =>
    call<{ id: string }>(base(databaseId), "POST", view),
  setScope: (databaseId: string, viewId: string, scope: ViewScope) =>
    call(`${base(databaseId)}/${viewId}`, "PATCH", { scope }),
  remove: (databaseId: string, viewId: string) => call(`${base(databaseId)}/${viewId}`, "DELETE"),
  /** Recrée une vue supprimée à l'identique (même portée, nom, type et config). */
  restore: (databaseId: string, v: ViewDef) =>
    call<{ id: string }>(base(databaseId), "POST", { name: v.name, type: v.type, scope: v.scope, config: v.config }),
};
