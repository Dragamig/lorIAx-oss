import { describe, it, expect, vi, beforeEach } from "vitest";

const selectResults: unknown[][] = [];
const send = vi.fn();
const visible = vi.fn();

function chain(result: () => unknown) {
  const c: Record<string, unknown> = {};
  for (const k of ["from", "where"]) c[k] = () => c;
  c.limit = () => Promise.resolve(result());
  return c;
}

vi.mock("@/lib/db", () => ({ db: { select: () => chain(() => selectResults.shift() ?? []) } }));
vi.mock("@/lib/storage/s3", () => ({ readFileBytes: (k: unknown) => send(k) }));
vi.mock("@/lib/media/list", () => ({ visibleMediaCondition: (...a: unknown[]) => visible(...a) }));

import { readMediaBytesForOrg as read } from "./server-read";

const USER = { id: "u" } as never;
const readMediaBytesForOrg = (id: string, org: string) => read(id, org, USER);

const ORG = "11111111-1111-4111-8111-111111111111";
const row = (o: object = {}) => ({
  storageKey: "k/a.png",
  mimeType: "image/png",
  organizationId: ORG,
  deletedAt: null,
  ...o,
});

beforeEach(() => {
  selectResults.length = 0;
  send.mockReset();
  visible.mockReset();
  visible.mockResolvedValue({});
});

describe("readMediaBytesForOrg", () => {
  it("absent : null", async () => {
    expect(await readMediaBytesForOrg("m", ORG)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("autre organisation ou corbeille : null", async () => {
    selectResults.push([row({ organizationId: "other" })]);
    expect(await readMediaBytesForOrg("m", ORG)).toBeNull();
    selectResults.push([row({ deletedAt: new Date() })]);
    expect(await readMediaBytesForOrg("m", ORG)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("lit les octets", async () => {
    selectResults.push([row()]);
    send.mockResolvedValue(Buffer.from([1, 2]));
    const r = await readMediaBytesForOrg("m", ORG);
    expect(r?.mimeType).toBe("image/png");
    expect([...(r?.buffer ?? [])]).toEqual([1, 2]);
  });
  it("erreur S3 : null", async () => {
    selectResults.push([row()]);
    send.mockRejectedValue(new Error("boom"));
    expect(await readMediaBytesForOrg("m", ORG)).toBeNull();
  });
  it("passe toujours par visibleMediaCondition", async () => {
    selectResults.push([]);
    await readMediaBytesForOrg("m", ORG);
    expect(visible).toHaveBeenCalledWith(USER, ORG, "live");
  });
});
