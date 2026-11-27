import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { Readable } from "stream";
import { readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const h = vi.hoisted(() => ({
  settings: { indexEnabled: true, transcribeEnabled: true },
  enabled: true,
  probe: { duration: "120", streams: [{ codec_type: "video" }, { codec_type: "audio" }] } as unknown,
  transcribe: vi.fn(),
  getStream: vi.fn(),
  calls: [] as { cmd: string; args: string[] }[],
  killed: false,
  hang: false,
  wavBytes: 0,
}));

vi.mock("child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    h.calls.push({ cmd, args });
    const ee = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
    ee.stdout = new EventEmitter();
    ee.kill = () => {
      h.killed = true;
    };
    if (!h.hang) {
      setImmediate(() => {
        if (cmd.includes("ffprobe")) {
          ee.stdout.emit("data", JSON.stringify({ format: { duration: (h.probe as { duration: string }).duration }, streams: (h.probe as { streams: unknown[] }).streams }));
        }
        if (cmd.includes("ffmpeg") && h.wavBytes) writeFileSync(args[args.length - 1], Buffer.alloc(h.wavBytes));
        ee.emit("close", 0);
      });
    }
    return ee;
  },
}));
vi.mock("@/lib/storage/s3", () => ({ getFileStream: (k: string) => h.getStream(k) }));
vi.mock("@/lib/meet/transcribe", () => ({
  isTranscriptionEnabled: () => Promise.resolve(h.enabled),
  transcribeWithEngine: (...a: unknown[]) => h.transcribe(...a),
}));
vi.mock("./settings", () => ({ getMediaAiSettings: () => Promise.resolve(h.settings) }));

import { transcribeMedia } from "./transcribe";

const base = {
  orgId: "o1",
  mediaId: "m1",
  storageKey: "k/video.mp4",
  sizeBytes: 1000,
  mimeType: "video/mp4",
  kind: "video" as const,
};
// Dossiers temporaires apparus pendant le test (un reste d'une exécution antérieure interrompue ne compte pas).
let baseline = new Set<string>();
const leftovers = () =>
  readdirSync(tmpdir()).filter((n) => n.startsWith("loriax-media-ai-") && !baseline.has(n));

beforeEach(() => {
  baseline = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("loriax-media-ai-")));
  h.settings = { indexEnabled: true, transcribeEnabled: true };
  h.enabled = true;
  h.probe = { duration: "120", streams: [{ codec_type: "video" }, { codec_type: "audio" }] };
  h.calls = [];
  h.killed = false;
  h.hang = false;
  h.wavBytes = 0;
  h.getStream.mockReset().mockImplementation(() => Promise.resolve(Readable.from([Buffer.from("data")])));
  h.transcribe.mockReset().mockResolvedValue({
    text: "bonjour",
    segments: [
      { start: 0, end: 2, text: " bonjour " },
      { start: 65, end: 70, text: "suite" },
    ],
    language: "fr",
    duration: 120,
  });
});

describe("transcribeMedia", () => {
  it("interrupteur désactivé : disabled, aucune lecture", async () => {
    h.settings = { indexEnabled: true, transcribeEnabled: false };
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "disabled" });
    expect(h.getStream).not.toHaveBeenCalled();
  });
  it("moteur absent : no_engine", async () => {
    h.enabled = false;
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "no_engine" });
  });
  it("échec réseau du moteur : no_engine", async () => {
    h.transcribe.mockRejectedValue(new TypeError("fetch failed"));
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "no_engine" });
    expect(leftovers()).toEqual([]);
  });
  it("plus de 500 Mo : too_large sans lecture S3", async () => {
    expect(await transcribeMedia({ ...base, sizeBytes: 524_288_001 })).toEqual({ ok: false, reason: "too_large" });
    expect(h.getStream).not.toHaveBeenCalled();
  });
  it("61 minutes : too_long sans appel Whisper", async () => {
    h.probe = { duration: "3660", streams: [{ codec_type: "audio" }] };
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "too_long" });
    expect(h.transcribe).not.toHaveBeenCalled();
  });
  it("vidéo sans piste audio : no_audio", async () => {
    h.probe = { duration: "10", streams: [{ codec_type: "video" }] };
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "no_audio" });
  });
  it("plafond journalier : quota", async () => {
    expect(await transcribeMedia({ ...base, remainingDailySeconds: 0 })).toEqual({ ok: false, reason: "quota" });
    expect(await transcribeMedia({ ...base, remainingDailySeconds: 60 })).toEqual({ ok: false, reason: "quota" });
    expect(h.transcribe).not.toHaveBeenCalled();
  });
  it("succès : mono 16 kHz, sans diarisation, texte horodaté, temp nettoyé", async () => {
    const r = await transcribeMedia(base);
    expect(r).toEqual({ ok: true, text: "[00:00] bonjour\n[01:05] suite", seconds: 120, truncated: false });
    const ff = h.calls.find((c) => c.cmd.includes("ffmpeg"))!;
    expect(ff.args).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000", "-vn"]));
    expect(h.transcribe).toHaveBeenCalledWith(expect.stringMatching(/loriax-media-ai-.*audio\.wav$/), { diarize: false });
    expect(leftovers()).toEqual([]);
  });
  it("ffmpeg borné par -t : plafond par média, ou secondes restantes si plus petit", async () => {
    await transcribeMedia(base);
    let ff = h.calls.find((c) => c.cmd.includes("ffmpeg"))!;
    expect(ff.args[ff.args.indexOf("-t") + 1]).toBe("3600");
    h.calls = [];
    await transcribeMedia({ ...base, remainingDailySeconds: 300 });
    ff = h.calls.find((c) => c.cmd.includes("ffmpeg"))!;
    expect(ff.args[ff.args.indexOf("-t") + 1]).toBe("300");
  });
  it("durée décomptée = audio réellement produit, pas celle du conteneur", async () => {
    h.wavBytes = 44 + 32_000 * 90; // 90 s de PCM 16 kHz mono
    const r = await transcribeMedia(base);
    expect(r.ok && r.seconds).toBe(90);
  });
  it("échec Whisper non réseau : error, temp nettoyé", async () => {
    h.transcribe.mockRejectedValue(new Error("Faster-Whisper API error (500)"));
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "error" });
    expect(leftovers()).toEqual([]);
  });
  it("texte vide : empty", async () => {
    h.transcribe.mockResolvedValue({ text: "  ", segments: [], language: "fr", duration: 5 });
    expect(await transcribeMedia(base)).toEqual({ ok: false, reason: "empty" });
  });
  it("sortie tronquée à MAX_TEXT_CHARS", async () => {
    h.transcribe.mockResolvedValue({ text: "x".repeat(250_000), segments: [], language: "fr", duration: 5 });
    const r = await transcribeMedia(base);
    expect(r.ok && r.truncated && r.text.length).toBe(200_000);
  });
  it("lecture en flux : le flux S3 est consommé vers le disque, pas de getFileBuffer", async () => {
    await transcribeMedia(base);
    expect(h.getStream).toHaveBeenCalledWith("k/video.mp4");
  });
  it("ffmpeg tué à l'échéance, temp nettoyé", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.hang = true;
    const p = transcribeMedia(base);
    // Attente bornée par l'horloge réelle (Date n'est pas simulée) : le spawn suit des E/S disque.
    const t0 = Date.now();
    while (!h.calls.length && Date.now() - t0 < 20_000) await new Promise((r) => setImmediate(r));
    expect(h.calls.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toEqual({ ok: false, reason: "error" });
    expect(h.killed).toBe(true);
    vi.useRealTimers();
    expect(leftovers()).toEqual([]);
  });
});
