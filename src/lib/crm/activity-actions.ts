import { mutate } from "swr";

export interface ActivityActionResult {
  ok: boolean;
  code?: string;
}

export function crmActivityKey(databaseId: string, rowId: string): string {
  return `/api/crm/activity?databaseId=${encodeURIComponent(databaseId)}&rowId=${encodeURIComponent(rowId)}`;
}

async function send(url: string, init: RequestInit, key: string): Promise<ActivityActionResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, code: "network" };
  }
  await mutate(key);
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return { ok: false, code: typeof body?.code === "string" ? body.code : `http_${res.status}` };
}

export const cancelMail = (messageId: string, key: string) =>
  send(`/api/mail/messages/${messageId}/cancel`, { method: "POST" }, key);

export const retryMail = (messageId: string, key: string) =>
  send(`/api/mail/messages/${messageId}/retry`, { method: "POST" }, key);

export const toggleTaskDone = (taskId: string, done: boolean, key: string) =>
  send(
    `/api/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: done ? "done" : "open" }),
    },
    key,
  );
