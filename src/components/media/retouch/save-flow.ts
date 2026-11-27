import type { ExportFormat } from "./render";

export type SaveMode = "derived" | "version";

export type SaveOutcome =
  | { kind: "created"; mediaId: string; undo(): Promise<void> }
  | { kind: "versioned"; undo(): Promise<void> }
  | { kind: "duplicate"; mediaId: string }
  | { kind: "error"; status: number; message: string; quotaFull?: boolean };

export interface SaveOptions {
  sourceId: string;
  mode: SaveMode;
  name: string;
  spaceId: string | null;
  folderId: string | null;
  format: ExportFormat;
  /** Qualité 60 à 100 (jpeg et webp). */
  quality: number;
  /** Version de l'original connue de l'interface (obligatoire en mode version). */
  expectedVersion?: number;
  comment?: string;
  /** Rendu du fichier : `exportRecipeBlob` via le canevas, jamais `fetch(dataUrl)`. */
  getBlob: (format: ExportFormat, quality: number) => Promise<Blob>;
  /** Identifiant de l'utilisateur courant : l'annulation d'un dérivé lui est réservée. */
  userId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Délai pendant lequel « Annuler » reste possible après la création. */
export const UNDO_WINDOW_MS = 10_000;

export const EXTENSIONS: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };
const MIME: Record<ExportFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

/** Nom de fichier : le radical saisi, l'extension suit le format choisi. */
export function fileNameFor(name: string, format: ExportFormat): string {
  const stem = name.trim().replace(/\.(png|jpe?g|webp|gif)$/i, "") || "retouche";
  return `${stem}.${EXTENSIONS[format]}`;
}

export type SaveErrorKey =
  | "errAuth"
  | "errForbidden"
  | "errNotFound"
  | "errConflict"
  | "errTooLarge"
  | "errType"
  | "errRate"
  | "errQuota"
  | "errOffline"
  | "errExport"
  | "errGeneric";

/** Clé de message localisé (`library.retouch.save.<clé>`) pour chaque code de la route. */
export function saveErrorKey(status: number): SaveErrorKey {
  switch (status) {
    case 0:
      return "errOffline";
    case -1:
      return "errExport";
    case 401:
      return "errAuth";
    case 403:
      return "errForbidden";
    case 404:
      return "errNotFound";
    case 409:
      return "errConflict";
    case 413:
      return "errTooLarge";
    case 415:
      return "errType";
    case 429:
      return "errRate";
    case 507:
      return "errQuota";
    default:
      return "errGeneric";
  }
}

type MediaDto = { id: string; currentVersion?: number; uploadedBy?: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "";
}

/**
 * Exporte la recette puis l'envoie à `POST /api/media/<id>/retouch`. Ne lève jamais : toute
 * erreur devient `{ kind: "error" }`, la recette de l'appelant n'est donc jamais perdue.
 */
export async function saveRetouched(opts: SaveOptions): Promise<SaveOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  let blob: Blob;
  try {
    blob = await opts.getBlob(opts.format, opts.quality / 100);
  } catch {
    return { kind: "error", status: -1, message: "" };
  }

  // Le navigateur peut avoir encodé autre chose que demandé (Safari rend du PNG pour le WebP).
  const actual = (Object.keys(MIME) as ExportFormat[]).find((k) => MIME[k] === blob.type) ?? opts.format;
  const fileName = fileNameFor(opts.name, actual);
  const form = new FormData();
  form.append("file", new File([blob], fileName, { type: MIME[actual] }));
  form.append("name", fileName);
  form.append("mode", opts.mode);
  if (opts.spaceId) form.append("spaceId", opts.spaceId);
  if (opts.folderId) form.append("folderId", opts.folderId);
  if (opts.mode === "version" && opts.expectedVersion !== undefined) form.append("expectedVersion", String(opts.expectedVersion));
  if (opts.comment?.trim()) form.append("comment", opts.comment.trim());

  let res: Response;
  try {
    res = await f(`/api/media/${opts.sourceId}/retouch`, { method: "POST", body: form });
  } catch {
    return { kind: "error", status: 0, message: "" };
  }
  if (!res.ok) {
    return { kind: "error", status: res.status, message: await readError(res), quotaFull: res.status === 507 };
  }
  const body = (await res.json().catch(() => null)) as { media?: MediaDto; duplicate?: boolean; versionId?: string } | null;
  const media = body?.media;
  if (!media) return { kind: "error", status: 500, message: "" };
  if (body?.duplicate) return { kind: "duplicate", mediaId: media.id };

  const createdAt = now();
  const expired = () => now() - createdAt > UNDO_WINDOW_MS;

  if (opts.mode === "version") {
    const mediaId = media.id;
    const versionId = body?.versionId;
    return {
      kind: "versioned",
      async undo() {
        if (expired()) throw new Error("expired");
        // Id de ligne renvoyé par la route : jamais retrouvé par liste, donc jamais la version d'un autre.
        if (!versionId) throw new Error("undo-failed");
        const del = await f(`/api/media/${mediaId}/versions/${versionId}?requireCurrent=1`, { method: "DELETE" });
        if (!del.ok) throw new Error("undo-failed");
      },
    };
  }

  const mediaId = media.id;
  return {
    kind: "created",
    mediaId,
    async undo() {
      if (expired()) throw new Error("expired");
      if (opts.userId && media.uploadedBy && media.uploadedBy !== opts.userId) throw new Error("not-author");
      const del = await f("/api/media/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Un seul id : exactement le média créé par cet enregistrement.
        body: JSON.stringify({ action: "trash", ids: [mediaId] }),
      });
      if (!del.ok) throw new Error("undo-failed");
      const out = (await del.json().catch(() => ({}))) as { results?: { id: string; ok: boolean }[] };
      if (out.results && !out.results.every((r) => r.ok)) throw new Error("undo-failed");
    },
  };
}
