import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { userDatabases } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel } from "@/types";
import { getDefaultProvider } from "@/lib/ai/provider";
import { AiToolsClient } from "./ai-tools-client";

interface PageProps {
  searchParams?: Promise<{ spaceId?: string }>;
}

function isProviderConfigured(name: string): boolean {
  if (name === "claude") return !!process.env.ANTHROPIC_API_KEY;
  if (name === "openai") return !!process.env.OPENAI_API_KEY;
  if (name === "ollama") return !!process.env.OLLAMA_BASE_URL;
  if (name === "mistral") return !!process.env.MISTRAL_API_KEY;
  return false;
}

/**
 * Cloisonnement multi-tenant (revue adversariale du lot 6, 2026-08-20).
 *
 * Cette page prenait un `spaceId` dans les paramètres de requête et
 * l'autorisait sur la seule permission d'espace : `getSpacePermission`
 * n'applique aucun filtre d'organisation, un espace d'un autre tenant passait
 * donc le contrôle. `requireOrgScoped` confronte l'espace à l'organisation de
 * la requête AVANT de rendre la permission, et son refus est traduit en
 * redirection muette vers `/bases` (jamais un message qui révélerait
 * l'existence de l'espace visé).
 */
export default async function BasesAiToolsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = (await searchParams) ?? {};
  if (!sp.spaceId) redirect("/bases");

  let permission: PermissionLevel | null = null;
  try {
    const ctx = await requireOrgScoped({
      resource: { type: "space", id: sp.spaceId },
      minPermission: "viewer",
    });
    permission = ctx.permission ?? null;
  } catch (e) {
    if (e instanceof OrgScopeError) redirect("/bases");
    throw e;
  }
  if (!permission) redirect("/bases");

  const provider = getDefaultProvider();
  const configured = isProviderConfigured(provider.name);

  const bases = await db
    .select({ id: userDatabases.id, name: userDatabases.name })
    .from(userDatabases)
    .where(
      and(
        eq(userDatabases.spaceId, sp.spaceId),
        isNull(userDatabases.archivedAt),
        isNull(userDatabases.deletedAt)
      )
    )
    .orderBy(asc(userDatabases.name));

  const canCreate = permission !== "viewer";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold">Outils IA pour les bases</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Tirez parti de l&apos;IA pour créer des bases plus vite et écrire des
          formules sans relire la documentation.
        </p>

        <div className="mb-6 rounded border border-border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                configured
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
              }`}
            >
              {configured ? "Configuré" : "Non configuré"}
            </span>
            <span className="text-foreground">
              Provider : <strong>{provider.name}</strong>
              {provider.model ? (
                <>
                  {" "}— modèle <code className="text-xs">{provider.model}</code>
                </>
              ) : null}
            </span>
          </div>
          {!configured && (
            <p className="mt-2 text-xs text-muted-foreground">
              Aucune clé API détectée pour ce provider. Ajoutez la variable
              d&apos;environnement correspondante (
              {provider.name === "claude" && <code>ANTHROPIC_API_KEY</code>}
              {provider.name === "openai" && <code>OPENAI_API_KEY</code>}
              {provider.name === "ollama" && <code>OLLAMA_BASE_URL</code>}
              {provider.name === "mistral" && <code>MISTRAL_API_KEY</code>}
              ) puis redémarrez l&apos;app.
            </p>
          )}
        </div>

        <AiToolsClient
          spaceId={sp.spaceId}
          canCreate={canCreate}
          configured={configured}
          bases={bases}
        />

        <p className="mt-6 text-xs text-muted-foreground">
          Besoin d&apos;aller plus loin ?{" "}
          <Link
            href={`/bases?spaceId=${encodeURIComponent(sp.spaceId)}`}
            className="underline hover:text-foreground"
          >
            Retour aux bases
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
