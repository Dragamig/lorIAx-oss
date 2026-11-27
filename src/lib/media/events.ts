import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces, userDatabaseAutomations, users, type Media } from "@/lib/db/schema";
import { resolveMediaAccess } from "./access";
import type { SessionUser } from "@/types";
import logger from "@/lib/logger";
import { getSetting } from "@/lib/settings/system-settings";
import { getSpacePermission } from "@/lib/auth/check-access";
import { organizationOfSpace } from "@/lib/automations/target-space";
import type { AutomationRow } from "@/lib/automations/actions/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MediaScopeConfig = { scope: "any" | "orphan" | "space"; spaceId?: string };

/**
 * Lit la portée d'un déclencheur `media_uploaded` : `any` par défaut, `orphan`
 * (médias hors espace) ou `space` (un espace, UUID obligatoire). Null si invalide.
 */
export function parseMediaScopeConfig(raw: unknown): MediaScopeConfig | null {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as { scope?: unknown; spaceId?: unknown };
  const scope = cfg.scope ?? "any";
  if (scope === "any" || scope === "orphan") return { scope };
  if (scope === "space") {
    return typeof cfg.spaceId === "string" && UUID_RE.test(cfg.spaceId)
      ? { scope, spaceId: cfg.spaceId }
      : null;
  }
  return null;
}

/**
 * Validation à l'enregistrement d'un déclencheur `media_uploaded` : portée
 * valide ; pour `space`, l'espace doit appartenir à l'organisation de l'acteur
 * et l'acteur (créateur de l'automatisme) doit y avoir accès. Même message pour
 * « inexistant » et « autre organisation » (pas d'oracle d'existence).
 */
export async function validateMediaTriggerConfig(
  raw: unknown,
  actor: { userId: string; orgId: string }
): Promise<{ ok: true; config: MediaScopeConfig } | { ok: false; error: string }> {
  const config = parseMediaScopeConfig(raw);
  if (!config) return { ok: false, error: "Portée du déclencheur média invalide" };
  if (config.scope === "space" && config.spaceId) {
    const orgId = await organizationOfSpace(config.spaceId);
    if (orgId !== actor.orgId || !(await getSpacePermission(actor.userId, config.spaceId))) {
      return { ok: false, error: "Espace introuvable ou accès refusé" };
    }
  }
  return { ok: true, config };
}

export function matchesMediaScope(config: MediaScopeConfig, m: { spaceId: string | null }): boolean {
  if (config.scope === "any") return true;
  if (config.scope === "orphan") return m.spaceId === null;
  return !!config.spaceId && m.spaceId === config.spaceId;
}

type UploadedMedia = Pick<Media, "id" | "organizationId" | "spaceId" | "uploadedBy" | "origin"> & {
  filename?: string;
};

async function loadCreator(userId: string | null): Promise<SessionUser | null> {
  if (!userId) return null;
  const [u] = await db
    .select({ id: users.id, email: users.email, name: users.name, globalRole: users.globalRole, capabilities: users.capabilities })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u ? { id: u.id, email: u.email, name: u.name, globalRole: u.globalRole, capabilities: [...u.capabilities] } : null;
}

/**
 * Émet « média ajouté » vers les automatismes autonomes `media_uploaded`.
 * Rattachement : comme `manual` et `webhook_inbound`, l'automatisme porte un
 * `spaceId` d'ancrage (sans base) ; son organisation = celle de cet espace, et
 * seuls les médias de CETTE organisation le déclenchent. Ne lève jamais : un
 * échec de dispatch ne doit pas bloquer l'upload.
 */
export async function emitMediaUploaded(m: UploadedMedia): Promise<void> {
  try {
    // Anti-boucle : un média produit par un automatisme ne redéclenche rien.
    if (m.origin === "automation") return;
    const cfg = await getSetting<{ enabled?: boolean }>("automations");
    if (cfg?.enabled === false) return;

    // Import différé : executor → registre d'actions → ingestMedia → ce module formerait un cycle.
    const { executeAutomation } = await import("@/lib/automations/executor");

    const rows = await db
      .select({ automation: userDatabaseAutomations, organizationId: spaces.organizationId })
      .from(userDatabaseAutomations)
      .innerJoin(spaces, eq(spaces.id, userDatabaseAutomations.spaceId))
      .where(
        and(
          eq(userDatabaseAutomations.triggerType, "media_uploaded"),
          eq(userDatabaseAutomations.enabled, true),
          isNull(userDatabaseAutomations.databaseId),
          isNotNull(userDatabaseAutomations.spaceId),
          eq(spaces.organizationId, m.organizationId)
        )
      );

    for (const { automation, organizationId } of rows) {
      try {
        // Défense en profondeur : la jointure filtre déjà, on revérifie.
        if (organizationId !== m.organizationId) continue;
        const scope = parseMediaScopeConfig(automation.triggerConfig);
        if (!scope || !matchesMediaScope(scope, m)) continue;
        if (scope.scope === "space" && scope.spaceId) {
          if ((await organizationOfSpace(scope.spaceId)) !== m.organizationId) continue;
          const actor = automation.createdBy;
          if (!actor || !(await getSpacePermission(actor, scope.spaceId))) continue;
        }
        // Le créateur de l'automatisme doit pouvoir LIRE ce média, quelle que soit la portée :
        // sinon id, nom et url d'un média hors espace fuiteraient vers webhook ou mail.
        const creator = await loadCreator(automation.createdBy);
        if (!creator) continue;
        const access = await resolveMediaAccess(
          creator,
          {
            id: m.id,
            organizationId: m.organizationId,
            spaceId: m.spaceId,
            uploadedBy: m.uploadedBy,
            deletedAt: null,
            origin: m.origin,
            mimeType: "",
          },
          "read",
          { orgId: m.organizationId }
        );
        if (!access.allowed) continue;
        void executeAutomation(automation as AutomationRow, {
          event: "media_uploaded",
          spaceId: automation.spaceId ?? undefined,
          user: m.uploadedBy ? { id: m.uploadedBy } : undefined,
          media: {
            id: m.id,
            filename: m.filename ?? "",
            spaceId: m.spaceId ?? "",
            url: `/api/media/${m.id}`,
          },
        }).catch(() => undefined);
      } catch (err) {
        logger.warn({ err, automationId: automation.id }, "Déclencheur média ajouté impossible");
      }
    }
  } catch (err) {
    logger.warn({ err, mediaId: m.id }, "Émission média ajouté impossible");
  }
}
