import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel } from "@/types";
import {
  FORMULA_CATEGORIES,
  FORMULA_OPERATORS,
} from "@/components/editor/extensions/database-block/formula-functions";

interface PageProps {
  searchParams?: Promise<{ spaceId?: string }>;
}

/**
 * Page d'aide aux formules des bases. Rendu statique à partir de la source
 * unique de vérité `formula-functions.ts` (également consommée par le prompt
 * du générateur IA). Toute fonction ajoutée à l'évaluateur y apparaît
 * automatiquement.
 *
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
export default async function BasesFormulaHelpPage({ searchParams }: PageProps) {
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold">Aide aux formules</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Référence des fonctions et opérateurs disponibles dans les colonnes de
          type formule. Référencez une autre colonne avec{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            prop(&quot;Nom&quot;)
          </code>{" "}
          (sensible à la casse).
        </p>

        <div className="space-y-8">
          {FORMULA_CATEGORIES.map((cat) => (
            <section key={cat.key}>
              <h2 className="mb-3 text-base font-semibold">{cat.label}</h2>
              <div className="overflow-hidden rounded border border-border">
                <table className="w-full text-sm">
                  <tbody>
                    {cat.functions.map((fn) => (
                      <tr
                        key={fn.signature}
                        className="border-b border-border last:border-0"
                      >
                        <td className="w-1/3 whitespace-nowrap px-3 py-2 align-top">
                          <code className="text-xs text-violet-700 dark:text-violet-300">
                            {fn.signature}
                          </code>
                        </td>
                        <td className="px-3 py-2 align-top text-foreground">
                          {fn.description}
                          {fn.example && (
                            <div className="mt-1">
                              <code className="text-xs text-muted-foreground">
                                {fn.example}
                              </code>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section>
            <h2 className="mb-3 text-base font-semibold">Opérateurs</h2>
            <code className="rounded bg-muted px-2 py-1 text-sm">
              {FORMULA_OPERATORS}
            </code>
          </section>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Besoin d&apos;aide pour rédiger une formule ?{" "}
          <Link
            href={`/bases/ai-tools?spaceId=${encodeURIComponent(sp.spaceId)}`}
            className="underline hover:text-foreground"
          >
            Générateur IA de formules
          </Link>{" "}
          ·{" "}
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
