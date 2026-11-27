import { randomUUID } from "crypto";
import { and, asc, count, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organizationMembers,
  users,
  media,
  mediaUsages,
  mediaVersions,
  type Media,
  type MediaVersion,
} from "@/lib/db/schema";
import { copyFile, uploadFile } from "@/lib/storage/s3";
import { logActivity } from "@/lib/activity";
import logger from "@/lib/logger";
import type { SessionUser } from "@/types";
import { resolveMediaAccess } from "./access";
import { prepareMediaFile } from "./prepare-file";
import { checkUploadQuota, type QuotaVerdict } from "./quota";
import { lockOrgQuota } from "./reserve";
import { findOrphanVersionKeys, removeVersionObjects } from "./purge";
import { notifyQuotaThreshold } from "./notify";
import { enqueueMediaIndex } from "./ai/enqueue";

/** Nombre maximal de versions conservées par média (la courante comprise). */
export const MEDIA_VERSIONS_MAX = 20;

export type ReplaceInput = {
  user: SessionUser;
  orgId: string;
  mediaId: string;
  expectedVersion: number;
  comment?: string;
  file: { name: string; size: number; type: string };
  buffer: Buffer;
};

export type ReplaceResult =
  | { ok: true; media: Media; version: MediaVersion; quota: QuotaVerdict; usages: number }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 413 | 415 | 507 | 500;
      error: string;
      quota?: QuotaVerdict;
    };

type Fail = Extract<ReplaceResult, { ok: false }>;

const fail = (status: Fail["status"], error: string, quota?: QuotaVerdict): Fail => ({
  ok: false,
  status,
  error,
  ...(quota ? { quota } : {}),
});

/** Versions d'un média, de la plus récente à la plus ancienne. Filtrées par organisation. */
export async function listVersions(mediaId: string, orgId: string): Promise<MediaVersion[]> {
  return db
    .select(getTableColumns(mediaVersions))
    .from(mediaVersions)
    .innerJoin(media, eq(mediaVersions.mediaId, media.id))
    .where(and(eq(mediaVersions.mediaId, mediaId), eq(media.organizationId, orgId)))
    .orderBy(desc(mediaVersions.version));
}

/** Noms des auteurs de versions, restreints aux membres de l'organisation. */
export async function listVersionAuthors(
  orgId: string,
  versions: Pick<MediaVersion, "createdBy">[],
): Promise<Map<string, string>> {
  const ids = [...new Set(versions.map((v) => v.createdBy).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(and(eq(organizationMembers.organizationId, orgId), inArray(users.id, ids)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Remplace le fichier d'un média en conservant l'historique.
 *
 * Ordre : droits (404 muet hors organisation), pré-contrôles sans calcul,
 * préparation du fichier, envoi S3 sous des clés neuves (un échec n'écrit rien
 * en base), puis UNE transaction sous verrou d'organisation et `FOR UPDATE`
 * du média : le média n'est jamais décrit avant que ses objets existent, et
 * deux remplacements concurrents se départagent sur `expectedVersion`.
 * La rétention supprime la plus ancienne version non courante ; son objet S3
 * n'est retiré qu'après le commit.
 */
export async function replaceMediaFile(input: ReplaceInput): Promise<ReplaceResult> {
  const { user, orgId, mediaId, expectedVersion, file, buffer } = input;

  // 1. Droits : filtre d'organisation, refus de franchissement muet
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
    .limit(1);
  if (!row) return fail(404, "Média introuvable");
  const access = await resolveMediaAccess(user, row, "write", { orgId });
  if (!access.allowed) {
    return access.reason === "org" || access.reason === "trash"
      ? fail(404, "Média introuvable")
      : fail(403, "Accès refusé");
  }

  // 2. Pré-contrôles bon marché (refaits sous verrou)
  if (row.deletedAt) return fail(409, "Média en corbeille");
  if (row.currentVersion !== expectedVersion) return fail(409, "Version périmée");
  const precheck = await checkUploadQuota(orgId, file.size);
  if (!precheck.allowed) return fail(507, "Quota de stockage atteint", precheck);

  // 3. Préparation (validation, type, miniature, empreinte)
  // Même profil qu'à l'ingestion : vidéo et audio ont leurs propres limites et formats.
  const profile = row.kind === "video" || row.kind === "audio" ? "video" : "default";
  const prepared = await prepareMediaFile(file, buffer, profile);
  if (!prepared.ok) return fail(prepared.status, prepared.error);
  if (prepared.kind !== row.kind) return fail(415, "Le type du fichier ne peut pas changer");
  if (prepared.checksum === row.checksumSha256) {
    return fail(409, "Le fichier est identique à la version courante");
  }

  // 4. Envoi S3 sous des clés neuves : le contenu courant n'est jamais écrasé
  const key = `${row.spaceId ?? "org-" + orgId}/${randomUUID()}.${prepared.ext}`;
  let thumbnailKey: string | null = prepared.thumbnail ? `${key}.thumb.webp` : null;
  try {
    await uploadFile(key, buffer, prepared.mime);
  } catch {
    return fail(500, "Échec de l'envoi du fichier");
  }
  if (prepared.thumbnail && thumbnailKey) {
    try {
      await uploadFile(thumbnailKey, prepared.thumbnail, "image/webp");
    } catch {
      // La miniature est secondaire : la version reste utilisable sans.
      thumbnailKey = null;
    }
  }
  const newKeys = thumbnailKey ? [key, thumbnailKey] : [key];

  return commitNewVersion({
    user,
    orgId,
    mediaId,
    expectedVersion,
    newKeys,
    source: {
      storageKey: key,
      thumbnailKey,
      // Le nom affiché garde son radical, seule l'extension suit le nouveau type.
      filename: `${row.filename.replace(/\.[A-Za-z0-9]{1,8}$/, "")}.${prepared.ext}`.slice(0, 255),
      mimeType: prepared.mime,
      sizeBytes: file.size,
      checksumSha256: prepared.checksum,
      width: prepared.width,
      height: prepared.height,
      // Nombre de pages du nouveau fichier (null hors PDF lisible) : jamais celui de l'ancien.
      pageCount: prepared.pageCount,
    },
    comment: input.comment,
    rejectChecksum: prepared.checksum,
  });
}

type VersionSource = {
  storageKey: string;
  thumbnailKey: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  width: number | null;
  height: number | null;
  /** Présent seulement pour une restauration : recopié sur `media`. */
  pageCount?: number | null;
};

type CommitInput = {
  user: SessionUser;
  orgId: string;
  mediaId: string;
  expectedVersion: number;
  /** Objets S3 neufs, déjà écrits : retirés si rien n'est validé. */
  newKeys: string[];
  source: VersionSource;
  comment?: string;
  restoredFrom?: number;
  /** Empreinte refusée si elle égale celle de la version courante (remplacement). */
  rejectChecksum?: string;
};

/**
 * Transaction commune au remplacement et à la restauration : verrou
 * d'organisation, média FOR UPDATE, nouvelle version courante, rétention.
 * Les objets évincés ne sont retirés qu'après le commit.
 */
async function commitNewVersion(c: CommitInput): Promise<ReplaceResult> {
  const { user, orgId, mediaId, expectedVersion, newKeys, source } = c;
  type Committed =
    | { fail: Fail }
    | { media: Media; version: MediaVersion; quota: QuotaVerdict; orphanKeys: string[] };
  let committed: Committed;
  try {
    committed = await db.transaction(async (tx): Promise<Committed> => {
      await lockOrgQuota(tx, orgId);
      const [locked] = await tx
        .select()
        .from(media)
        .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
        .for("update");
      if (!locked) return { fail: fail(404, "Média introuvable") };
      if (locked.deletedAt) return { fail: fail(409, "Média en corbeille") };
      if (locked.currentVersion !== expectedVersion) return { fail: fail(409, "Version périmée") };
      if (c.rejectChecksum && locked.checksumSha256 === c.rejectChecksum) {
        return { fail: fail(409, "Le fichier est identique à la version courante") };
      }
      if (c.restoredFrom !== undefined) {
        // La version source peut avoir été supprimée depuis le pré-contrôle.
        const [still] = await tx
          .select({ id: mediaVersions.id })
          .from(mediaVersions)
          .where(and(eq(mediaVersions.mediaId, mediaId), eq(mediaVersions.version, c.restoredFrom)));
        if (!still) return { fail: fail(404, "Version introuvable") };
      }

      const quota = await checkUploadQuota(orgId, source.sizeBytes, tx);
      if (!quota.allowed) return { fail: fail(507, "Quota de stockage atteint", quota) };

      const next = locked.currentVersion + 1;
      const [version] = await tx
        .insert(mediaVersions)
        .values({
          mediaId,
          version: next,
          storageKey: source.storageKey,
          thumbnailKey: source.thumbnailKey,
          filename: source.filename,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          checksumSha256: source.checksumSha256,
          width: source.width,
          height: source.height,
          ...(source.pageCount !== undefined ? { pageCount: source.pageCount } : {}),
          createdBy: user.id,
          comment: c.comment?.trim() ? c.comment.trim().slice(0, 2000) : null,
          ...(c.restoredFrom !== undefined ? { restoredFrom: c.restoredFrom } : {}),
        })
        .returning();
      const [updated] = await tx
        .update(media)
        .set({
          storageKey: source.storageKey,
          thumbnailKey: source.thumbnailKey,
          filename: source.filename,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          checksumSha256: source.checksumSha256,
          width: source.width,
          height: source.height,
          ...(source.pageCount !== undefined ? { pageCount: source.pageCount } : {}),
          currentVersion: next,
          updatedAt: new Date(),
        })
        .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
        .returning();

      // Rétention : la plus ancienne version non courante part, son objet après commit
      const all = await tx
        .select({
          id: mediaVersions.id,
          version: mediaVersions.version,
          storageKey: mediaVersions.storageKey,
          thumbnailKey: mediaVersions.thumbnailKey,
        })
        .from(mediaVersions)
        .where(eq(mediaVersions.mediaId, mediaId))
        .orderBy(asc(mediaVersions.version));
      const victims = all
        .filter((v) => v.version !== next)
        .slice(0, Math.max(all.length - MEDIA_VERSIONS_MAX, 0));
      let orphanKeys: string[] = [];
      if (victims.length > 0) {
        await tx.delete(mediaVersions).where(
          inArray(
            mediaVersions.id,
            victims.map((v) => v.id),
          ),
        );
        orphanKeys = await findOrphanVersionKeys(
          tx,
          victims.flatMap((v) => [v.storageKey, v.thumbnailKey].filter((k): k is string => !!k)),
        );
      }
      return { media: updated, version, quota, orphanKeys };
    });
  } catch (err) {
    logger.warn({ err, mediaId }, "Nouvelle version de média : transaction en échec");
    // L'erreur a pu survenir après un commit effectif : ne retirer que des objets non référencés.
    let committedAnyway = false;
    try {
      const rows = await db
        .select({ storageKey: mediaVersions.storageKey })
        .from(mediaVersions)
        .where(eq(mediaVersions.mediaId, mediaId));
      committedAnyway = rows.some((r) => r.storageKey === source.storageKey);
    } catch {
      committedAnyway = true; // doute : conserver les objets plutôt que casser une version
    }
    if (!committedAnyway) await removeVersionObjects(newKeys, mediaId);
    return fail(500, "Échec de l'enregistrement de la version");
  }

  if ("fail" in committed) {
    // Objets neufs, jamais référencés : sans risque à retirer.
    await removeVersionObjects(newKeys, mediaId);
    return committed.fail;
  }

  // Après commit : objets de la version évincée, notifications, journal
  await removeVersionObjects(committed.orphanKeys, mediaId);
  // Texte et vecteurs de l'ancienne version périmés : remise en file (ne lève jamais).
  // Un travail en cours sur l'ancienne version n'écrit rien (contrôle de version à l'écriture).
  await enqueueMediaIndex(mediaId, c.restoredFrom !== undefined ? "restore" : "replace").catch(() => undefined);
  if (committed.quota.limitBytes && committed.quota.limitBytes > 0) {
    const before = (committed.quota.usedBytes / committed.quota.limitBytes) * 100;
    void notifyQuotaThreshold(orgId, before, committed.quota.percentAfter).catch(() => undefined);
  }
  await logActivity({
    userId: user.id,
    action: c.restoredFrom !== undefined ? "media.version_restored" : "media.version_created",
    entityType: "media",
    entityId: mediaId,
    metadata: {
      version: committed.version.version,
      ...(c.restoredFrom !== undefined ? { restoredFrom: c.restoredFrom } : {}),
      filename: committed.media.filename,
      sizeBytes: committed.media.sizeBytes,
    },
  });
  const [usage] = await db
    .select({ n: count() })
    .from(mediaUsages)
    .where(eq(mediaUsages.mediaId, mediaId));

  return {
    ok: true,
    media: committed.media,
    version: committed.version,
    quota: committed.quota,
    usages: Number(usage?.n ?? 0),
  };
}

export type RestoreInput = {
  user: SessionUser;
  orgId: string;
  mediaId: string;
  version: number;
  expectedVersion: number;
};

/** Droits d'écriture, organisation filtrée, 404 muet hors organisation. */
async function loadWritable(
  user: SessionUser,
  orgId: string,
  mediaId: string,
): Promise<{ ok: true; row: Media } | { ok: false; fail: Fail }> {
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
    .limit(1);
  if (!row) return { ok: false, fail: fail(404, "Média introuvable") };
  const access = await resolveMediaAccess(user, row, "write", { orgId });
  if (!access.allowed) {
    return {
      ok: false,
      fail:
        access.reason === "org" || access.reason === "trash"
          ? fail(404, "Média introuvable")
          : fail(403, "Accès refusé"),
    };
  }
  return { ok: true, row };
}

function extOf(key: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(key.replace(/\.thumb\.webp$/, ""));
  return m ? m[1] : "bin";
}

/**
 * Restaure une ancienne version : elle devient une NOUVELLE version courante
 * (numéro suivant, `restored_from`), ses objets sont copiés vers des clés
 * neuves pour que la suppression de l'une ne touche jamais l'autre.
 */
export async function restoreVersion(input: RestoreInput): Promise<ReplaceResult> {
  const { user, orgId, mediaId, expectedVersion } = input;
  const loaded = await loadWritable(user, orgId, mediaId);
  if (!loaded.ok) return loaded.fail;
  const row = loaded.row;
  if (row.deletedAt) return fail(409, "Média en corbeille");
  if (row.currentVersion !== expectedVersion) return fail(409, "Version périmée");

  const all = await db.select().from(mediaVersions).where(eq(mediaVersions.mediaId, mediaId));
  const target = all.find((v) => v.version === input.version);
  if (!target) return fail(404, "Version introuvable");
  if (target.version === row.currentVersion) return fail(409, "Cette version est déjà la version courante");

  const precheck = await checkUploadQuota(orgId, target.sizeBytes);
  if (!precheck.allowed) return fail(507, "Quota de stockage atteint", precheck);

  const key = `${row.spaceId ?? "org-" + orgId}/${randomUUID()}.${extOf(target.storageKey)}`;
  try {
    await copyFile(target.storageKey, key);
  } catch {
    return fail(500, "Échec de la copie du fichier");
  }
  let thumbnailKey: string | null = null;
  if (target.thumbnailKey) {
    const dst = `${key}.thumb.webp`;
    try {
      await copyFile(target.thumbnailKey, dst);
      thumbnailKey = dst;
    } catch {
      // La miniature est secondaire : la version reste utilisable sans.
    }
  }

  return commitNewVersion({
    user,
    orgId,
    mediaId,
    expectedVersion,
    newKeys: thumbnailKey ? [key, thumbnailKey] : [key],
    source: {
      storageKey: key,
      thumbnailKey,
      filename: target.filename,
      mimeType: target.mimeType,
      sizeBytes: target.sizeBytes,
      checksumSha256: target.checksumSha256,
      width: target.width,
      height: target.height,
      pageCount: target.pageCount,
    },
    restoredFrom: target.version,
  });
}

export type DeleteVersionInput = {
  user: SessionUser;
  orgId: string;
  mediaId: string;
  /** Id de la ligne de version (les numéros sont réutilisables après suppression de la courante). */
  versionId: string;
  /** Annuler : refuse (409) si la ligne n'est plus la version courante. */
  requireCurrent?: boolean;
};

export type DeleteVersionResult =
  | { ok: true; media: Media }
  | { ok: false; status: 403 | 404 | 409 | 500; error: string };

/**
 * Supprime une version. Si c'est la courante, la précédente redevient
 * courante et `media` reprend ses colonnes (Annuler d'une restauration ou
 * d'un remplacement). La dernière version restante ne peut pas être retirée.
 * Les objets S3 ne partent qu'après le commit et seulement si plus aucune
 * ligne ne les référence.
 */
export async function deleteVersion(input: DeleteVersionInput): Promise<DeleteVersionResult> {
  const { user, orgId, mediaId } = input;
  const loaded = await loadWritable(user, orgId, mediaId);
  if (!loaded.ok) return { ok: false, status: loaded.fail.status as 403 | 404, error: loaded.fail.error };

  type Done =
    | { fail: { status: 404 | 409; error: string } }
    | { media: Media; orphanKeys: string[]; removed: MediaVersion };
  let done: Done;
  try {
    done = await db.transaction(async (tx): Promise<Done> => {
      await lockOrgQuota(tx, orgId);
      const [locked] = await tx
        .select()
        .from(media)
        .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
        .for("update");
      if (!locked) return { fail: { status: 404, error: "Média introuvable" } };
      if (locked.deletedAt) return { fail: { status: 409, error: "Média en corbeille" } };

      const all = await tx
        .select()
        .from(mediaVersions)
        .where(eq(mediaVersions.mediaId, mediaId))
        .orderBy(asc(mediaVersions.version));
      const target = all.find((v) => v.id === input.versionId);
      if (!target) return { fail: { status: 409, error: "Version introuvable ou déjà supprimée" } };
      if (input.requireCurrent && target.version !== locked.currentVersion) {
        return { fail: { status: 409, error: "La version n'est plus la version courante" } };
      }
      if (all.length <= 1) {
        return { fail: { status: 409, error: "La dernière version ne peut pas être supprimée" } };
      }

      await tx
        .delete(mediaVersions)
        .where(and(eq(mediaVersions.mediaId, mediaId), eq(mediaVersions.id, target.id)));

      let current = locked;
      if (target.version === locked.currentVersion) {
        const prev = all.filter((v) => v.version !== target.version).pop()!;
        const [updated] = await tx
          .update(media)
          .set({
            storageKey: prev.storageKey,
            thumbnailKey: prev.thumbnailKey,
            filename: prev.filename,
            mimeType: prev.mimeType,
            sizeBytes: prev.sizeBytes,
            checksumSha256: prev.checksumSha256,
            width: prev.width,
            height: prev.height,
            pageCount: prev.pageCount,
            currentVersion: prev.version,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaId), eq(media.organizationId, orgId)))
          .returning();
        current = updated;
      }
      const orphanKeys = await findOrphanVersionKeys(
        tx,
        [target.storageKey, target.thumbnailKey].filter((k): k is string => !!k),
      );
      return { media: current, orphanKeys, removed: target };
    });
  } catch (err) {
    logger.warn({ err, mediaId }, "Suppression de version : transaction en échec");
    return { ok: false, status: 500, error: "Échec de la suppression de la version" };
  }

  if ("fail" in done) return { ok: false, ...done.fail };

  await removeVersionObjects(done.orphanKeys, mediaId);
  // La suppression de la courante fait revenir la précédente : l'index suit. `backfill` ne
  // réinitialise que si la version indexée diffère de la courante (sans effet sinon).
  await enqueueMediaIndex(mediaId, "backfill").catch(() => undefined);
  await logActivity({
    userId: user.id,
    action: "media.version_deleted",
    entityType: "media",
    entityId: mediaId,
    metadata: { version: done.removed.version, filename: done.removed.filename },
  });
  return { ok: true, media: done.media };
}
