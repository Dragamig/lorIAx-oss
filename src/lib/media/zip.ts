import archiver from "archiver";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Readable } from "node:stream";
import { db } from "@/lib/db";
import { media, mediaFolders } from "@/lib/db/schema";
import { resolveMediaAccess } from "@/lib/media/access";
import { getFileStream } from "@/lib/storage/s3";
import type { SessionUser } from "@/types";

import { ZIP_MAX_BYTES, ZIP_MAX_FILES } from "@/lib/media/zip-limits";

export { ZIP_MAX_BYTES, ZIP_MAX_FILES };
/** Bornes de lecture d'un dossier : au-delà, 413 sans examiner les droits un à un. */
const FOLDER_SCAN_MAX = 5000;
const CHUNK = 50;
const NAME_MAX = 200;
const NOT_INCLUDED = "_non-inclus.txt";

export type ZipEntry = { mediaId: string; storageKey: string; path: string; sizeBytes: number };
export type ZipPlan = { entries: ZipEntry[]; skipped: number; totalBytes: number };
export type ZipPlanResult =
  | ({ ok: true } & ZipPlan)
  | { ok: false; status: 404 | 413; error: string };

const NOT_FOUND = { ok: false, status: 404, error: "Aucun fichier lisible" } as const;
const TOO_BIG = {
  ok: false,
  status: 413,
  error: "Archive trop volumineuse (500 fichiers et 2 Go au plus)",
} as const;

/** Un segment de chemin sûr : ni séparateur, ni NUL, ni contrôle, ni `..`, 200 caractères au plus. */
export function sanitizeZipName(raw: string): string {
  let n = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.{2,}/g, "_")
    .trim()
    .replace(/^\.+/, "");
  if (n === "" || n === "." || /^_+$/.test(n)) n = "fichier";
  if (n.length > NAME_MAX) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : "";
    n = n.slice(0, NAME_MAX - ext.length) + ext;
  }
  return n;
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `${stem} (${n})${ext}`;
}

type Row = {
  id: string;
  organizationId: string;
  spaceId: string | null;
  uploadedBy: string;
  deletedAt: Date | null;
  origin: "upload" | "stock" | "automation" | "studio";
  mimeType: string;
  folderId: string | null;
  filename: string;
  storageKey: string;
  sizeBytes: number;
};

const COLUMNS = {
  id: media.id,
  organizationId: media.organizationId,
  spaceId: media.spaceId,
  uploadedBy: media.uploadedBy,
  deletedAt: media.deletedAt,
  origin: media.origin,
  mimeType: media.mimeType,
  folderId: media.folderId,
  filename: media.filename,
  storageKey: media.storageKey,
  sizeBytes: media.sizeBytes,
};

export async function planZip(
  user: SessionUser,
  orgId: string,
  source: { ids: string[] } | { folderId: string },
): Promise<ZipPlanResult> {
  let rows: Row[];
  let requested = 0;
  let folderPath: (folderId: string | null) => string[] = () => [];

  if ("ids" in source) {
    const ids = [...new Set(source.ids)];
    if (ids.length === 0) return NOT_FOUND;
    if (ids.length > ZIP_MAX_FILES) return TOO_BIG;
    requested = ids.length;
    rows = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = await db
        .select(COLUMNS)
        .from(media)
        .where(and(inArray(media.id, ids.slice(i, i + CHUNK)), eq(media.organizationId, orgId)));
      rows.push(...(part as Row[]));
    }
  } else {
    const folders = await db
      .select({ id: mediaFolders.id, parentId: mediaFolders.parentId, name: mediaFolders.name })
      .from(mediaFolders)
      .where(eq(mediaFolders.organizationId, orgId));
    const byId = new Map(folders.map((f) => [f.id, f]));
    const root = byId.get(source.folderId);
    if (!root) return NOT_FOUND;
    const inTree = new Set<string>([root.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && inTree.has(f.parentId) && !inTree.has(f.id)) {
          inTree.add(f.id);
          grew = true;
        }
      }
    }
    folderPath = (folderId) => {
      const parts: string[] = [];
      for (let cur = folderId; cur; cur = byId.get(cur)?.parentId ?? null) {
        const f = byId.get(cur);
        if (!f) break;
        parts.unshift(sanitizeZipName(f.name));
        if (cur === root.id) break;
      }
      return parts;
    };
    const found = await db
      .select(COLUMNS)
      .from(media)
      .where(
        and(
          inArray(media.folderId, [...inTree]),
          eq(media.organizationId, orgId),
          isNull(media.deletedAt),
        ),
      )
      .limit(FOLDER_SCAN_MAX + 1);
    if (found.length > FOLDER_SCAN_MAX) return TOO_BIG;
    rows = found as Row[];
  }

  // Lecture autorisée média par média ; une ligne étrangère, en corbeille ou refusée est omise.
  // Arrêt dès qu'un plafond est franchi : inutile de résoudre les droits du reste.
  const readable: Row[] = [];
  let totalBytes = 0;
  for (const r of rows) {
    if (r.organizationId !== orgId || r.deletedAt) continue;
    const access = await resolveMediaAccess(user, r, "read", { orgId });
    if (!access.allowed) continue;
    readable.push(r);
    totalBytes += Number(r.sizeBytes);
    if (readable.length > ZIP_MAX_FILES || totalBytes > ZIP_MAX_BYTES) return TOO_BIG;
  }
  if (readable.length === 0) return NOT_FOUND;
  // Mode dossier : un média refusé ou en corbeille n'est jamais compté (révélerait son existence).
  const skipped = "ids" in source ? Math.max(0, requested - readable.length) : 0;

  const used = new Set<string>();
  if (skipped > 0) used.add(NOT_INCLUDED.toLowerCase());
  const entries: ZipEntry[] = readable.map((r) => {
    const dir = folderPath(r.folderId);
    const base = sanitizeZipName(r.filename);
    let name = base;
    for (let n = 2; used.has([...dir, name].join("/").toLowerCase()); n++) {
      name = withSuffix(base, n);
    }
    const path = [...dir, name].join("/");
    used.add(path.toLowerCase());
    return { mediaId: r.id, storageKey: r.storageKey, path, sizeBytes: Number(r.sizeBytes) };
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, entries, skipped, totalBytes };
}

/**
 * Archive zip en flux (sans compression : les médias le sont déjà). Un objet S3 à la fois,
 * jamais de fichier entier en mémoire. `signal` abandonné : flux S3 courant et archive détruits.
 */
export function streamZip(plan: ZipPlan, signal: AbortSignal): Readable {
  const archive = archiver("zip", { store: true });
  let current: Readable | null = null;

  const stop = () => {
    current?.destroy();
    archive.destroy();
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });

  void (async () => {
    let missing = 0;
    try {
      for (const entry of plan.entries) {
        if (signal.aborted) return;
        let src: Readable;
        try {
          src = await getFileStream(entry.storageKey);
        } catch {
          missing++;
          continue;
        }
        if (signal.aborted) {
          src.destroy();
          return;
        }
        current = src;
        const ok = await new Promise<boolean>((resolve) => {
          const done = (v: boolean) => {
            archive.off("entry", onEntry);
            archive.off("error", onError);
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          };
          const onEntry = (e: { name: string }) => e.name === entry.path && done(true);
          const onError = () => done(false);
          const onAbort = () => done(false);
          archive.on("entry", onEntry);
          archive.on("error", onError);
          signal.addEventListener("abort", onAbort, { once: true });
          src.once("error", (err) => {
            // Une source qui casse en cours de route ne doit pas produire une archive « complète ».
            archive.destroy(err);
            done(false);
          });
          archive.append(src, { name: entry.path });
        });
        current = null;
        if (!ok) return;
      }
      const skipped = plan.skipped + missing;
      if (skipped > 0) {
        archive.append(
          Buffer.from(
            `${skipped} fichier(s) non inclus : droits insuffisants, supprimés ou introuvables.\n`,
            "utf8",
          ),
          { name: NOT_INCLUDED },
        );
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return archive;
}
