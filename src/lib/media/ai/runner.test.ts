import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  media: null as Record<string, unknown> | null,
  settings: { indexEnabled: true, transcribeEnabled: true },
  statements: [] as string[],
  usedSeconds: 0,
  indexedToday: 0,
  buffer: Buffer.from("x") as Buffer | null,
  extract: vi.fn(),
  transcribe: vi.fn(),
  write: vi.fn(),
  enqueue: vi.fn(),
}));
const render = (q: unknown) =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => {
      if (c instanceof Date) return c.toISOString();
      if (typeof c === "object" && c && "value" in (c as object)) {
        const v = (c as { value: unknown }).value;
        return v instanceof Date ? v.toISOString() : String(v);
      }
      return typeof c === "string" || typeof c === "number" ? String(c) : "";
    })
    .join("");

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(h.media ? [h.media] : []) }) }) }),
    execute: (q: unknown) => {
      const t = render(q);
      h.statements.push(t);
      if (t.includes("AS reserved")) return Promise.resolve({ rows: [{ reserved: Math.min(3600, Math.max(0, 7200 - h.usedSeconds)) }] });
      if (t.includes("FROM media_ai_daily_usage")) return Promise.resolve({ rows: [{ transcribe_seconds: h.usedSeconds, indexed_passes: h.indexedToday }] });
      if (t.includes("indexed_passes") && t.includes("INSERT")) {
        if (h.indexedToday >= 300) return Promise.resolve({ rows: [] });
        h.indexedToday++;
        return Promise.resolve({ rows: [{ indexed_passes: h.indexedToday }] });
      }
      return Promise.resolve({ rows: [] });
    },
  },
}));
vi.mock("@/lib/storage/s3", () => ({ getFileBuffer: () => Promise.resolve(h.buffer) }));
vi.mock("./settings", () => ({ getMediaAiSettings: () => Promise.resolve(h.settings) }));
vi.mock("./extract", async () => {
  const actual = await vi.importActual<typeof import("./extract")>("./extract");
  return { extractableKind: actual.extractableKind, extractText: (...a: unknown[]) => h.extract(...a) };
});
vi.mock("./transcribe", () => ({ transcribeMedia: (...a: unknown[]) => h.transcribe(...a) }));
vi.mock("./index-media", () => ({ writeMediaIndex: (...a: unknown[]) => h.write(...a) }));
vi.mock("./enqueue", () => ({ enqueueMediaIndex: (...a: unknown[]) => h.enqueue(...a) }));

import { processOne, type ClaimedRow } from "./runner";

const NOW = new Date("2026-11-26T10:00:00.000Z");
const row: ClaimedRow = { id: "t1", mediaId: "m1", organizationId: "o1", version: 2, attempts: 0 };
const pdf = {
  id: "m1", organizationId: "o1", storageKey: "k/a.pdf", sizeBytes: 1000, mimeType: "application/pdf",
  filename: "a.pdf", kind: "pdf", uploadedBy: "u1", currentVersion: 2, deletedAt: null,
};
const last = () => h.statements[h.statements.length - 1] ?? "";
const updates = () => h.statements.filter((s) => s.includes("UPDATE media_texts"));

beforeEach(() => {
  h.media = { ...pdf };
  h.settings = { indexEnabled: true, transcribeEnabled: true };
  h.statements = [];
  h.usedSeconds = 0;
  h.indexedToday = 0;
  h.buffer = Buffer.from("x");
  h.extract.mockReset().mockResolvedValue({ ok: true, text: "contenu", source: "pdf", truncated: false });
  h.transcribe.mockReset().mockResolvedValue({ ok: true, text: "[00:01] salut", seconds: 90, truncated: false });
  h.write.mockReset().mockResolvedValue({ ok: true, chunks: 1 });
  h.enqueue.mockReset().mockResolvedValue(undefined);
});

describe("processOne : chemin nominal", () => {
  it("PDF : texte stocké, blocs écrits à la version de la tâche, indexed_at posé", async () => {
    expect(await processOne(row, NOW)).toBe("done");
    expect(h.write).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "m1", organizationId: "o1", uploadedBy: "u1", version: 2, text: "contenu" }));
    expect(last()).toContain("status = 'done'");
    expect(last()).toContain("indexed_at");
    expect(last()).toContain("status = 'running' AND version = 2");
  });
});

describe("processOne : interrupteurs relus et corbeille", () => {
  it("indexation désactivée entre la prise et le traitement : pending, aucun appel IA", async () => {
    h.settings = { indexEnabled: false, transcribeEnabled: false };
    expect(await processOne(row, NOW)).toBe("retry");
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(last()).toContain("disabled");
  });
  it("transcription désactivée : audio skipped disabled, Whisper non appelé", async () => {
    h.settings = { indexEnabled: true, transcribeEnabled: false };
    h.media = { ...pdf, mimeType: "audio/mpeg", filename: "a.mp3", kind: "audio" };
    expect(await processOne(row, NOW)).toBe("skipped");
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(last()).toContain("skipped");
    expect(last()).toContain("disabled");
  });
  it("média passé en corbeille entre la prise et le traitement : ligne rendue, aucun appel", async () => {
    h.media = { ...pdf, deletedAt: new Date() };
    expect(await processOne(row, NOW)).toBe("retry");
    expect(h.extract).not.toHaveBeenCalled();
    expect(last()).toContain("trashed");
  });
  it("média supprimé : ignoré sans erreur ni écriture", async () => {
    h.media = null;
    expect(await processOne(row, NOW)).toBe("skipped");
    expect(h.statements).toEqual([]);
  });
  it("média d'une autre organisation que la tâche : ignoré", async () => {
    h.media = { ...pdf, organizationId: "o2" };
    expect(await processOne(row, NOW)).toBe("skipped");
    expect(h.extract).not.toHaveBeenCalled();
  });
  it("version du média différente de celle de la tâche : réalignée par mise en file, rien d'indexé", async () => {
    h.media = { ...pdf, currentVersion: 3 };
    expect(await processOne(row, NOW)).toBe("retry");
    expect(h.enqueue).toHaveBeenCalledWith("m1", "replace");
    expect(h.extract).not.toHaveBeenCalled();
  });
  it("remplacé pendant l'indexation (stale) : aucune écriture de l'ancien index, pas d'essai consommé", async () => {
    h.write.mockResolvedValue({ ok: false, reason: "stale" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(updates()).toEqual([]);
  });
});

describe("processOne : causes transitoires (essais inchangés)", () => {
  it("quota IA : retry avec échéance future", async () => {
    h.write.mockResolvedValue({ ok: false, reason: "quota" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(last()).toContain("attempts + 0");
    expect(last()).toContain("2026-11-26T11:00:00.000Z");
  });
  it("aucun embedding : retry", async () => {
    h.write.mockResolvedValue({ ok: false, reason: "no_embedding" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(last()).toContain("attempts + 0");
  });
  it("moteur de transcription absent : retry", async () => {
    h.media = { ...pdf, mimeType: "video/mp4", filename: "a.mp4", kind: "video" };
    h.transcribe.mockResolvedValue({ ok: false, reason: "no_engine" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(last()).toContain("attempts + 0");
    expect(last()).toContain("no_engine");
  });
  it("plafond journalier de transcription : secondes réservées transmises, puis retry quand épuisé", async () => {
    h.media = { ...pdf, mimeType: "video/mp4", filename: "a.mp4", kind: "video" };
    h.usedSeconds = 7000;
    await processOne(row, NOW);
    expect(h.transcribe).toHaveBeenCalledWith(expect.objectContaining({ remainingDailySeconds: 200 }));
    h.usedSeconds = 7200;
    h.transcribe.mockClear();
    expect(await processOne(row, NOW)).toBe("retry");
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(last()).toContain("daily_quota");
  });
  it("réservation plafonnée à 3600 s : trois traitements parallèles ne consomment pas 3 h", async () => {
    h.media = { ...pdf, mimeType: "video/mp4", filename: "a.mp4", kind: "video" };
    await processOne(row, NOW);
    expect(h.transcribe).toHaveBeenCalledWith(expect.objectContaining({ remainingDailySeconds: 3600 }));
  });
  it("transcription réussie : réservation régularisée à la durée réelle (90 s)", async () => {
    h.media = { ...pdf, mimeType: "video/mp4", filename: "a.mp4", kind: "video" };
    expect(await processOne(row, NOW)).toBe("done");
    const adj = h.statements.find((s) => s.includes("GREATEST(0, transcribe_seconds +")) ?? "";
    expect(adj).toContain("-3510");
  });
  it("échec de transcription : réservation remboursée en entier", async () => {
    h.media = { ...pdf, mimeType: "video/mp4", filename: "a.mp4", kind: "video" };
    h.transcribe.mockResolvedValue({ ok: false, reason: "no_engine" });
    await processOne(row, NOW);
    expect(h.statements.some((s) => s.includes("GREATEST(0, transcribe_seconds +") && s.includes("-3600"))).toBe(true);
  });
  it("plafond quotidien de médias atteint : retry sans lecture S3", async () => {
    h.indexedToday = 300;
    expect(await processOne(row, NOW)).toBe("retry");
    expect(h.extract).not.toHaveBeenCalled();
  });
  it("le plafond compte des passages : le même média réindexé en boucle atteint 300", async () => {
    let done = 0;
    for (let i = 0; i < 305; i++) if ((await processOne(row, NOW)) === "done") done++;
    expect(done).toBe(300);
    expect(h.extract).toHaveBeenCalledTimes(300);
  });
});

describe("processOne : échecs et essais bornés", () => {
  it("erreur d'extraction : attempts + 1, pending, motif stocké, attente de 10 min", async () => {
    h.extract.mockResolvedValue({ ok: false, reason: "error" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(last()).toContain("extract_error");
    expect(last()).toContain("attempts + 1");
    expect(last()).toContain("2026-11-26T10:10:00.000Z");
  });
  it("3e échec : failed avec motif", async () => {
    h.extract.mockResolvedValue({ ok: false, reason: "error" });
    expect(await processOne({ ...row, attempts: 2 }, NOW)).toBe("failed");
    expect(last()).toContain("failed");
    expect(last()).toContain("extract_error");
  });
  it("reprise après plantage ayant épuisé les essais : failed sans traitement", async () => {
    expect(await processOne({ ...row, attempts: 3 }, NOW)).toBe("failed");
    expect(h.extract).not.toHaveBeenCalled();
    expect(last()).toContain("crashed");
  });
  it("texte vide (scan) : skipped empty", async () => {
    h.extract.mockResolvedValue({ ok: false, reason: "empty" });
    expect(await processOne(row, NOW)).toBe("skipped");
    expect(last()).toContain("empty");
  });
  it("erreur d'écriture : essai consommé", async () => {
    h.write.mockResolvedValue({ ok: false, reason: "error" });
    expect(await processOne(row, NOW)).toBe("retry");
    expect(last()).toContain("index_error");
  });
  it("exception inattendue : jamais propagée", async () => {
    h.extract.mockRejectedValue(new Error("boom"));
    await expect(processOne(row, NOW)).resolves.toBe("retry");
  });
  it("type sans extracteur : skipped unsupported", async () => {
    h.media = { ...pdf, mimeType: "application/zip", filename: "a.zip", kind: "archive" };
    expect(await processOne(row, NOW)).toBe("skipped");
    expect(last()).toContain("unsupported");
  });
});
