import { describe, it, expect } from "vitest";
import {
  canViewSpaceContents,
  type SpaceViewFacts,
  type SpaceViewMode,
} from "@/lib/auth/space-access";
import { canViewByClassification } from "@/lib/auth/rbac";
import {
  isClassificationAllowed,
  enforceClassificationFloor,
  compareClassifications,
} from "@/lib/auth/classification";

/**
 * Faits par defaut : un compte `editor` sans le moindre lien avec l'espace vise,
 * dans un espace d'equipe `internal` de l'organisation courante.
 */
function facts(overrides: Partial<SpaceViewFacts> = {}): SpaceViewFacts {
  return {
    userGlobalRole: "editor",
    spaceType: "team",
    spaceClassification: "internal",
    isSpaceOwner: false,
    hasDirectPermission: false,
    hasTeamPermission: false,
    isOwningTeamMember: false,
    isRequestOrganization: true,
    ...overrides,
  };
}

const MODES: SpaceViewMode[] = ["app", "member", "publicApi"];

describe("canViewSpaceContents — refus par defaut", () => {
  it("un compte sans aucun lien avec l'espace est refuse dans les trois modes", () => {
    for (const mode of MODES) {
      expect(canViewSpaceContents(facts(), mode)).toBe(false);
    }
  });
});

describe("canViewSpaceContents — liens explicites", () => {
  it("le proprietaire lit l'espace dans les trois modes", () => {
    for (const mode of MODES) {
      expect(canViewSpaceContents(facts({ isSpaceOwner: true }), mode)).toBe(true);
    }
  });

  it("une permission directe suffit dans les trois modes", () => {
    for (const mode of MODES) {
      expect(canViewSpaceContents(facts({ hasDirectPermission: true }), mode)).toBe(true);
    }
  });

  it("une permission d'equipe vaut dans l'application, pas dans l'API publique", () => {
    const f = facts({ hasTeamPermission: true });
    expect(canViewSpaceContents(f, "app")).toBe(true);
    expect(canViewSpaceContents(f, "member")).toBe(true);
    expect(canViewSpaceContents(f, "publicApi")).toBe(false);
  });

  it("un admin global lit l'espace dans les trois modes", () => {
    for (const mode of MODES) {
      expect(canViewSpaceContents(facts({ userGlobalRole: "admin" }), mode)).toBe(true);
      expect(canViewSpaceContents(facts({ userGlobalRole: "super_admin" }), mode)).toBe(true);
    }
  });
});

/**
 * Ces cas verrouillent l'ORDRE des branches. Deplacer la coupure `secret` avant les
 * permissions explicites ejecterait les membres nommes ; la deplacer apres la branche
 * `organization` ouvrirait tous les espaces secrets d'organisation.
 */
describe("canViewSpaceContents — ordre des branches autour de `secret`", () => {
  it("un membre nomme d'un espace secret le voit encore (permission avant la coupure)", () => {
    const f = facts({ spaceClassification: "secret", hasDirectPermission: true });
    expect(canViewSpaceContents(f, "app")).toBe(true);
    expect(canViewSpaceContents(f, "member")).toBe(true);
  });

  it("le proprietaire d'un espace secret le voit encore dans l'application", () => {
    expect(
      canViewSpaceContents(facts({ spaceClassification: "secret", isSpaceOwner: true }), "app")
    ).toBe(true);
  });

  it("un espace secret d'organisation reste ferme a l'appartenance implicite", () => {
    const f = facts({ spaceType: "organization", spaceClassification: "secret" });
    expect(canViewSpaceContents(f, "app")).toBe(false);
  });

  it("un espace secret d'equipe reste ferme au simple membre de l'equipe proprietaire", () => {
    const f = facts({ spaceClassification: "secret", isOwningTeamMember: true });
    expect(canViewSpaceContents(f, "app")).toBe(false);
  });

  it("l'API publique masque les espaces secret meme a leur proprietaire", () => {
    const f = facts({ spaceClassification: "secret", isSpaceOwner: true });
    expect(canViewSpaceContents(f, "publicApi")).toBe(false);
    expect(
      canViewSpaceContents({ ...f, hasDirectPermission: true }, "publicApi")
    ).toBe(false);
  });

  it("l'API publique sert un espace secret a un admin global", () => {
    const f = facts({ spaceClassification: "secret", userGlobalRole: "admin" });
    expect(canViewSpaceContents(f, "publicApi")).toBe(true);
  });
});

describe("canViewSpaceContents — appartenance implicite", () => {
  it("un espace d'organisation est lisible dans l'application, pas ailleurs", () => {
    const f = facts({ spaceType: "organization" });
    expect(canViewSpaceContents(f, "app")).toBe(true);
    expect(canViewSpaceContents(f, "member")).toBe(false);
    expect(canViewSpaceContents(f, "publicApi")).toBe(false);
  });

  it("le membre de l'equipe proprietaire lit l'espace dans l'application seulement", () => {
    const f = facts({ isOwningTeamMember: true });
    expect(canViewSpaceContents(f, "app")).toBe(true);
    expect(canViewSpaceContents(f, "member")).toBe(false);
    expect(canViewSpaceContents(f, "publicApi")).toBe(false);
  });

  it("les branches implicites sont bornees a l'organisation de la requete", () => {
    expect(
      canViewSpaceContents(
        facts({ spaceType: "organization", isRequestOrganization: false }),
        "app"
      )
    ).toBe(false);
    expect(
      canViewSpaceContents(
        facts({ isOwningTeamMember: true, isRequestOrganization: false }),
        "app"
      )
    ).toBe(false);
  });

  it("la borne d'organisation ne penalise ni le proprietaire ni le membre nomme", () => {
    expect(
      canViewSpaceContents(
        facts({ spaceType: "organization", isRequestOrganization: false, isSpaceOwner: true }),
        "app"
      )
    ).toBe(true);
    expect(
      canViewSpaceContents(
        facts({
          spaceType: "organization",
          isRequestOrganization: false,
          hasDirectPermission: true,
        }),
        "app"
      )
    ).toBe(true);
  });

  it("le mode `member` refuse toute appartenance implicite, y compris hors secret", () => {
    expect(
      canViewSpaceContents(facts({ spaceType: "organization", spaceClassification: "public" }), "member")
    ).toBe(false);
  });
});

/**
 * Les trois scenarios d'exfiltration fermes par le lot P1-A, exprimes au niveau des
 * regles pures sur lesquelles les routes s'appuient.
 */
describe("scenarios d'exfiltration fermes par le lot P1-A", () => {
  // Un editeur d'espace, ni auteur ni admin d'espace, ne lit pas un document `secret`.
  const blindEditor = {
    isAuthenticated: true,
    isSpaceMember: true,
    isSpaceAdmin: false,
    isDocumentAuthor: false,
    userGlobalRole: "editor" as const,
  };

  it("copie : l'editeur aveugle est refuse en lecture sur le document secret source", () => {
    expect(canViewByClassification("secret", blindEditor)).toBe(false);
  });

  it("copie et deplacement : le niveau ne peut pas descendre sous le plancher de la cible", () => {
    expect(enforceClassificationFloor("public", "confidential")).toBe("confidential");
    expect(enforceClassificationFloor("internal", "secret")).toBe("secret");
    // Un niveau deja au-dessus du plancher est conserve tel quel.
    expect(enforceClassificationFloor("secret", "public")).toBe("secret");
    expect(enforceClassificationFloor("confidential", "confidential")).toBe("confidential");
  });

  it("enforceClassificationFloor ne peut jamais abaisser un niveau", () => {
    const levels = ["public", "internal", "confidential", "secret"] as const;
    for (const doc of levels) {
      for (const space of levels) {
        const result = enforceClassificationFloor(doc, space);

        // La propriete qui compte : le resultat est TOUJOURS au moins aussi protege
        // que le document d'origine. Elle seule attrape une implementation qui
        // retournerait systematiquement la classification de l'espace, laquelle
        // declasserait un document `secret` deplace vers un espace `public`.
        expect(compareClassifications(result, doc)).toBeGreaterThanOrEqual(0);

        // Et le plancher de l'espace est respecte.
        expect(isClassificationAllowed(result, space)).toBe(true);

        // Le relevement reste minimal : jamais plus haut que necessaire.
        expect([doc, space]).toContain(result);
      }
    }
  });

  it("creation : un document public est refuse dans un espace confidential", () => {
    expect(isClassificationAllowed("public", "confidential")).toBe(false);
    expect(isClassificationAllowed("confidential", "confidential")).toBe(true);
    expect(isClassificationAllowed("secret", "confidential")).toBe(true);
  });

  it("deplacement : posseder l'espace cible ne donne pas la lecture du document deplace", () => {
    // Le controle de lecture porte sur le document dans son espace d'ORIGINE, ou le
    // court-circuit « proprietaire de l'espace » de checkDocumentViewAccess ne joue pas.
    expect(canViewByClassification("secret", blindEditor)).toBe(false);
    // Le meme utilisateur, auteur du document, le lit legitimement.
    expect(
      canViewByClassification("secret", { ...blindEditor, isDocumentAuthor: true })
    ).toBe(true);
  });
});
