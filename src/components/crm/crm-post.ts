import { crmTimezone } from "@/lib/crm/use-crm-data";

export interface CrmPostResult {
  ok: boolean;
  code?: string;
}

/** POST JSON vers une route CRM (fuseau du navigateur en paramètre), sans exception. */
export async function postCrm(path: string, body: unknown): Promise<CrmPostResult> {
  try {
    const res = await fetch(`${path}?tz=${encodeURIComponent(crmTimezone())}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    return { ok: false, code: json?.code };
  } catch {
    return { ok: false };
  }
}
