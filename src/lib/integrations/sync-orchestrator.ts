import { db } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import {
  externalDatabaseMappings,
  externalRowTracking,
  syncLogs,
  userDatabaseColumns,
  userDatabaseRows,
  userDatabases,
  attachments,
} from "@/lib/db/schema";
import type { ExternalProvider, ExternalRow, ColumnMapping, SyncResult } from "./base";
import { contentHash } from "./base";
import { airtableProvider } from "./airtable/client";
import { notionProvider } from "./notion/client";
import { decrypt } from "@/lib/crypto";
import { uploadFile } from "@/lib/storage/s3";
import { resolveDownloadedStorageType } from "@/lib/storage/safe-content-type";
import { safeFetch } from "@/lib/security/safe-fetch";
import logger from "@/lib/logger";
import { randomUUID } from "crypto";

/**
 * ARCH-08 — Déchiffre les credentials stockés en BDD.
 * Si ENCRYPTION_KEY n'est pas configurée, retourne la valeur brute
 * (rétrocompatibilité avec les credentials non chiffrés).
 */
function decryptCredentials(credentialsEnc: string): string {
  if (!process.env.ENCRYPTION_KEY) return credentialsEnc;
  try {
    return decrypt(credentialsEnc);
  } catch {
    // Credentials probablement stockés en clair (avant migration)
    return credentialsEnc;
  }
}

/**
 * Résumé des incidents non bloquants d'une synchronisation, ou `null` s'il n'y en a
 * pas. Retourné tel quel dans `syncLogs.errorMessage` et `syncError`, colonnes que
 * l'interface affiche : un abandon silencieux ferait disparaître une pièce jointe
 * derrière un statut « OK ».
 */
function summarizeErrors(errors: string[]): string | null {
  if (errors.length === 0) return null;

  const shown = errors.slice(0, 5).join(" ; ");
  const rest = errors.length - 5;
  return rest > 0 ? `${shown} ; et ${rest} autre(s)` : shown;
}

function getProvider(name: string): ExternalProvider {
  if (name === "airtable") return airtableProvider;
  if (name === "notion") return notionProvider;
  throw new Error(`Provider inconnu : ${name}`);
}

// ─── Pull : externe → LorIAx ────────────────────────────────────────────────

export async function syncPull(mappingId: string): Promise<SyncResult> {
  const [mapping] = await db
    .select()
    .from(externalDatabaseMappings)
    .where(eq(externalDatabaseMappings.id, mappingId))
    .limit(1);

  if (!mapping) throw new Error("Mapping introuvable");
  if (!mapping.credentialsEnc) throw new Error("Identifiants manquants");

  // Marquer comme en cours
  await db
    .update(externalDatabaseMappings)
    .set({ isSyncing: true, syncError: null })
    .where(eq(externalDatabaseMappings.id, mappingId));

  const [log] = await db
    .insert(syncLogs)
    .values({ mappingId, direction: "pull", status: "in_progress" })
    .returning();

  const result: SyncResult = { rowsCreated: 0, rowsUpdated: 0, rowsDeleted: 0, errors: [] };

  try {
    const provider = getProvider(mapping.provider);
    const credentials = decryptCredentials(mapping.credentialsEnc);
    const columnMap = (mapping.columnMapping as ColumnMapping[]) || [];

    // Récupérer les colonnes LorIAx
    const loriaxCols = await db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, mapping.userDatabaseId));

    // Récupérer les données externes
    const externalRows = await provider.fetchRows(mapping.externalId, credentials);

    // Récupérer le tracking existant
    const existingTracking = await db
      .select()
      .from(externalRowTracking)
      .where(eq(externalRowTracking.mappingId, mappingId));

    const trackingByExternalId = new Map(
      existingTracking.map((t) => [t.externalRowId, t])
    );

    // Index des colonnes LorIAx par id (utilisé pour le re-upload attachment)
    const loriaxColsById = new Map(loriaxCols.map((c) => [c.id, c]));

    // Espace et propriétaire de la base cible : nécessaires pour enregistrer les
    // fichiers re-uploadés dans la table `attachments` (contrôle d'accès H8).
    // L'ancien appel passait l'id de la base comme spaceId, ce qui ne correspondait
    // à aucun espace réel.
    const [targetDatabase] = await db
      .select({ spaceId: userDatabases.spaceId, createdBy: userDatabases.createdBy })
      .from(userDatabases)
      .where(eq(userDatabases.id, mapping.userDatabaseId))
      .limit(1);

    if (!targetDatabase) throw new Error("Base de données cible introuvable");

    // Traiter chaque ligne externe
    for (const extRow of externalRows) {
      try {
        const cells = mapExternalToLoriax(extRow, columnMap, loriaxCols);

        // Re-upload des fichiers attachment (sync pull)
        for (const colMapping of columnMap) {
          if (colMapping.direction === "push-only") continue;
          const col = loriaxColsById.get(colMapping.loriaxColumnId);
          if (!col || col.type !== "attachment") continue;
          const rawFiles = cells[colMapping.loriaxColumnId];
          if (!Array.isArray(rawFiles) || rawFiles.length === 0) continue;
          cells[colMapping.loriaxColumnId] = await downloadAndReupload(
            rawFiles as { url: string; filename: string }[],
            targetDatabase.spaceId,
            targetDatabase.createdBy,
            result.errors
          );
        }

        const hash = contentHash(cells);
        const existing = trackingByExternalId.get(extRow.externalId);

        if (!existing) {
          // Nouvelle ligne → créer
          const [newRow] = await db
            .insert(userDatabaseRows)
            .values({
              databaseId: mapping.userDatabaseId,
              cells,
              position: 0,
            })
            .returning();

          await db.insert(externalRowTracking).values({
            mappingId,
            loriaxRowId: newRow.id,
            externalRowId: extRow.externalId,
            contentHash: hash,
            lastExternalChangeAt: extRow.lastModified ? new Date(extRow.lastModified) : new Date(),
          });

          result.rowsCreated++;
        } else if (existing.contentHash !== hash) {
          // Ligne modifiée → mettre à jour
          await db
            .update(userDatabaseRows)
            .set({ cells, updatedAt: new Date() })
            .where(eq(userDatabaseRows.id, existing.loriaxRowId));

          await db
            .update(externalRowTracking)
            .set({
              contentHash: hash,
              lastExternalChangeAt: extRow.lastModified ? new Date(extRow.lastModified) : new Date(),
              updatedAt: new Date(),
            })
            .where(eq(externalRowTracking.id, existing.id));

          result.rowsUpdated++;
        }

        trackingByExternalId.delete(extRow.externalId);
      } catch (err) {
        result.errors.push(`Ligne ${extRow.externalId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Lignes supprimées en externe → supprimer en local
    for (const [, orphan] of trackingByExternalId) {
      await db
        .delete(userDatabaseRows)
        .where(eq(userDatabaseRows.id, orphan.loriaxRowId));
      await db
        .delete(externalRowTracking)
        .where(eq(externalRowTracking.id, orphan.id));
      result.rowsDeleted++;
    }

    // Fin de parcours. Un fichier abandonné en cours de route écrase la cellule de
    // sa ligne : la synchronisation ne peut pas se déclarer en succès sans le dire,
    // sinon la pièce jointe disparaît et le journal affiche « OK ».
    const partialMessage = summarizeErrors(result.errors);

    await db
      .update(syncLogs)
      .set({
        status: partialMessage ? "partial" : "success",
        errorMessage: partialMessage,
        rowsCreated: result.rowsCreated,
        rowsUpdated: result.rowsUpdated,
        rowsDeleted: result.rowsDeleted,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, log.id));

    await db
      .update(externalDatabaseMappings)
      .set({
        isSyncing: false,
        lastSyncAt: new Date(),
        lastSyncDirection: "pull",
        syncError: partialMessage,
        updatedAt: new Date(),
      })
      .where(eq(externalDatabaseMappings.id, mappingId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);

    await db
      .update(syncLogs)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(syncLogs.id, log.id));

    await db
      .update(externalDatabaseMappings)
      .set({ isSyncing: false, syncError: message, updatedAt: new Date() })
      .where(eq(externalDatabaseMappings.id, mappingId));
  }

  return result;
}

// ─── Push : LorIAx → externe ────────────────────────────────────────────────

export async function syncPush(mappingId: string): Promise<SyncResult> {
  const [mapping] = await db
    .select()
    .from(externalDatabaseMappings)
    .where(eq(externalDatabaseMappings.id, mappingId))
    .limit(1);

  if (!mapping) throw new Error("Mapping introuvable");
  if (!mapping.credentialsEnc) throw new Error("Identifiants manquants");

  await db
    .update(externalDatabaseMappings)
    .set({ isSyncing: true, syncError: null })
    .where(eq(externalDatabaseMappings.id, mappingId));

  const [log] = await db
    .insert(syncLogs)
    .values({ mappingId, direction: "push", status: "in_progress" })
    .returning();

  const result: SyncResult = { rowsCreated: 0, rowsUpdated: 0, rowsDeleted: 0, errors: [] };

  try {
    const provider = getProvider(mapping.provider);
    const credentials = decryptCredentials(mapping.credentialsEnc);
    const columnMap = (mapping.columnMapping as ColumnMapping[]) || [];

    // Colonnes LorIAx
    const loriaxCols = await db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, mapping.userDatabaseId));

    // Toutes les lignes LorIAx
    const loriaxRows = await db
      .select()
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, mapping.userDatabaseId));

    // Tracking existant
    const existingTracking = await db
      .select()
      .from(externalRowTracking)
      .where(eq(externalRowTracking.mappingId, mappingId));

    const trackingByLoriaxId = new Map(
      existingTracking.map((t) => [t.loriaxRowId, t])
    );

    // Schéma externe pour le mapping inverse
    const externalSchema = await provider.fetchSchema(mapping.externalId, credentials);
    const externalTypeMap = new Map(externalSchema.map((c) => [c.externalId, c.type]));

    // Lignes à créer
    const toCreate: { loriaxRowId: string; cells: Record<string, unknown> }[] = [];
    // Lignes à mettre à jour
    const toUpdate: { externalRowId: string; cells: Record<string, unknown>; loriaxRowId: string }[] = [];

    for (const row of loriaxRows) {
      const cells = mapLoriaxToExternal(row.cells as Record<string, unknown>, columnMap, loriaxCols, externalTypeMap);
      const hash = contentHash(cells);
      const tracking = trackingByLoriaxId.get(row.id);

      if (!tracking) {
        toCreate.push({ loriaxRowId: row.id, cells });
      } else if (tracking.contentHash !== hash) {
        toUpdate.push({
          externalRowId: tracking.externalRowId,
          cells,
          loriaxRowId: row.id,
        });
      }
      trackingByLoriaxId.delete(row.id);
    }

    // Créer les nouvelles lignes
    if (toCreate.length > 0) {
      const created = await provider.createRows(
        mapping.externalId,
        credentials,
        toCreate.map((r) => ({ cells: r.cells }))
      );

      for (let i = 0; i < created.length; i++) {
        await db.insert(externalRowTracking).values({
          mappingId,
          loriaxRowId: toCreate[i].loriaxRowId,
          externalRowId: created[i].externalId,
          contentHash: contentHash(toCreate[i].cells),
        });
        result.rowsCreated++;
      }
    }

    // Mettre à jour les lignes modifiées
    if (toUpdate.length > 0) {
      await provider.updateRows(
        mapping.externalId,
        credentials,
        toUpdate.map((r) => ({ externalRowId: r.externalRowId, cells: r.cells }))
      );

      for (const row of toUpdate) {
        await db
          .update(externalRowTracking)
          .set({ contentHash: contentHash(row.cells), updatedAt: new Date() })
          .where(
            and(
              eq(externalRowTracking.mappingId, mappingId),
              eq(externalRowTracking.loriaxRowId, row.loriaxRowId)
            )
          );
        result.rowsUpdated++;
      }
    }

    // Lignes supprimées localement → supprimer en externe
    const orphanIds = [...trackingByLoriaxId.values()];
    if (orphanIds.length > 0) {
      await provider.deleteRows(
        mapping.externalId,
        credentials,
        orphanIds.map((t) => t.externalRowId)
      );
      for (const orphan of orphanIds) {
        await db
          .delete(externalRowTracking)
          .where(eq(externalRowTracking.id, orphan.id));
        result.rowsDeleted++;
      }
    }

    // Fin de parcours, même règle que le pull : les incidents non bloquants sont
    // persistés plutôt que balayés par un statut « success ».
    const partialMessage = summarizeErrors(result.errors);

    await db
      .update(syncLogs)
      .set({
        status: partialMessage ? "partial" : "success",
        errorMessage: partialMessage,
        rowsCreated: result.rowsCreated,
        rowsUpdated: result.rowsUpdated,
        rowsDeleted: result.rowsDeleted,
        completedAt: new Date(),
      })
      .where(eq(syncLogs.id, log.id));

    await db
      .update(externalDatabaseMappings)
      .set({
        isSyncing: false,
        lastSyncAt: new Date(),
        lastSyncDirection: "push",
        syncError: partialMessage,
        updatedAt: new Date(),
      })
      .where(eq(externalDatabaseMappings.id, mappingId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);

    await db
      .update(syncLogs)
      .set({ status: "error", errorMessage: message, completedAt: new Date() })
      .where(eq(syncLogs.id, log.id));

    await db
      .update(externalDatabaseMappings)
      .set({ isSyncing: false, syncError: message, updatedAt: new Date() })
      .where(eq(externalDatabaseMappings.id, mappingId));
  }

  return result;
}

// ─── Bidirectionnel ──────────────────────────────────────────────────────────

export async function syncBidirectional(mappingId: string): Promise<SyncResult> {
  const pullResult = await syncPull(mappingId);
  const pushResult = await syncPush(mappingId);

  const merged: SyncResult = {
    rowsCreated: pullResult.rowsCreated + pushResult.rowsCreated,
    rowsUpdated: pullResult.rowsUpdated + pushResult.rowsUpdated,
    rowsDeleted: pullResult.rowsDeleted + pushResult.rowsDeleted,
    errors: [...pullResult.errors, ...pushResult.errors],
  };

  // Le push s'ouvre en remettant `syncError` a null et le referme avec le resume de
  // ses seules erreurs : si seul le pull a abandonne un fichier, la colonne finissait
  // vide et la pastille ne s'allumait pas. Le cumul des deux sens est donc reecrit
  // ici, apres coup. Les deux journaux gardent chacun leur propre statut.
  await db
    .update(externalDatabaseMappings)
    .set({ syncError: summarizeErrors(merged.errors), updatedAt: new Date() })
    .where(eq(externalDatabaseMappings.id, mappingId));

  return merged;
}

// ─── Récupérer le schéma externe ─────────────────────────────────────────────

export async function fetchExternalSchema(provider: string, externalId: string, credentialsEnc: string) {
  return getProvider(provider).fetchSchema(externalId, decryptCredentials(credentialsEnc));
}

// ─── Helpers de mapping ──────────────────────────────────────────────────────

interface LoriaxCol {
  id: string;
  name: string;
  type: string;
}

function mapExternalToLoriax(
  extRow: ExternalRow,
  columnMap: ColumnMapping[],
  loriaxCols: LoriaxCol[]
): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  const colById = new Map(loriaxCols.map((c) => [c.id, c]));

  for (const mapping of columnMap) {
    if (mapping.direction === "push-only") continue;
    const col = colById.get(mapping.loriaxColumnId);
    if (!col) continue;

    const value = extRow.cells[mapping.externalColumnId];
    cells[col.id] = coerceValue(value, col.type);
  }

  return cells;
}

function mapLoriaxToExternal(
  cells: Record<string, unknown>,
  columnMap: ColumnMapping[],
  loriaxCols: LoriaxCol[],
  _externalTypeMap: Map<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const colById = new Map(loriaxCols.map((c) => [c.id, c]));

  for (const mapping of columnMap) {
    if (mapping.direction === "pull-only") continue;
    const col = colById.get(mapping.loriaxColumnId);
    if (!col) continue;

    result[mapping.externalColumnId] = cells[col.id];
  }

  return result;
}

/**
 * Télécharge des fichiers externes et les re-uploade vers Garage S3.
 *
 * H8 : Chaque objet stocké est également enregistré dans la table `attachments` :
 * c'est elle qui porte désormais le contrôle d'accès des routes de lecture, une clé
 * absente de la table n'est plus servie.
 *
 * Le tableau retourné ÉCRASE la cellule de la ligne synchronisée : un fichier qui
 * n'y figure pas disparaît de l'interface. Tout abandon doit donc remonter dans
 * `errors`, sans quoi la synchronisation se déclare en succès en ayant vidé une
 * cellule.
 */
async function downloadAndReupload(
  files: { url: string; filename: string; expiry?: string }[],
  spaceId: string,
  uploadedBy: string,
  errors: string[]
): Promise<{ key: string; filename: string; mimeType: string; size: number }[]> {
  const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo
  const results: { key: string; filename: string; mimeType: string; size: number }[] = [];

  for (const file of files) {
    try {
      // L'URL vient de la base externe : pour une propriété Notion "files" de
      // type "external", elle est saisie librement par l'utilisateur. Le corps
      // récupéré finit sur S3 puis rattaché à une ligne LorIAx, donc restitué :
      // c'est une lecture arbitraire du réseau, pas un SSRF aveugle. Aucune
      // dérogation réseau privé, et le plafond de taille est appliqué pendant
      // le transfert et non après coup.
      const res = await safeFetch(file.url, {
        timeoutMs: 30000,
        maxBytes: MAX_SIZE,
      });
      if (!res.ok) {
        errors.push(
          `Fichier « ${file.filename} » non récupéré (réponse ${res.status} de la source)`
        );
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // H9 : le `Content-Type` renvoye par le serveur distant n'est pas une source
      // de verite. L'URL etant saisie librement dans la base externe, un serveur
      // controle par l'attaquant annoncerait `image/svg+xml` ou `text/html`, et
      // l'objet serait ensuite distribue par URL presignee sur l'origine de
      // stockage, donc rendu en ligne.
      //
      // La decision part des OCTETS et non du nom : pour une propriete Notion
      // `files` en mode external, `filename` vaut `f.name`, un libelle libre
      // souvent depourvu d'extension. Un contenu non typable est stocke inerte
      // plutot que refuse : refuser reviendrait a vider la cellule de la ligne
      // synchronisee, la neutralisation suffit a fermer le vecteur.
      const { ext, contentType, contentDisposition, neutralizedReason } =
        await resolveDownloadedStorageType(file.filename, buffer);

      if (neutralizedReason) {
        const motif =
          neutralizedReason === "active"
            ? "format exécutable neutralisé"
            : "type de contenu non reconnu";
        errors.push(
          `Fichier « ${file.filename} » conservé en binaire non prévisualisable (${motif})`
        );
        logger.info(
          { filename: file.filename, reason: neutralizedReason },
          "[sync] Fichier externe stocké en binaire opaque"
        );
      }

      const key = `${spaceId}/sync-${randomUUID()}.${ext}`;

      await uploadFile(key, buffer, contentType, { contentDisposition });

      await db.insert(attachments).values({
        spaceId,
        filename: file.filename.slice(0, 500),
        mimeType: contentType.slice(0, 255),
        sizeBytes: buffer.length,
        storageKey: key,
        uploadedBy,
      });

      results.push({
        key,
        filename: file.filename,
        mimeType: contentType,
        size: buffer.length,
      });
    } catch (err) {
      // Erreur sur un fichier (cible refusée, trop volumineuse, injoignable) :
      // on journalise côté serveur, on le signale dans le compte rendu de
      // synchronisation, et on continue les autres.
      errors.push(
        `Fichier « ${file.filename} » non récupéré (cible refusée, trop volumineuse ou injoignable)`
      );
      logger.warn(
        { err, filename: file.filename },
        "[sync] Téléchargement de fichier externe refusé"
      );
    }
  }

  return results;
}

function coerceValue(value: unknown, targetType: string): unknown {
  if (value == null) return targetType === "checkbox" ? false : targetType === "number" ? 0 : targetType === "attachment" ? [] : "";

  switch (targetType) {
    case "text":
    case "url":
    case "email":
    case "time":
      return String(value);
    case "number":
      return typeof value === "number" ? value : parseFloat(String(value)) || 0;
    case "date":
      return String(value);
    case "select":
      return Array.isArray(value) ? value : String(value);
    case "checkbox":
      return Boolean(value);
    case "relation":
      return Array.isArray(value) ? value : [];
    case "attachment":
      return Array.isArray(value) ? value : [];
    default:
      return value;
  }
}
