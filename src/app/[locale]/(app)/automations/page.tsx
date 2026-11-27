import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LAST_SPACE_COOKIE, resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";
import { db } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  spaces,
  userDatabases,
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds, getSpacePermission } from "@/lib/auth/check-access";
import type { AutomationGraph } from "@/lib/automations/automation-graph";
import { AutomationsList } from "./automations-list";
import { TRIGGER_LABELS, deriveActionLabel } from "./automation-labels";
import { canManageSpaceAutomations } from "./automation-access";
import { canManageAutomations } from "@/lib/auth/rbac";
import { redactWebhookTriggerConfig } from "@/lib/automations/webhook-inbound";

interface PageProps {
  searchParams?: Promise<{ spaceId?: string }>;
}

export default async function AutomationsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Section de premier niveau : on résout un espace par défaut quand aucun
  // ?spaceId= n'est fourni (entrée de nav nue), comme la page Dashboards.
  const accessibleIds = await getAccessibleSpaceIds(user);
  const userSpaces =
    accessibleIds.length === 0
      ? []
      : await db
          .select({ id: spaces.id, name: spaces.name })
          .from(spaces)
          .where(inArray(spaces.id, accessibleIds))
          .orderBy(asc(spaces.name));

  if (userSpaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        Aucun espace accessible.
      </div>
    );
  }

  const sp = (await searchParams) ?? {};
  const lastSpaceId = (await cookies()).get(LAST_SPACE_COOKIE)?.value ?? null;
  const spaceId =
    resolveCurrentSpaceId({
      accessibleIds: userSpaces.map((s) => s.id),
      requested: sp.spaceId,
      lastSpaceId,
    }) ?? userSpaces[0].id;

  const permission = await getSpacePermission(user.id, spaceId);
  if (!permission) redirect("/bases");
  // Même règle que les routes de gestion : droit d'édition sur l'espace ET
  // rôle admin, super admin ou gestionnaire d'automatisations.
  const canManage = canManageSpaceAutomations(user, permission);
  // Jeton, secret et dernier corps reçu du webhook entrant : masqués comme
  // dans les réponses GET de l'API pour qui ne gère pas les automatisations.
  const revealWebhookSecrets = canManageAutomations(user.globalRole, user.capabilities ?? []);

  // 1. Bases actives du space
  const bases = await db
    .select({ id: userDatabases.id, name: userDatabases.name })
    .from(userDatabases)
    .where(
      and(
        eq(userDatabases.spaceId, spaceId),
        isNull(userDatabases.archivedAt),
        isNull(userDatabases.deletedAt)
      )
    )
    .orderBy(asc(userDatabases.name));

  const baseIds = bases.map((b) => b.id);
  const baseNameById = new Map(bases.map((b) => [b.id, b.name]));

  // 2a. Automatisations base-liées de l'espace
  const baseAutomations =
    baseIds.length === 0
      ? []
      : await db
          .select()
          .from(userDatabaseAutomations)
          .where(inArray(userDatabaseAutomations.databaseId, baseIds))
          .orderBy(desc(userDatabaseAutomations.updatedAt));

  // 2b. Workflows autonomes de l'espace (databaseId null, déclencheur bouton)
  const autonomousAutomations = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.spaceId, spaceId),
        isNull(userDatabaseAutomations.databaseId)
      )
    )
    .orderBy(desc(userDatabaseAutomations.updatedAt));

  // 3. Dernier run par automation — DISTINCT ON exploite l'index
  // (automation_id, triggered_at) au lieu de charger tout l'historique pour
  // ne garder que le 1er Node-side (cron fréquent → des milliers de runs
  // scannés inutilement, cause principale de la lenteur de la page).
  const automationIds = [...baseAutomations, ...autonomousAutomations].map((a) => a.id);
  const runs =
    automationIds.length === 0
      ? []
      : await db
          .selectDistinctOn([userDatabaseAutomationRuns.automationId], {
            automationId: userDatabaseAutomationRuns.automationId,
            triggeredAt: userDatabaseAutomationRuns.triggeredAt,
            status: userDatabaseAutomationRuns.status,
          })
          .from(userDatabaseAutomationRuns)
          .where(inArray(userDatabaseAutomationRuns.automationId, automationIds))
          .orderBy(
            userDatabaseAutomationRuns.automationId,
            desc(userDatabaseAutomationRuns.triggeredAt)
          );

  const lastRunByAutomationId = new Map<string, { triggeredAt: Date; status: string }>();
  for (const r of runs) {
    lastRunByAutomationId.set(r.automationId, {
      triggeredAt: r.triggeredAt,
      status: r.status,
    });
  }

  type Row = (typeof baseAutomations)[number];
  const mapItem = (row: Row, kind: "base" | "autonomous") => {
    const a = revealWebhookSecrets ? row : redactWebhookTriggerConfig(row);
    const last = lastRunByAutomationId.get(a.id);
    return {
      id: a.id,
      kind,
      databaseId: a.databaseId,
      databaseName: a.databaseId ? baseNameById.get(a.databaseId) ?? "Base inconnue" : null,
      name: a.name,
      triggerType: a.triggerType,
      triggerConfig: (a.triggerConfig ?? {}) as Record<string, unknown>,
      actionType: a.actionType,
      actionConfig: (a.actionConfig ?? {}) as Record<string, unknown>,
      graph: (a.graph ?? null) as AutomationGraph | null,
      triggerLabel: TRIGGER_LABELS[a.triggerType] ?? a.triggerType,
      actionLabel: deriveActionLabel(a.actionType, a.graph as AutomationGraph | null),
      enabled: a.enabled,
      lastRunAt: last?.triggeredAt?.toISOString() ?? a.lastRunAt?.toISOString() ?? null,
      lastRunStatus: last?.status ?? null,
    };
  };

  const items = [
    ...autonomousAutomations.map((a) => mapItem(a, "autonomous")),
    ...baseAutomations
      // Garantit databaseId non-null pour les base-liées (la requête filtre déjà
      // par inArray(databaseId)).
      .filter((a) => a.databaseId !== null)
      .map((a) => mapItem(a, "base")),
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="w-full">
        <h1 className="mb-1 text-xl font-semibold">Automatisations</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Workflows autonomes (déclenchés par un bouton dans un document) et
          automatisations des bases de cet espace.{" "}
          {canManage
            ? "Créez, configurez et activez vos automatisations d'ici."
            : "Consultez leur enchaînement et leur historique d'exécution."}
        </p>

        <AutomationsList
          items={items}
          bases={bases}
          currentSpaceId={spaceId}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
