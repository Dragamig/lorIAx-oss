import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  userDatabaseColumns,
  userDatabaseRows,
  userDatabases,
} from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import {
  createPairedRelationColumn,
  deleteColumnWithPair,
  findPairedInverse,
  stripInverseColumnId,
  unpairInverse,
  RelationColumnError,
} from "@/lib/databases/relation-columns";
import { setRowChangeContext, SKIP_ROW_HISTORY } from "@/lib/databases/row-change-context";
import { canTargetRelationDatabase } from "@/lib/databases/relation-target-access";

const createColumnSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["text", "number", "date", "select", "checkbox", "relation", "image", "formula", "url", "email", "attachment", "time", "autonumber", "person", "document_link"]),
  config: z.record(z.string(), z.any()).optional(),
  // Relation vers une autre base : crée par défaut la colonne inverse dans la cible.
  createInverse: z.boolean().optional(),
  inverseName: z.string().trim().min(1).max(255).optional(),
});

// Liste légère des colonnes (id/nom/type) — alimente les sélecteurs de colonne
// (ex. nœud condition de l'éditeur d'automatisation), sans charger les lignes
// comme le fait GET /api/databases/[databaseId].
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "viewer",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const columns = await db
    .select({
      id: userDatabaseColumns.id,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
    })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId))
    .orderBy(userDatabaseColumns.position);

  return NextResponse.json({ columns });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = createColumnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Verrou advisory + transaction : la création de colonne + son éventuel
  // backfill autonumber doivent être atomiques. Sans cela, un POST /rows
  // concurrent ou un second POST /columns peut s'intercaler entre l'insert
  // et le backfill → doublons d'autonumber ou backfill partiel.
  // `inverseColumnId` est posé uniquement par le serveur, jamais accepté du client.
  const config = stripInverseColumnId(parsed.data.config);
  // La cible n'a de sens que pour une relation : ignorée (et jamais contrôlée) sinon,
  // pour qu'un futur passage de type passe par le contrôle de cible du PATCH.
  if (parsed.data.type !== "relation") delete config.targetDatabaseId;
  const targetId = parsed.data.type === "relation" ? config.targetDatabaseId : undefined;

  if (targetId !== undefined && targetId !== null && targetId !== "" && targetId !== databaseId) {
    if (!(await canTargetRelationDatabase(targetId))) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
    if (parsed.data.createInverse !== false) {
      try {
        const [source] = await db
          .select({ name: userDatabases.name })
          .from(userDatabases)
          .where(eq(userDatabases.id, databaseId))
          .limit(1);
        const result = await db.transaction((tx) =>
          createPairedRelationColumn(tx, {
            databaseId,
            targetDatabaseId: targetId as string,
            name: parsed.data.name,
            config,
            inverseName: parsed.data.inverseName ?? source?.name ?? parsed.data.name,
          })
        );
        return NextResponse.json(
          { ...result.column, inverseColumn: result.inverse },
          { status: 201 }
        );
      } catch (e) {
        if (e instanceof RelationColumnError) {
          return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
        }
        throw e;
      }
    }
  }
  // Auto-relation (cible = cette base) ou relation sans cible : sens unique.

  const column = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${databaseId}, 0))`);

    const [maxPos] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${userDatabaseColumns.position}), -1)` })
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId));

    const [inserted] = await tx
      .insert(userDatabaseColumns)
      .values({
        databaseId,
        name: parsed.data.name,
        type: parsed.data.type,
        config,
        position: (maxPos?.max ?? -1) + 1,
      })
      .returning();

    if (inserted.type === "autonumber") {
      await backfillAutonumber(tx, databaseId, inserted.id, (inserted.config as Record<string, unknown>) ?? {});
    }
    return inserted;
  });

  return NextResponse.json(column, { status: 201 });
}

const updateColumnsSchema = z.object({
  columns: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(255).optional(),
      type: z
        .enum(["text", "number", "date", "select", "checkbox", "relation", "image", "formula", "url", "email", "attachment", "time", "autonumber", "person", "document_link"])
        .optional(),
      config: z.record(z.string(), z.any()).optional(),
      position: z.number().int().min(0).optional(),
    })
  ),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateColumnsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Contrôles préalables sur les colonnes relation : la cible d'une relation
  // jumelée est figée, et toute nouvelle cible doit être accessible en édition.
  const ids = parsed.data.columns.map((c) => c.id);
  const current = ids.length
    ? await db
        .select()
        .from(userDatabaseColumns)
        .where(and(eq(userDatabaseColumns.databaseId, databaseId), inArray(userDatabaseColumns.id, ids)))
    : [];
  const currentById = new Map(current.map((c) => [c.id, c]));
  for (const col of parsed.data.columns) {
    const before = currentById.get(col.id);
    if (!before) continue;
    const finalType = col.type ?? before.type;
    if (finalType !== "relation") continue;
    const beforeCfg = (before.config as Record<string, unknown> | null) ?? {};
    const wasRelation = before.type === "relation";
    // Jumelle réellement valide (réciproque) : seule elle fige la cible.
    const paired = wasRelation ? await findPairedInverse(db, before) : null;
    const given = col.config?.targetDatabaseId;
    if (paired) {
      if (given !== undefined && given !== beforeCfg.targetDatabaseId) {
        return NextResponse.json(
          { error: "La base cible d'une relation jumelée ne peut pas être modifiée", code: "paired-target-locked" },
          { status: 400 }
        );
      }
      continue; // cible inchangée, déjà validée à la création
    }
    // Cible effective : celle fournie, sinon celle déjà en config.
    const effective = col.config ? (given ?? beforeCfg.targetDatabaseId) : beforeCfg.targetDatabaseId;
    if (effective === undefined || effective === null || effective === "" || effective === databaseId) continue;
    // Déjà validée : colonne déjà relation, cible inchangée.
    if (wasRelation && effective === beforeCfg.targetDatabaseId) continue;
    if (!(await canTargetRelationDatabase(effective))) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
  }

  // Verrou advisory + transaction sur l'ensemble du batch : un PATCH qui
  // transforme une colonne en autonumber doit pouvoir backfiller sans
  // qu'un POST /rows concurrent vienne insérer une ligne entre l'UPDATE
  // de la colonne et la fin du backfill.
  const results = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${databaseId}, 0))`);

    const out = [];
    for (const col of parsed.data.columns) {
      const { id, ...updates } = col;
      if (Object.keys(updates).length === 0) continue;

      const [existing] = await tx
        .select()
        .from(userDatabaseColumns)
        .where(eq(userDatabaseColumns.id, id))
        .limit(1);
      if (!existing || existing.databaseId !== databaseId) continue;

      // `inverseColumnId` appartient au serveur : jamais pris du client. Une
      // jumelle valide garde sa cible et son lien tant que la colonne reste une
      // relation, et se dissout si le type change. Un lien orphelin est nettoyé.
      const existingCfg = (existing.config as Record<string, unknown> | null) ?? {};
      const inverse = existing.type === "relation" ? await findPairedInverse(tx, existing) : null;
      const nextType = updates.type ?? existing.type;
      if (inverse && nextType !== "relation") {
        await unpairInverse(tx, inverse.id);
        updates.config = stripInverseColumnId(updates.config ?? existingCfg);
      } else if (inverse) {
        if (updates.config) {
          updates.config = {
            ...stripInverseColumnId(updates.config),
            targetDatabaseId: existingCfg.targetDatabaseId,
            inverseColumnId: existingCfg.inverseColumnId,
          };
        }
      } else if (existingCfg.inverseColumnId !== undefined) {
        updates.config = stripInverseColumnId(updates.config ?? existingCfg);
      } else if (updates.config) {
        updates.config = stripInverseColumnId(updates.config);
      }

      const [updated] = await tx
        .update(userDatabaseColumns)
        .set(updates)
        .where(eq(userDatabaseColumns.id, id))
        .returning();
      if (updated) {
        out.push(updated);
        if (updated.type === "autonumber") {
          await backfillAutonumber(tx, databaseId, updated.id, (updated.config as Record<string, unknown>) ?? {});
        }
      }
    }
    return out;
  });

  return NextResponse.json(results);
}

// Affecte des numéros séquentiels (par ordre de position puis createdAt) aux
// lignes existantes qui n'ont pas encore de valeur pour la colonne autonumber.
// Le départ est config.startNumber (défaut 1), poursuivi à partir du max existant.
// Doit s'exécuter dans une transaction sous advisory lock (voir appelants).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function backfillAutonumber(
  tx: Tx,
  databaseId: string,
  columnId: string,
  config: Record<string, unknown>
) {
  const start = typeof config.startNumber === "number" ? config.startNumber : 1;
  await setRowChangeContext(tx, SKIP_ROW_HISTORY);
  const rows = await tx
    .select()
    .from(userDatabaseRows)
    .where(eq(userDatabaseRows.databaseId, databaseId));

  rows.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  let maxExisting: number | null = null;
  for (const r of rows) {
    const v = (r.cells as Record<string, unknown> | null)?.[columnId];
    if (typeof v === "number" && Number.isFinite(v)) {
      maxExisting = maxExisting == null ? v : Math.max(maxExisting, v);
    }
  }
  let next = maxExisting != null ? maxExisting + 1 : start;

  for (const r of rows) {
    const cells = ((r.cells as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const current = cells[columnId];
    if (typeof current === "number" && Number.isFinite(current)) continue;
    cells[columnId] = next++;
    await tx
      .update(userDatabaseRows)
      .set({ cells })
      .where(eq(userDatabaseRows.id, r.id));
  }
}

const deleteColumnSchema = z.object({
  columnId: z.string().uuid(),
  // Colonne jumelée : true supprime aussi la jumelle, false (défaut) la garde en relation simple.
  alsoDeleteInverse: z.boolean().optional(),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = deleteColumnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Garde-fou : la colonne doit appartenir à cette database
  const [existing] = await db
    .select()
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.id, parsed.data.columnId))
    .limit(1);
  if (!existing || existing.databaseId !== databaseId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  // Supprimer aussi la jumelle écrit dans une autre base : droit editor requis
  // dessus, refus muet (404) sinon.
  const alsoDeleteInverse = parsed.data.alsoDeleteInverse === true;
  if (alsoDeleteInverse) {
    const inverse = await findPairedInverse(db, existing);
    if (inverse && !(await canTargetRelationDatabase(inverse.databaseId))) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
  }

  // Suppression de la colonne (et de sa jumelle si demandé) + purge des clés
  // dans les cells JSONB, atomique.
  const result = await db.transaction((tx) =>
    deleteColumnWithPair(tx, {
      databaseId,
      columnId: parsed.data.columnId,
      alsoDeleteInverse,
    })
  );

  return NextResponse.json({ ok: true, deletedInverseColumnId: result.deletedInverseColumnId });
}
