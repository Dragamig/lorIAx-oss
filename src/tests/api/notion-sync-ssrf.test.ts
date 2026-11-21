/**
 * Non-regression SSRF de la synchro externe (Notion, Airtable) : le
 * telechargement des fichiers dont l'URL vient de la reponse du fournisseur
 * passe par `safeExternalFetch` (resolution DNS, redirections revalidees).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  fetch: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/crypto", () => ({ decrypt: () => "creds" }));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.upload }));
vi.mock("@/lib/databases/row-change-context", () => ({ setRowChangeContext: vi.fn() }));
vi.mock("@/lib/integrations/notion/client", () => ({ notionProvider: {} }));
vi.mock("@/lib/integrations/airtable/client", () => ({ airtableProvider: {} }));
vi.mock("@/lib/security/url-validator-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/url-validator-server")>()),
  resolvePublicAddresses: h.resolve,
  assertPublicHostname: h.resolve,
}));

import { downloadAndReupload } from "@/lib/integrations/sync-orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetch);
  h.resolve.mockRejectedValue(new Error("adresse privee"));
});

describe("downloadAndReupload", () => {
  it.each([
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://10.0.0.5/secret.png"],
    ["http://interne.example.com/a.png"], // hote resolu vers une adresse privee
  ])("notion_sync_blocks_private_ip_and_metadata_host: %s", async (url) => {
    const out = await downloadAndReupload([{ url, filename: "a.png" }], "space-1");
    expect(out).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("ne suit pas une redirection vers une cible interne", async () => {
    h.resolve.mockImplementation(async (u: URL) => {
      if (u.hostname === "public.example.com") return [{ address: "203.0.113.34", family: 4 }];
      throw new Error("adresse privee");
    });
    h.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }),
    );
    const out = await downloadAndReupload(
      [{ url: "https://public.example.com/a.png", filename: "a.png" }],
      "space-1",
    );
    expect(out).toEqual([]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(h.upload).not.toHaveBeenCalled();
  });
});
