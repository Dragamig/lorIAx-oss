import { describe, it, expect } from "vitest";
import { getAllModuleManifests, getModuleManifests } from "./registry";
import { resolveModuleState } from "./resolve";

describe("registre de modules", () => {
  it("contient meeting-rooms", () => {
    const ids = getModuleManifests().map((m) => m.id);
    expect(ids).toContain("meeting-rooms");
  });
  it("toute dépendance déclarée référence un module connu", () => {
    const manifests = getModuleManifests();
    const ids = new Set(manifests.map((m) => m.id));
    for (const m of manifests) {
      for (const dep of m.dependencies) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });
  it("les ids sont uniques", () => {
    const ids = getModuleManifests().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("les modules séparables déclarent des ownedPaths non vides", () => {
    const SEPARABLE = ["studio", "studiovideo", "ldap", "meeting-rooms", "livekit", "whisper"];
    // Registre statique complet : indépendant du profil de composition (l'édition oss exclut studiovideo).
    const manifests = getAllModuleManifests();
    const byId = new Map<string, (typeof manifests)[number]>(manifests.map((m) => [m.id, m]));
    for (const id of SEPARABLE) {
      const m = byId.get(id);
      expect(m, `manifeste ${id} introuvable`).toBeDefined();
      expect(m!.ownedPaths && m!.ownedPaths.length, `ownedPaths vide pour ${id}`).toBeTruthy();
    }
  });

  it("tout module licensed avec editorExtensions déclare des ownedPaths", () => {
    for (const m of getModuleManifests()) {
      if (m.editorExtensions && m.editorExtensions.length > 0 && m.entitlement === "licensed") {
        expect(m.ownedPaths && m.ownedPaths.length, `ownedPaths manquant pour ${m.id}`).toBeTruthy();
      }
    }
  });

  // Régression : studio/studiovideo étaient "licensed" mais absents de tout plan
  // → jamais entitlés → état "locked" → slash command masquée, seul le tableau
  // blanc (non gaté) restait visible. Doivent être actifs sans licence ni toggle.
  it("studio et studiovideo sont actifs sans licence (canvas gratuits)", () => {
    const manifests = getAllModuleManifests();
    const byId = new Map(manifests.map((m) => [m.id, m]));
    const compiled = new Set(manifests.map((m) => m.id));
    const ctx = { compiled, entitledModuleIds: new Set<string>(), toggles: {} };
    for (const id of ["studio", "studiovideo"] as const) {
      const m = byId.get(id)!;
      expect(m.entitlement, `${id} doit être core`).toBe("core");
      expect(m.defaultEnabled, `${id} doit être activé par défaut`).toBe(true);
      expect(
        resolveModuleState(m, ctx, manifests).status,
        `${id} doit résoudre "active" sans licence`
      ).toBe("active");
    }
  });

  // ── Présentation : le manifeste est la SEULE source de l'écran d'administration
  // « Modules et services ». Ces garde-fous évitent qu'un module nouvellement
  // ajouté n'apparaisse sans icône, sans section ou avec un lien mort, comme
  // c'était le cas de studio, studiovideo et voice-notes, absents des cartes
  // codées en dur de l'ancienne page /admin/services.

  it("tout manifeste déclare sa section, son icône et son rôle habilité", () => {
    for (const m of getModuleManifests()) {
      expect(m.category, `category manquante pour ${m.id}`).toBeTruthy();
      expect(m.icon, `icon manquante pour ${m.id}`).toBeTruthy();
      expect(m.manageRole, `manageRole manquant pour ${m.id}`).toBeTruthy();
    }
  });

  it("les modules soumis à licence restent réservés au super administrateur", () => {
    for (const m of getModuleManifests()) {
      if (m.entitlement === "licensed") {
        expect(m.manageRole, `${m.id} est licensed, il doit rester super_admin`).toBe(
          "super_admin"
        );
      }
    }
  });

  it("toute icône déclarée est distincte d'un module à l'autre", () => {
    // Les modules internes ne sont jamais affichés : leur icône n'a pas à être distincte.
    const icons = getModuleManifests().filter((m) => !m.internal).map((m) => m.icon);
    expect(new Set(icons).size, "deux modules partagent la même icône").toBe(
      icons.length
    );
  });

  it("tout configHref pointe vers une page réellement présente", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const appRoot = join(process.cwd(), "src", "app", "[locale]", "(app)");
    for (const m of getModuleManifests()) {
      if (!m.configHref) continue;
      const [path] = m.configHref.split("#");
      const page = join(appRoot, path, "page.tsx");
      expect(existsSync(page), `configHref mort pour ${m.id} : ${m.configHref}`).toBe(
        true
      );
    }
  });

  it("getModuleManifests ne renvoie que les modules de l'allowlist", async () => {
    const { INCLUDED_MODULE_IDS } = await import("./registry.generated");
    const returned = getModuleManifests().map((m) => m.id).sort();
    expect(returned).toEqual([...INCLUDED_MODULE_IDS].sort());
  });
});
