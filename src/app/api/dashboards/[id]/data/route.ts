import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  dashboards,
  dashboardWidgets,
  userDatabases,
  userDatabaseColumns,
  userDatabaseRows,
  users,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { computeKpi, computeGrouped } from "@/components/editor/extensions/database-block/aggregate";
import { getRowDisplayName } from "@/components/editor/extensions/database-block/row-display-name";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import type { WidgetConfig, WidgetResult } from "@/lib/dashboards/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [d] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!d) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  try {
    await requireOrgScoped({ resource: { type: "space", id: d.spaceId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const widgets = await db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, id))
    .orderBy(asc(dashboardWidgets.position));

  const dbIds = [...new Set(widgets.map((w) => w.databaseId))];

  const sourceDbs = dbIds.length
    ? await db
        .select({ id: userDatabases.id, spaceId: userDatabases.spaceId })
        .from(userDatabases)
        .where(inArray(userDatabases.id, dbIds))
    : [];

  // Cache per-space authorization results to avoid redundant checks
  const allowedSpace = new Map<string, boolean>();
  async function spaceAllowed(spaceId: string): Promise<boolean> {
    if (allowedSpace.has(spaceId)) return allowedSpace.get(spaceId)!;
    let ok = true;
    try {
      await requireOrgScoped({ resource: { type: "space", id: spaceId }, minPermission: "viewer" });
    } catch {
      ok = false;
    }
    allowedSpace.set(spaceId, ok);
    return ok;
  }

  // Pre-load columns and rows for all source databases
  const columnsByDb = new Map<string, DbColumn[]>();
  const rowsByDb = new Map<string, DbRow[]>();

  for (const dbId of dbIds) {
    const cols = await db
      .select()
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, dbId))
      .orderBy(asc(userDatabaseColumns.position));
    const rws = await db
      .select()
      .from(userDatabaseRows)
      .where(eq(userDatabaseRows.databaseId, dbId))
      .orderBy(asc(userDatabaseRows.position));
    columnsByDb.set(dbId, cols as unknown as DbColumn[]);
    rowsByDb.set(dbId, rws as unknown as DbRow[]);
  }

  const rowDisplayName = getRowDisplayName;

  // Compute results for each widget independently
  const results: Record<string, WidgetResult> = {};
  const personIds = new Set<string>();
  // relation: map targetDatabaseId → set of row IDs to resolve
  const relationIdsByTargetDb = new Map<string, Set<string>>();
  // map widgetId → targetDatabaseId (for relation widgets)
  const widgetRelationTarget = new Map<string, string>();

  for (const w of widgets) {
    try {
      const src = sourceDbs.find((s) => s.id === w.databaseId);
      if (!src || !(await spaceAllowed(src.spaceId))) {
        results[w.id] = { error: "Base source inaccessible" };
        continue;
      }

      const columns = columnsByDb.get(w.databaseId) ?? [];
      const rows = rowsByDb.get(w.databaseId) ?? [];
      const cfg = w.config as WidgetConfig;

      if (w.type === "kpi") {
        results[w.id] = {
          kind: "kpi",
          value: computeKpi(rows, columns, cfg.filter, cfg.aggregate),
        };
      } else {
        if (!cfg.groupBy) {
          results[w.id] = { error: "group-by manquant" };
          continue;
        }
        const buckets = computeGrouped(rows, columns, cfg.filter, cfg.groupBy, cfg.aggregate);
        const gbCol = columns.find((c) => c.id === cfg.groupBy!.columnId);
        if (gbCol?.type === "person") {
          for (const b of buckets) {
            if (b.label !== "(vide)") personIds.add(b.label);
          }
        } else if (gbCol?.type === "relation") {
          const targetDbId = gbCol.config?.targetDatabaseId;
          if (targetDbId) {
            widgetRelationTarget.set(w.id, targetDbId);
            if (!relationIdsByTargetDb.has(targetDbId)) {
              relationIdsByTargetDb.set(targetDbId, new Set());
            }
            for (const b of buckets) {
              if (b.label !== "(vide)") relationIdsByTargetDb.get(targetDbId)!.add(b.label);
            }
          }
        }
        results[w.id] = { kind: "grouped", buckets };
      }
    } catch {
      results[w.id] = { error: "Erreur de calcul" };
    }
  }

  // Resolve person IDs → display names (via users table)
  if (personIds.size) {
    const people = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, [...personIds]));
    const nameById = new Map(people.map((p) => [p.id, p.name ?? p.email ?? "—"]));
    for (const [wId, r] of Object.entries(results)) {
      const w = widgets.find((x) => x.id === wId);
      if (!w || widgetRelationTarget.has(wId)) continue; // skip relation widgets
      if ("kind" in r && r.kind === "grouped") {
        const columns = columnsByDb.get(w.databaseId) ?? [];
        const cfg = w.config as WidgetConfig;
        const gbCol = columns.find((c) => c.id === cfg.groupBy?.columnId);
        if (gbCol?.type === "person") {
          r.buckets = r.buckets.map((b) => ({
            ...b,
            label: nameById.get(b.label) ?? b.label,
          }));
        }
      }
    }
  }

  // Resolve relation IDs → display names (via target database rows)
  if (relationIdsByTargetDb.size) {
    // Build label maps per target DB
    const labelMapByTargetDb = new Map<string, Map<string, string>>();

    for (const [targetDbId, rowIds] of relationIdsByTargetDb) {
      if (!rowIds.size) continue;

      // Load target DB meta to check space access
      let targetDbSpaceId: string | undefined;
      const alreadyLoaded = sourceDbs.find((s) => s.id === targetDbId);
      if (alreadyLoaded) {
        targetDbSpaceId = alreadyLoaded.spaceId;
      } else {
        const [targetDbMeta] = await db
          .select({ id: userDatabases.id, spaceId: userDatabases.spaceId })
          .from(userDatabases)
          .where(eq(userDatabases.id, targetDbId));
        targetDbSpaceId = targetDbMeta?.spaceId;
      }

      // Access check: if the target space is not allowed, leave IDs as-is
      if (!targetDbSpaceId || !(await spaceAllowed(targetDbSpaceId))) {
        labelMapByTargetDb.set(targetDbId, new Map()); // empty map → fallback to raw id
        continue;
      }

      // Use already-preloaded data if available, otherwise fetch
      let targetRows = rowsByDb.get(targetDbId);
      let targetCols = columnsByDb.get(targetDbId);
      if (!targetRows) {
        const fetched = await db
          .select()
          .from(userDatabaseRows)
          .where(inArray(userDatabaseRows.id, [...rowIds]))
          .orderBy(asc(userDatabaseRows.position));
        targetRows = fetched as unknown as DbRow[];
      }
      if (!targetCols) {
        const fetched = await db
          .select()
          .from(userDatabaseColumns)
          .where(eq(userDatabaseColumns.databaseId, targetDbId))
          .orderBy(asc(userDatabaseColumns.position));
        targetCols = fetched as unknown as DbColumn[];
      }

      const labelMap = new Map<string, string>();
      for (const row of targetRows) {
        if (rowIds.has(row.id)) {
          labelMap.set(row.id, rowDisplayName(row, targetCols));
        }
      }
      labelMapByTargetDb.set(targetDbId, labelMap);
    }

    // Apply label maps to relation widgets
    for (const [wId, targetDbId] of widgetRelationTarget) {
      const r = results[wId];
      const labelMap = labelMapByTargetDb.get(targetDbId);
      if (!labelMap || !("kind" in r) || r.kind !== "grouped") continue;
      r.buckets = r.buckets.map((b) => ({
        ...b,
        label: labelMap.get(b.label) ?? b.label,
      }));
    }
  }

  return NextResponse.json(results);
}
