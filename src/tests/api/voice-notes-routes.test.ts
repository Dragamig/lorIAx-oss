/**
 * Routes des notes vocales : contrôle d'accès documentaire, garde-fou de
 * validation avant tout traitement IA, et refus des audios hors format.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** État partagé avec la fausse base, hissé avant les mocks. */
const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  returningRows: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(state.selectQueue.shift() ?? [])),
    insert: vi.fn(() => self),
    values: vi.fn(() => self),
    update: vi.fn(() => self),
    set: vi.fn(() => self),
    returning: vi.fn(() => Promise.resolve(state.returningRows)),
  };
  return { db: self };
});
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
  checkDocumentEditAccess: vi.fn(),
}));
vi.mock("@/lib/voice-notes/guards", () => ({
  guardVoiceNotesModule: vi.fn(async () => null),
}));
vi.mock("@/lib/voice-notes/transcription", () => ({
  startTranscription: vi.fn(async () => undefined),
  runTranscription: vi.fn(async () => undefined),
}));
vi.mock("@/lib/voice-notes/process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice-notes/process")>()),
  runVoiceNoteProcess: vi.fn(async () => "Synthèse générée"),
  // La route ne fait qu'engager le traitement : la génération part en tâche de
  // fond, on vérifie l'engagement, pas le résultat.
  startVoiceNoteProcess: vi.fn(async () => ({}) as never),
}));
vi.mock("@/lib/voice-notes/audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice-notes/audio")>()),
  saveAudioStream: vi.fn(async () => "/tmp/loriax-voice-notes/note-1.webm"),
  deleteAudioFile: vi.fn(async () => undefined),
}));
// La disponibilité du moteur est lue par les deux routes d'entrée du bloc :
// on la simule, le test ne porte pas sur la configuration de l'instance.
vi.mock("@/lib/voice-notes/availability", () => ({
  isVoiceNoteTranscriptionAvailable: vi.fn(async () => true),
  resetTranscriptionAvailabilityCache: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";
import { startTranscription } from "@/lib/voice-notes/transcription";
import {
  runVoiceNoteProcess,
  startVoiceNoteProcess,
} from "@/lib/voice-notes/process";
import { deleteAudioFile } from "@/lib/voice-notes/audio";
import { isVoiceNoteTranscriptionAvailable } from "@/lib/voice-notes/availability";
import {
  PROCESS_STALL_MS,
  TRANSCRIPTION_STALL_MS,
} from "@/lib/voice-notes/state-machine";

const mockUser = vi.mocked(getSessionUser);
const mockViewAccess = vi.mocked(checkDocumentViewAccess);
const mockEditAccess = vi.mocked(checkDocumentEditAccess);
const mockStartTranscription = vi.mocked(startTranscription);
const mockProcess = vi.mocked(runVoiceNoteProcess);
const mockStartProcess = vi.mocked(startVoiceNoteProcess);
const mockDeleteAudio = vi.mocked(deleteAudioFile);
const mockAvailable = vi.mocked(isVoiceNoteTranscriptionAvailable);

const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const SPACE_ID = "33333333-3333-4333-8333-333333333333";

const sessionUser = () =>
  ({ id: "user-1", name: "U", email: "u@x.com", globalRole: "editor" }) as never;

const noteRow = (overrides: Record<string, unknown> = {}) => ({
  id: NOTE_ID,
  documentId: DOC_ID,
  createdBy: "user-1",
  status: "review",
  audioPath: "/tmp/loriax-voice-notes/note-1.webm",
  durationSeconds: 12,
  transcript: "Rappeler le fournisseur.",
  transcriptValidatedAt: null,
  summary: null,
  cleanedText: null,
  summaryTranscriptHash: null,
  cleanedTranscriptHash: null,
  processingKind: null,
  processingStartedAt: null,
  errorCode: null,
  createdAt: new Date("2026-08-17T10:00:00Z"),
  updatedAt: new Date("2026-08-17T10:00:00Z"),
  ...overrides,
});

const docRow = { id: DOC_ID, spaceId: SPACE_ID };

/** Charge la note puis le document : deux SELECT par appel de route. */
const queueAccess = (note: Record<string, unknown>, times = 1) => {
  state.selectQueue = [];
  for (let i = 0; i < times; i++) state.selectQueue.push([note], [docRow]);
};

const ctx = { params: Promise.resolve({ id: NOTE_ID }) };

const jsonRequest = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.selectQueue = [];
  state.returningRows = [noteRow()];
  mockUser.mockResolvedValue(sessionUser());
  mockViewAccess.mockResolvedValue(true);
  mockEditAccess.mockResolvedValue(true);
  mockProcess.mockResolvedValue("Synthèse générée");
  mockStartProcess.mockResolvedValue(
    noteRow({ status: "validated", processingKind: "summary" }) as never
  );
  mockAvailable.mockResolvedValue(true);
});

describe("contrôle d'accès documentaire", () => {
  it("GET refuse quand le document parent est hors de portée", async () => {
    mockViewAccess.mockResolvedValue(false);
    queueAccess(noteRow());
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect(res.status).toBe(403);
  });

  it("GET refuse une note inexistante", async () => {
    state.selectQueue = [[]];
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect(res.status).toBe(404);
  });

  it("GET sans session renvoie 401", async () => {
    mockUser.mockResolvedValue(null);
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect(res.status).toBe(401);
  });

  it("le traitement exige un droit d'écriture sur le document", async () => {
    mockEditAccess.mockResolvedValue(false);
    queueAccess(noteRow({ status: "validated" }));
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "summary" }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(mockStartProcess).not.toHaveBeenCalled();
  });

  it("GET expose l'état sans le chemin serveur de l'audio", async () => {
    queueAccess(noteRow());
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.hasAudio).toBe(true);
    expect(body).not.toHaveProperty("audioPath");
  });
});

describe("aucun traitement IA sans validation", () => {
  it("refuse la synthèse sur une note en relecture", async () => {
    queueAccess(noteRow({ status: "review" }));
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "summary" }),
      ctx
    );
    expect(res.status).toBe(409);
    expect(mockStartProcess).not.toHaveBeenCalled();
  });

  it("refuse un kind inconnu", async () => {
    queueAccess(noteRow({ status: "validated" }));
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "traduction" }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("engage la synthèse sur une note validée et rend la main tout de suite", async () => {
    queueAccess(noteRow({ status: "validated", transcriptValidatedAt: new Date() }));
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "summary" }),
      ctx
    );
    // 202 et non 200 : la génération n'est pas finie, elle est seulement
    // engagée. Attendre dans la requête l'exposerait à une coupure du proxy.
    expect(res.status).toBe(202);
    expect(mockStartProcess).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      kind: "summary",
      transcript: "Rappeler le fournisseur.",
      userId: "user-1",
    });
    // L'état rendu dit qu'un traitement est en cours : le bloc sait quoi
    // afficher sans attendre la première interrogation périodique.
    const body = await res.json();
    expect(body.processingKind).toBe("summary");
  });

  it("refuse un second traitement tant que le premier tourne", async () => {
    queueAccess(
      noteRow({
        status: "validated",
        transcriptValidatedAt: new Date(),
        processingKind: "summary",
        processingStartedAt: new Date(),
      })
    );
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "cleanup" }),
      ctx
    );
    expect(res.status).toBe(409);
    expect(mockStartProcess).not.toHaveBeenCalled();
  });
});

describe("traitement IA abandonné", () => {
  /** Note laissée en traitement bien au delà du délai de garde. */
  const stalledProcessing = () =>
    noteRow({
      status: "validated",
      transcriptValidatedAt: new Date(),
      processingKind: "summary",
      processingStartedAt: new Date(Date.now() - PROCESS_STALL_MS - 60_000),
    });

  it("la lecture requalifie l'attente en échec récupérable", async () => {
    queueAccess(stalledProcessing());
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    // Le marqueur est effacé : sans cela le bloc sonderait indéfiniment et
    // aucun nouveau traitement ne pourrait être engagé.
    expect(body.processingKind).toBeNull();
    expect(body.errorCode).toBe("ai_stalled");
    // La note reste validée : c'est le traitement qui a échoué, pas la note.
    expect(body.status).toBe("validated");
  });

  it("un nouveau traitement redevient possible", async () => {
    queueAccess(stalledProcessing(), 2);
    const { POST } = await import("@/app/api/voice-notes/[id]/process/route");
    const res = await POST(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/process`, "POST", { kind: "summary" }),
      ctx
    );
    expect(res.status).toBe(202);
    expect(mockStartProcess).toHaveBeenCalled();
  });
});

describe("correction et validation du transcript", () => {
  it("refuse une correction après validation sans reprise explicite", async () => {
    queueAccess(noteRow({ status: "validated" }));
    const { PATCH } = await import("@/app/api/voice-notes/[id]/transcript/route");
    const res = await PATCH(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/transcript`, "PATCH", {
        transcript: "Version corrigée",
      }),
      ctx
    );
    expect(res.status).toBe(409);
  });

  it("une reprise explicite ramène la note en relecture", async () => {
    queueAccess(noteRow({ status: "validated" }));
    state.returningRows = [noteRow({ status: "review", transcript: "Version corrigée" })];
    const { PATCH } = await import("@/app/api/voice-notes/[id]/transcript/route");
    const res = await PATCH(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/transcript`, "PATCH", {
        transcript: "Version corrigée",
        reopen: true,
      }),
      ctx
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("review");
  });

  it("refuse un corps sans transcript", async () => {
    queueAccess(noteRow());
    const { PATCH } = await import("@/app/api/voice-notes/[id]/transcript/route");
    const res = await PATCH(
      jsonRequest(`/api/voice-notes/${NOTE_ID}/transcript`, "PATCH", { reopen: true }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("la validation efface l'audio et horodate", async () => {
    queueAccess(noteRow({ status: "review" }));
    state.returningRows = [
      noteRow({
        status: "validated",
        audioPath: null,
        transcriptValidatedAt: new Date("2026-08-17T11:00:00Z"),
      }),
    ];
    const { POST } = await import("@/app/api/voice-notes/[id]/validate/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/validate`, "POST"), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockDeleteAudio).toHaveBeenCalledWith("/tmp/loriax-voice-notes/note-1.webm");
    expect(body.hasAudio).toBe(false);
    expect(body.transcriptValidatedAt).not.toBeNull();
  });

  it("refuse de valider une note encore en transcription", async () => {
    // Transcription fraîche : elle n'est pas requalifiée en échec.
    queueAccess(
      noteRow({ status: "transcribing", transcript: null, updatedAt: new Date() })
    );
    const { POST } = await import("@/app/api/voice-notes/[id]/validate/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/validate`, "POST"), ctx);
    expect(res.status).toBe(409);
    expect(mockDeleteAudio).not.toHaveBeenCalled();
  });
});

describe("envoi de l'audio", () => {
  const audioRequest = (type: string, bytes = 2048) => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(bytes)], { type }), "note.mp3");
    return new NextRequest(`http://localhost/api/voice-notes/${NOTE_ID}/audio`, {
      method: "POST",
      body: form,
    }) as never;
  };

  it("refuse un fichier hors format malgré une extension audio", async () => {
    queueAccess(noteRow({ status: "recording", transcript: null }));
    const { POST } = await import("@/app/api/voice-notes/[id]/audio/route");
    const res = await POST(audioRequest("text/plain"), ctx);
    expect(res.status).toBe(415);
    expect(mockStartTranscription).not.toHaveBeenCalled();
  });

  it("refuse un fichier vide", async () => {
    queueAccess(noteRow({ status: "recording", transcript: null }));
    const { POST } = await import("@/app/api/voice-notes/[id]/audio/route");
    const res = await POST(audioRequest("audio/webm", 0), ctx);
    expect(res.status).toBe(400);
    expect(mockStartTranscription).not.toHaveBeenCalled();
  });

  it("refuse un audio sur une note validée", async () => {
    queueAccess(noteRow({ status: "validated", audioPath: null }));
    const { POST } = await import("@/app/api/voice-notes/[id]/audio/route");
    const res = await POST(audioRequest("audio/webm"), ctx);
    expect(res.status).toBe(409);
    expect(mockStartTranscription).not.toHaveBeenCalled();
  });

  it("accepte un audio valide et lance la transcription", async () => {
    queueAccess(noteRow({ status: "recording", transcript: null }), 2);
    state.returningRows = [noteRow({ status: "transcribing" })];
    const { POST } = await import("@/app/api/voice-notes/[id]/audio/route");
    const res = await POST(audioRequest("audio/webm;codecs=opus"), ctx);
    expect(res.status).toBe(202);
    expect(mockStartTranscription).toHaveBeenCalledWith(NOTE_ID, "recording");
  });
});

describe("relance de la transcription", () => {
  it("relance depuis un échec avec audio conservé", async () => {
    queueAccess(noteRow({ status: "failed", errorCode: "transcription_failed" }), 2);
    const { POST } = await import("@/app/api/voice-notes/[id]/retry/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/retry`, "POST"), ctx);
    expect(res.status).toBe(202);
    expect(mockStartTranscription).toHaveBeenCalledWith(NOTE_ID, "failed");
  });

  it("refuse la relance sans audio conservé", async () => {
    queueAccess(noteRow({ status: "failed", audioPath: null }));
    const { POST } = await import("@/app/api/voice-notes/[id]/retry/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/retry`, "POST"), ctx);
    expect(res.status).toBe(409);
    expect(mockStartTranscription).not.toHaveBeenCalled();
  });

  it("refuse la relance sur une note en relecture", async () => {
    queueAccess(noteRow({ status: "review" }));
    const { POST } = await import("@/app/api/voice-notes/[id]/retry/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/retry`, "POST"), ctx);
    expect(res.status).toBe(409);
    expect(mockStartTranscription).not.toHaveBeenCalled();
  });
});

describe("transcription abandonnée", () => {
  /** Note laissée en transcription bien au delà du délai de garde. */
  const stalled = (overrides: Record<string, unknown> = {}) =>
    noteRow({
      status: "transcribing",
      transcript: null,
      updatedAt: new Date(Date.now() - TRANSCRIPTION_STALL_MS - 60_000),
      ...overrides,
    });

  it("la lecture requalifie en échec récupérable, audio conservé", async () => {
    queueAccess(stalled());
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("failed");
    expect(body.errorCode).toBe("transcription_stalled");
    expect(body.hasAudio).toBe(true);
  });

  it("la relance redevient possible", async () => {
    queueAccess(stalled(), 2);
    const { POST } = await import("@/app/api/voice-notes/[id]/retry/route");
    const res = await POST(jsonRequest(`/api/voice-notes/${NOTE_ID}/retry`, "POST"), ctx);
    expect(res.status).toBe(202);
    expect(mockStartTranscription).toHaveBeenCalledWith(NOTE_ID, "failed");
  });

  it("un nouvel envoi d'audio redevient possible", async () => {
    queueAccess(stalled(), 2);
    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(2048)], { type: "audio/webm" }),
      "note.webm"
    );
    const request = new NextRequest(
      `http://localhost/api/voice-notes/${NOTE_ID}/audio`,
      { method: "POST", body: form }
    ) as never;
    const { POST } = await import("@/app/api/voice-notes/[id]/audio/route");
    const res = await POST(request, ctx);
    expect(res.status).toBe(202);
    expect(mockStartTranscription).toHaveBeenCalledWith(NOTE_ID, "failed");
  });

  it("une transcription récente reste en cours", async () => {
    queueAccess(
      noteRow({ status: "transcribing", transcript: null, updatedAt: new Date() })
    );
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect((await res.json()).status).toBe("transcribing");
  });
});

describe("disponibilité du moteur de transcription", () => {
  it("la lecture annonce l'absence de moteur, avant tout enregistrement", async () => {
    mockAvailable.mockResolvedValue(false);
    queueAccess(noteRow({ status: "recording", audioPath: null, transcript: null }));
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect((await res.json()).transcriptionAvailable).toBe(false);
  });

  it("la création porte la même information", async () => {
    mockAvailable.mockResolvedValue(false);
    state.selectQueue = [[docRow]];
    state.returningRows = [noteRow({ status: "recording", audioPath: null })];
    const { POST } = await import("@/app/api/voice-notes/route");
    const res = await POST(
      jsonRequest("/api/voice-notes", "POST", { documentId: DOC_ID })
    );
    expect(res.status).toBe(201);
    expect((await res.json()).transcriptionAvailable).toBe(false);
  });

  it("l'annonce est positive quand un moteur est configuré", async () => {
    queueAccess(noteRow());
    const { GET } = await import("@/app/api/voice-notes/[id]/route");
    const res = await GET(jsonRequest(`/api/voice-notes/${NOTE_ID}`, "GET"), ctx);
    expect((await res.json()).transcriptionAvailable).toBe(true);
  });
});

describe("création d'une note", () => {
  it("refuse la création dans un document sans droit d'écriture", async () => {
    mockEditAccess.mockResolvedValue(false);
    state.selectQueue = [[docRow]];
    const { POST } = await import("@/app/api/voice-notes/route");
    const res = await POST(
      jsonRequest("/api/voice-notes", "POST", { documentId: DOC_ID })
    );
    expect(res.status).toBe(403);
  });

  it("refuse un documentId qui n'est pas un UUID", async () => {
    const { POST } = await import("@/app/api/voice-notes/route");
    const res = await POST(
      jsonRequest("/api/voice-notes", "POST", { documentId: "pas-un-uuid" })
    );
    expect(res.status).toBe(400);
  });

  it("crée la note quand le document est accessible en écriture", async () => {
    state.selectQueue = [[docRow]];
    state.returningRows = [noteRow({ status: "recording", audioPath: null, transcript: null })];
    const { POST } = await import("@/app/api/voice-notes/route");
    const res = await POST(
      jsonRequest("/api/voice-notes", "POST", { documentId: DOC_ID })
    );
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("recording");
  });
});
