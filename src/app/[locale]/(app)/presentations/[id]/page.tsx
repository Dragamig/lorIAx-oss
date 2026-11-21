import { notFound, redirect } from "next/navigation";
import { isPresentationsModuleActive } from "@/lib/presentations/guards";

import { db } from "@/lib/db";
import { presentations, spaces } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { OrgScopeError, requireOrgScoped } from "@/lib/auth/require-org-scoped";
import { canSeeTemplateRow, resolveTemplateRights } from "@/lib/presentations/template-access";
import { z } from "zod";
import { getFileJson } from "@/lib/storage/s3";
import { deckSchema, type Deck } from "@/lib/presentations/deck";
import { readTemplateDeck } from "@/lib/presentations/templates";
import { PresentationEditor } from "@/components/presentations/presentation-editor";
import { PresentationReadOnlyView } from "@/components/presentations/presentation-readonly-view";
import { TemplateReadOnlyView } from "@/components/presentations/templates/template-readonly-view";
import { asc, eq, inArray } from "drizzle-orm";


export default async function PresentationPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Module coupé : la page n'existe plus, elle ne se contente pas de se vider.
  if (!(await isPresentationsModuleActive(user))) notFound();

  const { id, locale } = await params;

  if (!z.string().uuid().safeParse(id).success) notFound();

  const [row] = await db
    .select()
    .from(presentations)
    .where(eq(presentations.id, id));
  if (!row) notFound();

  let isAdmin = false;
  let raw: unknown;

  if (row.isTemplate) {
    // Modèle : mêmes règles que la branche modèle du GET de l'API. Lecture
    // ouverte à tout membre de l'organisation, sans espace ; autre organisation
    // et modèle masqué (pour un membre) répondent 404 muet.
    let orgId: string;
    try {
      ({ orgId } = await requireOrgScoped());
    } catch (e) {
      if (e instanceof OrgScopeError) notFound();
      throw e;
    }
    if (row.organizationId !== orgId) notFound();
    const rights = await resolveTemplateRights(user, orgId);
    if (!canSeeTemplateRow(rights, row)) notFound();
    isAdmin = rights.canManage;
    raw = await readTemplateDeck(row);
  } else {
    // Cloisonnement : l'espace porteur doit faire partie des espaces
    // accessibles dans l'organisation courante. Le contrôle est fait ici et
    // pas seulement dans l'API, sinon la page rendrait le document avant tout
    // appel.
    const accessibleIds = await getAccessibleSpaceIds(user);
    if (!row.spaceId || !accessibleIds.includes(row.spaceId)) notFound();
    // Charge utile stockée hors base, comme les canevas du studio design.
    raw = await getFileJson<unknown>(`presentations/${row.id}.json`);
  }

  const parsed = deckSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const deck: Deck = parsed.data;

  // Un membre qui ouvre un modèle ne charge pas le moteur : aperçu en lecture
  // seule et « Utiliser ce modèle » (l'écriture est de toute façon réservée aux
  // admins côté serveur).
  if (row.isTemplate && !isAdmin) {
    const accessibleIds = await getAccessibleSpaceIds(user);
    const userSpaces =
      accessibleIds.length === 0
        ? []
        : await db
            .select({ id: spaces.id, name: spaces.name })
            .from(spaces)
            .where(inArray(spaces.id, accessibleIds))
            .orderBy(asc(spaces.name));
    return (
      <div className="h-full">
        <TemplateReadOnlyView
          template={{
            id: row.id,
            title: row.title,
            templateDescription: row.templateDescription,
            templateOrigin: row.templateOrigin,
            templateSeedKey: row.templateSeedKey,
            templateHiddenAt: null,
            version: row.version,
            slideCount: row.slideCount,
            updatedAt: row.updatedAt.toISOString(),
          }}
          deck={deck}
          spaces={userSpaces}
        />
      </div>
    );
  }

  // Lecteur de l'espace : même droit que le PUT (éditeur au moins). Sans lui,
  // l'éditeur s'ouvrirait et chaque enregistrement finirait en 403, avec un
  // travail perdu à la fermeture. Un modèle est déjà réglé plus haut.
  if (!row.isTemplate && row.spaceId) {
    try {
      const scoped = await requireOrgScoped({
        resource: { type: "space", id: row.spaceId },
        minPermission: "editor",
      });
      // « Enregistrer comme modèle » : réservé à qui gère les modèles de l'organisation.
      isAdmin = (await resolveTemplateRights(user, scoped.orgId)).canManage;
    } catch (e) {
      if (!(e instanceof OrgScopeError)) throw e;
      return (
        <div className="h-full">
          <PresentationReadOnlyView title={row.title} deck={deck} />
        </div>
      );
    }
  }

  return (
    <div className="h-full">
      <PresentationEditor
        presentationId={row.id}
        initialDeck={deck}
        initialVersion={row.version}
        locale={locale}
        title={row.title}
        spaceId={row.spaceId}
        isTemplate={row.isTemplate}
        isAdmin={isAdmin}
        templateOrigin={row.templateOrigin}
        templateSeedKey={row.templateSeedKey}
        templateHidden={Boolean(row.templateHiddenAt)}
      />
    </div>
  );
}
