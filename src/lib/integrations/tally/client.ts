/**
 * Client de l'API publique Tally (https://developers.tally.so).
 *
 * Toutes les requêtes passent par `fetchAllowlistedHost` (hôte unique
 * api.tally.so, HTTPS, pas de redirection). La clé ne figure jamais dans un
 * message d'erreur ni dans un journal.
 */
import { fetchAllowlistedHost } from "@/lib/security/outbound-fetch";

export const TALLY_API_BASE = "https://api.tally.so";
export const TALLY_HOSTS = ["api.tally.so"] as const;
/** 100 requêtes/minute documentées : on vise ~75 pour garder de la marge. */
export const TALLY_MIN_INTERVAL_MS = 800;
const MAX_RETRIES_429 = 3;
const MAX_RETRY_WAIT_MS = 60_000;
const DEFAULT_RETRY_WAIT_MS = 5_000;
export const SUBMISSIONS_PAGE_SIZE = 500;
/** Garde-fou de pagination (500 par page). */
const MAX_PAGES = 200;

export type TallyErrorKind = "invalid_key" | "rate_limited" | "not_found" | "http" | "network";

export class TallyError extends Error {
  constructor(
    public readonly kind: TallyErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "TallyError";
  }
}

export interface TallyQuestion {
  id: string;
  type: string;
  title: string;
  isDeleted?: boolean;
}

export interface TallyResponse {
  questionId: string;
  answer: unknown;
  formattedAnswer?: string;
}

export interface TallySubmission {
  id: string;
  formId: string;
  isCompleted?: boolean;
  submittedAt: string;
  responses: TallyResponse[];
}

export interface TallySubmissionsPage {
  page: number;
  hasMore: boolean;
  total: number | null;
  questions: TallyQuestion[];
  submissions: TallySubmission[];
}

export interface TallyForm {
  id: string;
  name: string;
}

export interface TallyWebhook {
  id: string;
  url: string;
  formId: string | null;
  isEnabled?: boolean;
}

export interface TallyClientOptions {
  apiKey: string;
  /** Pause entre deux requêtes (tests : 0). */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Remplaçable en test ; par défaut `fetchAllowlistedHost`. */
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(value: string | null): number {
  if (!value) return DEFAULT_RETRY_WAIT_MS;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_RETRY_WAIT_MS);
  return DEFAULT_RETRY_WAIT_MS;
}

export function createTallyClient(opts: TallyClientOptions) {
  const sleep = opts.sleep ?? realSleep;
  const minInterval = opts.minIntervalMs ?? TALLY_MIN_INTERVAL_MS;
  const fetcher =
    opts.fetcher ??
    ((url: string, init: RequestInit) =>
      fetchAllowlistedHost(url, { hosts: TALLY_HOSTS, timeoutMs: 20_000, init }));
  let lastCallAt = 0;

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      let res: Response;
      try {
        res = await fetcher(`${TALLY_API_BASE}${path}`, {
          method: init.method ?? "GET",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            Accept: "application/json",
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
      } catch {
        throw new TallyError("network", "Tally injoignable");
      }
      if (res.status === 401 || res.status === 403) {
        throw new TallyError("invalid_key", "Clé d'API Tally invalide", res.status);
      }
      if (res.status === 429) {
        if (attempt >= MAX_RETRIES_429) {
          throw new TallyError("rate_limited", "Quota Tally atteint, réessayez dans une minute", 429);
        }
        await sleep(parseRetryAfter(res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 404) throw new TallyError("not_found", "Ressource Tally introuvable", 404);
      if (!res.ok) throw new TallyError("http", `Erreur Tally (${res.status})`, res.status);
      return (await res.json().catch(() => ({}))) as T;
    }
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return {
    /** Vérifie la clé : lève `invalid_key` si elle est refusée. */
    async verify(): Promise<void> {
      await request(`/forms?page=1&limit=1`);
    },

    async listForms(): Promise<TallyForm[]> {
      const out: TallyForm[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await request<{ items?: unknown[]; hasMore?: boolean }>(
          `/forms?page=${page}&limit=${SUBMISSIONS_PAGE_SIZE}`
        );
        for (const it of data.items ?? []) {
          const f = it as { id?: unknown; name?: unknown };
          if (str(f.id)) out.push({ id: str(f.id), name: str(f.name) });
        }
        if (!data.hasMore) break;
      }
      return out;
    },

    async getForm(formId: string): Promise<TallyForm> {
      const data = await request<{ id?: unknown; name?: unknown }>(`/forms/${encodeURIComponent(formId)}`);
      return { id: str(data.id) || formId, name: str(data.name) };
    },

    async listSubmissionsPage(
      formId: string,
      p: { page: number; limit?: number; startDate?: string; filter?: "all" | "completed" | "partial" }
    ): Promise<TallySubmissionsPage> {
      const q = new URLSearchParams({
        page: String(p.page),
        limit: String(p.limit ?? SUBMISSIONS_PAGE_SIZE),
        filter: p.filter ?? "completed",
      });
      if (p.startDate) q.set("startDate", p.startDate);
      const d = await request<{
        page?: number;
        hasMore?: boolean;
        totalNumberOfSubmissionsPerFilter?: Record<string, number>;
        questions?: TallyQuestion[];
        submissions?: TallySubmission[];
      }>(`/forms/${encodeURIComponent(formId)}/submissions?${q.toString()}`);
      const total = d.totalNumberOfSubmissionsPerFilter?.[p.filter ?? "completed"];
      return {
        page: d.page ?? p.page,
        hasMore: d.hasMore === true,
        total: typeof total === "number" ? total : null,
        questions: Array.isArray(d.questions) ? d.questions : [],
        submissions: Array.isArray(d.submissions) ? d.submissions : [],
      };
    },

    /** Parcourt toutes les pages ; `questions` est celle de la 1re page. */
    async *iterateSubmissions(
      formId: string,
      p: { startDate?: string; filter?: "all" | "completed" | "partial" } = {}
    ): AsyncGenerator<TallySubmissionsPage> {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await this.listSubmissionsPage(formId, { page, ...p });
        yield data;
        if (!data.hasMore) return;
      }
    },

    async listWebhooks(): Promise<TallyWebhook[]> {
      const out: TallyWebhook[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await request<{ webhooks?: unknown[]; items?: unknown[]; hasMore?: boolean }>(
          `/webhooks?page=${page}`
        );
        for (const it of data.webhooks ?? data.items ?? []) {
          const w = it as { id?: unknown; url?: unknown; formId?: unknown; isEnabled?: unknown };
          if (str(w.id)) {
            out.push({
              id: str(w.id),
              url: str(w.url),
              formId: str(w.formId) || null,
              isEnabled: typeof w.isEnabled === "boolean" ? w.isEnabled : undefined,
            });
          }
        }
        if (!data.hasMore) break;
      }
      return out;
    },

    async createWebhook(p: {
      formId: string;
      url: string;
      headers: { name: string; value: string }[];
    }): Promise<{ id: string }> {
      const data = await request<{ id?: unknown }>(`/webhooks`, {
        method: "POST",
        body: {
          formId: p.formId,
          url: p.url,
          eventTypes: ["FORM_RESPONSE"],
          httpHeaders: p.headers,
        },
      });
      return { id: str(data.id) };
    },
  };
}

export type TallyClient = ReturnType<typeof createTallyClient>;
