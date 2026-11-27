import type { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { AiCreationKind } from "@/lib/db/schema-ai-creation-proposals";
import type { SessionUser } from "@/types";
import {
  documentProposalSchema,
  presentationProposalSchema,
  spreadsheetProposalSchema,
} from "@/lib/ai/creation/schemas";
import type { CreationPreview, CreationView } from "./creation-view-types";

type Row = {
  id: string;
  kind: AiCreationKind;
  status: CreationView["status"];
  spaceId: string | null;
  payload: unknown;
  resultId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

const MAX_SPACES = 100;
const PREVIEW_ROWS = 4;

async function canEdit(user: SessionUser, orgId: string, spaceId: string, req?: NextRequest): Promise<boolean> {
  try {
    const s = await requireOrgScoped(
      { resource: { type: "space", id: spaceId }, minPermission: "editor" },
      req,
      { user, orgId },
    );
    return s.orgId === orgId && s.spaceId === spaceId && (s.permission === "editor" || s.permission === "admin");
  } catch (e) {
    if (e instanceof OrgScopeError) return false;
    throw e;
  }
}

function previewOf(kind: AiCreationKind, payload: unknown): { title: string; preview: CreationPreview } | null {
  if (kind === "spreadsheet") {
    const p = spreadsheetProposalSchema.safeParse(payload);
    if (!p.success) return null;
    const rows = p.data.rows ?? [];
    return {
      title: p.data.title,
      preview: { kind, columns: p.data.columns, rows: rows.slice(0, PREVIEW_ROWS), rowCount: rows.length },
    };
  }
  if (kind === "document") {
    const p = documentProposalSchema.safeParse(payload);
    if (!p.success) return null;
    return {
      title: p.data.title,
      preview: {
        kind,
        outline: p.data.outline.map((o) => ({ heading: o.heading, level: o.level })),
        visibility: "private" as const,
        // Corps exact écrit à l'application (bodyMarkdown remplace le plan) : affiché à la validation
        ...(p.data.bodyMarkdown ? { body: p.data.bodyMarkdown } : {}),
      },
    };
  }
  const p = presentationProposalSchema.safeParse(payload);
  if (!p.success) return null;
  return {
    title: p.data.title,
    preview: { kind, slides: p.data.slides.map((s) => ({ title: s.title, layout: s.layout })) },
  };
}

/** Vues des propositions déjà filtrées par propriétaire et organisation (voir `getOwnCreationProposal`). */
export async function buildCreationViews(
  rows: Row[],
  user: SessionUser,
  orgId: string,
  req?: NextRequest,
): Promise<CreationView[]> {
  if (rows.length === 0) return [];
  const orgSpaces = await db
    .select({ id: spaces.id, name: spaces.name, slug: spaces.slug })
    .from(spaces)
    .where(eq(spaces.organizationId, orgId))
    .orderBy(spaces.name)
    .limit(MAX_SPACES);
  const editable = (
    await Promise.all(orgSpaces.map(async (s) => ((await canEdit(user, orgId, s.id, req)) ? s : null)))
  ).filter((s): s is (typeof orgSpaces)[number] => s !== null);
  const editableIds = new Set(editable.map((s) => s.id));
  const byId = new Map(orgSpaces.map((s) => [s.id, s]));

  const docIds = rows.filter((r) => r.status === "applied" && r.resultId && r.kind !== "presentation").map((r) => r.resultId!);
  const docs = docIds.length
    ? await db
        .select({ id: documents.id, spaceId: documents.spaceId })
        .from(documents)
        .where(and(inArray(documents.id, docIds), inArray(documents.spaceId, orgSpaces.map((s) => s.id))))
    : [];
  const docSpace = new Map(docs.map((d) => [d.id, d.spaceId]));

  const views: CreationView[] = [];
  for (const r of rows) {
    const built = previewOf(r.kind, r.payload);
    if (!built) continue;
    const space = r.spaceId ? byId.get(r.spaceId) : undefined;
    let result: CreationView["result"] = null;
    if (r.status === "applied" && r.resultId) {
      if (r.kind === "presentation") {
        result = { id: r.resultId, title: built.title, href: `/presentations/${r.resultId}` };
      } else {
        const slug = byId.get(docSpace.get(r.resultId) ?? "")?.slug;
        if (slug) result = { id: r.resultId, title: built.title, href: `/s/${slug}/${r.resultId}` };
      }
    }
    views.push({
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: built.title,
      spaceId: r.spaceId ?? "",
      spaceName: space?.name ?? "",
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      canApply: !!r.spaceId && editableIds.has(r.spaceId),
      editableSpaces: editable.map((s) => ({ id: s.id, name: s.name })),
      preview: built.preview,
      result,
    });
  }
  return views;
}
