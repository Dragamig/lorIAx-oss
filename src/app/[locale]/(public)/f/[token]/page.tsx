import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { eq, asc, and } from "drizzle-orm";
import {
  userDatabaseViews,
  userDatabaseColumns,
  userDatabases,
} from "@/lib/db/schema";
import { PublicForm } from "@/components/bases/public-form";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Page publique d'un formulaire — aucune auth requise.
 * Siloing : on ne fetch QUE la vue par son token (opaque, 32+ bytes).
 * Aucune information sur l'org/space/userId n'est exposée dans la réponse.
 */
export default async function PublicFormPage({ params }: PageProps) {
  const { token } = await params;

  // Validation du token : doit faire au moins 32 chars (notre format)
  if (token.length < 32) notFound();

  const [view] = await db
    .select({
      id: userDatabaseViews.id,
      databaseId: userDatabaseViews.databaseId,
      name: userDatabaseViews.name,
      type: userDatabaseViews.type,
      config: userDatabaseViews.config,
      isPublic: userDatabaseViews.isPublic,
    })
    .from(userDatabaseViews)
    .where(
      and(
        eq(userDatabaseViews.publicToken, token),
        eq(userDatabaseViews.isPublic, true),
        eq(userDatabaseViews.scope, "shared"),
      )
    )
    .limit(1);

  if (!view || view.type !== "form") notFound();

  // Charger les colonnes (sans rows, sans metadata sensible)
  const columns = await db
    .select({
      id: userDatabaseColumns.id,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
      config: userDatabaseColumns.config,
      position: userDatabaseColumns.position,
    })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, view.databaseId))
    .orderBy(asc(userDatabaseColumns.position));

  // Charger le nom de la base (sans le spaceId/orgId)
  const [dbInfo] = await db
    .select({ name: userDatabases.name })
    .from(userDatabases)
    .where(eq(userDatabases.id, view.databaseId))
    .limit(1);
  if (!dbInfo) notFound();

  const cfg = (view.config ?? {}) as {
    hiddenColumnIds?: string[];
    successMessage?: string;
    title?: string;
    description?: string;
  };
  const visibleColumns = columns.filter(
    (c) => !cfg.hiddenColumnIds?.includes(c.id) && c.type !== "formula"
  );

  return (
    <main className="mx-auto max-w-xl py-12 px-4">
      <h1 className="mb-2 text-2xl font-semibold">{cfg.title ?? dbInfo.name}</h1>
      {cfg.description && <p className="mb-6 text-sm text-neutral-600">{cfg.description}</p>}
      <PublicForm
        token={token}
        columns={visibleColumns.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          config: (c.config ?? {}) as Record<string, unknown>,
        }))}
        successMessage={cfg.successMessage ?? "Merci pour votre réponse !"}
        captchaSiteKey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY}
      />
    </main>
  );
}
