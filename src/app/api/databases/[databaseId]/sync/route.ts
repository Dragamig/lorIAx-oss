import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import {
  externalDatabaseMappings,
  syncLogs,
} from "@/lib/db/schema";
import {
  syncPull,
  syncPush,
  syncBidirectional,
  fetchExternalSchema,
} from "@/lib/integrations/sync-orchestrator";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";

type RouteParams = { params: Promise<{ databaseId: string }> };

// Bornes pour empêcher un body monstrueux d'épuiser mémoire/chiffrement.
const PROVIDER_ENUM = z.enum(["airtable", "notion"]);
const configureSchema = z.object({
  action: z.literal("configure"),
  provider: PROVIDER_ENUM,
  externalId: z.string().min(1).max(2048),
  credentials: z.string().min(1).max(8192),
  syncMode: z.enum(["manual", "pull", "bidirectional"]).optional(),
  syncIntervalMin: z.number().int().positive().max(43200).optional().nullable(),
  columnMapping: z.array(z.record(z.string(), z.any())).max(500).optional(),
});
const schemaActionSchema = z.object({
  action: z.literal("schema"),
  provider: PROVIDER_ENUM,
  externalId: z.string().min(1).max(2048),
  credentials: z.string().min(1).max(8192),
});
const syncActionSchema = z.object({
  action: z.enum(["pull", "push", "sync"]),
  mappingId: z.string().uuid(),
});
const deleteMappingSchema = z.object({
  mappingId: z.string().uuid(),
});

/**
 * GET /api/databases/[databaseId]/sync
 * Récupérer la config sync + derniers logs
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const mappings = await db
    .select()
    .from(externalDatabaseMappings)
    .where(eq(externalDatabaseMappings.userDatabaseId, databaseId));

  const logsMap: Record<string, (typeof syncLogs.$inferSelect)[]> = {};
  for (const mapping of mappings) {
    const logs = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.mappingId, mapping.id))
      .orderBy(desc(syncLogs.startedAt))
      .limit(5);
    logsMap[mapping.id] = logs;
  }

  return NextResponse.json({
    mappings: mappings.map((m) => ({
      ...m,
      credentialsEnc: undefined,
      logs: logsMap[m.id] || [],
    })),
  });
}

/**
 * POST /api/databases/[databaseId]/sync
 * Créer ou déclencher une synchronisation
 * body.action : "configure" | "pull" | "push" | "sync" | "schema"
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await req.json();
  const { action } = body;

  if (action === "configure") {
    const parsed = configureSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { provider, externalId, credentials, syncMode, syncIntervalMin, columnMapping } = parsed.data;

    const [existing] = await db
      .select()
      .from(externalDatabaseMappings)
      .where(
        and(
          eq(externalDatabaseMappings.userDatabaseId, databaseId),
          eq(externalDatabaseMappings.provider, provider)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(externalDatabaseMappings)
        .set({
          externalId,
          credentialsEnc: encrypt(credentials),
          syncMode: syncMode || "manual",
          syncIntervalMin: syncIntervalMin || null,
          columnMapping: columnMapping || [],
          updatedAt: new Date(),
        })
        .where(eq(externalDatabaseMappings.id, existing.id))
        .returning();

      return NextResponse.json({ mapping: { ...updated, credentialsEnc: undefined } });
    }

    const [mapping] = await db
      .insert(externalDatabaseMappings)
      .values({
        userDatabaseId: databaseId,
        provider,
        externalId,
        credentialsEnc: encrypt(credentials),
        syncMode: syncMode || "manual",
        syncIntervalMin: syncIntervalMin || null,
        columnMapping: columnMapping || [],
      })
      .returning();

    return NextResponse.json({ mapping: { ...mapping, credentialsEnc: undefined } }, { status: 201 });
  }

  if (action === "schema") {
    const parsed = schemaActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { provider, externalId, credentials } = parsed.data;

    try {
      const schema = await fetchExternalSchema(provider, externalId, credentials);
      return NextResponse.json({ schema });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erreur" },
        { status: 502 }
      );
    }
  }

  if (action === "pull" || action === "push" || action === "sync") {
    const parsed = syncActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { mappingId } = parsed.data;

    // Garde-fou : le mapping doit appartenir à cette database (déjà scopée à l'org)
    const [mapping] = await db
      .select()
      .from(externalDatabaseMappings)
      .where(
        and(
          eq(externalDatabaseMappings.id, mappingId),
          eq(externalDatabaseMappings.userDatabaseId, databaseId)
        )
      )
      .limit(1);

    if (!mapping) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }

    // Verrou atomique anti-TOCTOU : deux requêtes simultanées passeraient
    // toutes deux un simple `if (mapping.isSyncing)` avant qu'aucune ne pose
    // le flag, et lanceraient deux syncs concurrentes sur la même mapping.
    // L'UPDATE conditionnel garantit qu'une seule requête prend la main.
    const [claimed] = await db
      .update(externalDatabaseMappings)
      .set({ isSyncing: true, syncError: null, updatedAt: new Date() })
      .where(
        and(
          eq(externalDatabaseMappings.id, mappingId),
          eq(externalDatabaseMappings.isSyncing, false)
        )
      )
      .returning();

    if (!claimed) {
      return NextResponse.json({ error: "Synchronisation déjà en cours" }, { status: 409 });
    }

    try {
      let result;
      if (action === "pull") result = await syncPull(mappingId);
      else if (action === "push") result = await syncPush(mappingId);
      else result = await syncBidirectional(mappingId);

      return NextResponse.json({ result });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erreur de sync" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}

/**
 * DELETE /api/databases/[databaseId]/sync
 * Supprimer une configuration de synchronisation
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await req.json();
  const parsed = deleteMappingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { mappingId } = parsed.data;

  const deleted = await db
    .delete(externalDatabaseMappings)
    .where(
      and(
        eq(externalDatabaseMappings.id, mappingId),
        eq(externalDatabaseMappings.userDatabaseId, databaseId)
      )
    )
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
