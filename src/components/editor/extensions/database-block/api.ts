// ─── API helpers ─────────────────────────────────────────────────────────────

/** Erreur d'API portant le statut HTTP et l'éventuel `code` métier du serveur. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(`API error: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body && typeof body.code === "string") code = body.code;
    } catch {
      // corps absent ou non JSON : pas de code métier
    }
    throw new ApiError(res.status, code);
  }
  return res.json();
}

export function apiPost<T>(
  url: string,
  body: unknown,
  init?: { headers?: Record<string, string> }
): Promise<T> {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return fetchJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T = void>(url: string, body: unknown): Promise<T> {
  return fetchJson(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
