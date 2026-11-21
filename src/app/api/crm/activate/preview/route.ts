import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { hasConnectionRow, listCandidates, type Candidate } from "@/lib/crm/connection";
import { CRM_ROLES, type CrmRole } from "@/lib/crm/fields";
import { requestLocale } from "@/lib/crm/locale";
import { listCrmAdminOrgs } from "@/lib/crm/orgs";
import { findCollisions, listEditableSpaces, suggestSpaceId, type ActivationPreview } from "@/lib/crm/preview";
import { loadTemplateMessages } from "@/lib/crm/template-messages";

function sortCandidates(list: Candidate[]): Candidate[] {
  return [...list].sort(
    (a, b) =>
      Number(b.compatible) - Number(a.compatible) || b.score - a.score || a.name.localeCompare(b.name),
  );
}

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "admin", requireEnabled: false }, req);
  if (!access.ok) return access.response;

  const messages = await loadTemplateMessages(requestLocale(req));
  const fieldLabel = (role: CrmRole, key: string) => messages.fields[role][key] ?? key;

  const roles = {} as Record<CrmRole, { candidates: Candidate[]; preselected: string | null }>;
  for (const role of CRM_ROLES) {
    // La cible d'une relation est connue si l'activation crée ou raccorde l'autre rôle (choix de
    // l'interface) ; le serveur revalide à l'écriture.
    const list = await listCandidates(access.orgId, access.user.id, role, undefined, {
      fieldLabel,
      relationTargetKnown: true,
    });
    const candidates = sortCandidates(list);
    const best = candidates.find((c) => c.compatible);
    roles[role] = { candidates, preselected: best ? best.databaseId : null };
  }

  const spaces = await listEditableSpaces(access.orgId, access.user.id);
  const suggestedSpaceId = suggestSpaceId(spaces, [messages.space, "CRM"]);
  const collisions = await findCollisions(suggestedSpaceId, messages.databases);
  const existing = await hasConnectionRow(access.orgId);
  const orgs = await listCrmAdminOrgs(access.user);
  const body: ActivationPreview = { roles, existing, spaces, suggestedSpaceId, collisions, orgs };
  return NextResponse.json(body);
}
