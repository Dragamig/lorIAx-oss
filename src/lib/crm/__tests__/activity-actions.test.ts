import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("swr", () => ({ default: vi.fn(), mutate: (...a: unknown[]) => mutate(...a) }));

import { cancelMail, retryMail, toggleTaskDone, crmActivityKey } from "../activity-actions";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  mutate.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body });
const ko = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body });
const KEY = crmActivityKey("db1", "row1");

describe("actions du fil d'activité", () => {
  it("la clé SWR porte databaseId et rowId", () => {
    expect(KEY).toBe("/api/crm/activity?databaseId=db1&rowId=row1");
  });

  it("cancelMail : POST cancel puis revalide la clé", async () => {
    fetchMock.mockResolvedValue(ok());
    expect(await cancelMail("m1", KEY)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/mail/messages/m1/cancel", { method: "POST" });
    expect(mutate).toHaveBeenCalledWith(KEY);
  });

  it("retryMail : POST retry puis revalide la clé", async () => {
    fetchMock.mockResolvedValue(ok());
    expect(await retryMail("m1", KEY)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/mail/messages/m1/retry", { method: "POST" });
    expect(mutate).toHaveBeenCalledWith(KEY);
  });

  it("échec HTTP : renvoie le code, revalide quand même", async () => {
    fetchMock.mockResolvedValue(ko(409, { code: "already_sent" }));
    expect(await cancelMail("m1", KEY)).toEqual({ ok: false, code: "already_sent" });
    expect(mutate).toHaveBeenCalledWith(KEY);
  });

  it("échec HTTP sans code : code http_<status>", async () => {
    fetchMock.mockResolvedValue(ko(500));
    expect(await retryMail("m1", KEY)).toEqual({ ok: false, code: "http_500" });
  });

  it("échec réseau : code network, pas de revalidation", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await retryMail("m1", KEY)).toEqual({ ok: false, code: "network" });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("toggleTaskDone : PATCH status done puis revalide", async () => {
    fetchMock.mockResolvedValue(ok());
    expect(await toggleTaskDone("t1", true, KEY)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tasks/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "done" });
    expect(mutate).toHaveBeenCalledWith(KEY);
  });

  it("toggleTaskDone(false) rouvre la tâche", async () => {
    fetchMock.mockResolvedValue(ok());
    await toggleTaskDone("t1", false, KEY);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "open" });
  });

  it("toggleTaskDone : échec réseau", async () => {
    fetchMock.mockRejectedValue(new Error("x"));
    expect(await toggleTaskDone("t1", true, KEY)).toEqual({ ok: false, code: "network" });
  });
});
