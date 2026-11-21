import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getModuleManifest, getModuleManifests } from "@/lib/modules/registry";
import { setModuleToggle } from "@/lib/modules/toggle";
import { getModulesState } from "@/lib/modules/enablement";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";

const bodySchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { id } = await params;
    const manifest = getModuleManifest(id);
    // Un module interne (édition commerciale) n'est pas pilotable depuis l'interface.
    if (!manifest || manifest.internal) {
      return NextResponse.json({ error: "Module inconnu" }, { status: 404 });
    }

    // Habilitation portée par le manifeste : les modules du socle sont pilotables
    // par un admin, ceux soumis à la licence restent réservés au super_admin.
    if (!hasGlobalRole(user.globalRole, manifest.manageRole)) {
      return NextResponse.json(
        {
          error:
            manifest.manageRole === "super_admin"
              ? "Ce module est réservé au super administrateur"
              : "Accès refusé",
        },
        { status: 403 }
      );
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
    }

    // L'état est résolu une fois pour toutes avec le scope organisation : la
    // licence d'instance est un plafond, le plan de l'organisation le niveau
    // réellement souscrit, et l'ancien contrôle ne regardait que la licence.
    const orgId = await getModuleScopeOrgId();
    const states = await getModulesState(orgId);
    const byId = new Map(states.map((s) => [s.id, s]));
    const state = byId.get(manifest.id);

    if (parsed.data.enabled) {
      if (state && !state.entitled) {
        return NextResponse.json(
          { error: "Module non autorisé par votre licence ou votre offre" },
          { status: 403 }
        );
      }

      // Refus explicite au lieu d'un blocage seulement dérivé à la lecture :
      // activer un module dont une dépendance est éteinte ne produisait aucun
      // message, juste une carte « dépendance inactive » après coup.
      const manifests = getModuleManifests();
      const inactiveDeps = manifest.dependencies.filter(
        (dep) => byId.get(dep)?.status !== "active"
      );
      if (inactiveDeps.length > 0) {
        const names = inactiveDeps.map(
          (dep) => manifests.find((m) => m.id === dep)?.name ?? dep
        );
        return NextResponse.json(
          {
            error: `Activez d'abord : ${names.join(", ")}`,
            missingDeps: inactiveDeps,
          },
          { status: 409 }
        );
      }
    }

    await setModuleToggle(manifest, parsed.data.enabled);

    // L'appelant a besoin de l'état recalculé : éteindre un module bascule ses
    // dépendants en « blocked-deps », ce que le patch local du client ignorait.
    const refreshed = await getModulesState(orgId);
    return NextResponse.json({ id, enabled: parsed.data.enabled, states: refreshed });
  } catch (error) {
    console.error("PATCH /admin/modules/[id] error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
