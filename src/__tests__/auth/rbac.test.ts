import { describe, it, expect } from "vitest";
import {
  canViewDocument,
  canEditDocument,
  canAdminSpace,
  canViewByClassification,
  canManageTemplateCategory,
  canManageMeetingRooms,
  canManageAutomations,
  canAccessAdminArea,
  hasCapability,
  hasGlobalRole,
  hasPermissionLevel,
} from "@/lib/auth/rbac";

describe("hasGlobalRole", () => {
  it("super_admin a tous les rôles", () => {
    expect(hasGlobalRole("super_admin", "viewer")).toBe(true);
    expect(hasGlobalRole("super_admin", "editor")).toBe(true);
    expect(hasGlobalRole("super_admin", "admin")).toBe(true);
    expect(hasGlobalRole("super_admin", "super_admin")).toBe(true);
  });

  it("viewer ne peut pas être admin", () => {
    expect(hasGlobalRole("viewer", "admin")).toBe(false);
    expect(hasGlobalRole("viewer", "editor")).toBe(false);
  });
});

describe("hasPermissionLevel", () => {
  it("admin inclut editor et viewer", () => {
    expect(hasPermissionLevel("admin", "viewer")).toBe(true);
    expect(hasPermissionLevel("admin", "editor")).toBe(true);
    expect(hasPermissionLevel("admin", "admin")).toBe(true);
  });

  it("viewer ne peut pas être editor", () => {
    expect(hasPermissionLevel("viewer", "editor")).toBe(false);
  });
});

describe("canViewDocument", () => {
  it("admin global peut tout voir", () => {
    expect(canViewDocument("admin", null, null)).toBe(true);
    expect(canViewDocument("super_admin", null, null)).toBe(true);
  });

  it("viewer sans permission espace ne peut pas voir", () => {
    expect(canViewDocument("viewer", null, null)).toBe(false);
  });

  it("viewer avec permission espace viewer peut voir", () => {
    expect(canViewDocument("viewer", "viewer", null)).toBe(true);
  });

  it("permission document prime sur permission espace", () => {
    expect(canViewDocument("viewer", null, "viewer")).toBe(true);
  });
});

describe("canEditDocument", () => {
  it("admin global peut tout éditer", () => {
    expect(canEditDocument("admin", null, null)).toBe(true);
  });

  it("viewer ne peut pas éditer", () => {
    expect(canEditDocument("viewer", "viewer", null)).toBe(false);
  });

  it("editor avec permission espace editor peut éditer", () => {
    expect(canEditDocument("viewer", "editor", null)).toBe(true);
  });

  it("permission document editor donne accès", () => {
    expect(canEditDocument("viewer", null, "editor")).toBe(true);
  });
});

describe("canAdminSpace", () => {
  it("admin global peut administrer", () => {
    expect(canAdminSpace("admin")).toBe(true);
  });

  it("viewer ne peut pas administrer", () => {
    expect(canAdminSpace("viewer", "viewer")).toBe(false);
  });

  it("permission espace admin donne accès", () => {
    expect(canAdminSpace("viewer", "admin")).toBe(true);
  });
});

describe("canViewByClassification", () => {
  const baseOptions = {
    isAuthenticated: true,
    isSpaceMember: false,
    isSpaceAdmin: false,
    isDocumentAuthor: false,
    userGlobalRole: "viewer" as const,
  };

  it("public est visible par tous", () => {
    expect(canViewByClassification("public", { ...baseOptions, isAuthenticated: false })).toBe(true);
  });

  it("internal nécessite authentification", () => {
    expect(canViewByClassification("internal", { ...baseOptions, isAuthenticated: false })).toBe(false);
    expect(canViewByClassification("internal", baseOptions)).toBe(true);
  });

  it("confidential nécessite membership espace", () => {
    expect(canViewByClassification("confidential", baseOptions)).toBe(false);
    expect(canViewByClassification("confidential", { ...baseOptions, isSpaceMember: true })).toBe(true);
  });

  it("secret nécessite auteur ou admin espace", () => {
    expect(canViewByClassification("secret", { ...baseOptions, isSpaceMember: true })).toBe(false);
    expect(canViewByClassification("secret", { ...baseOptions, isDocumentAuthor: true })).toBe(true);
    expect(canViewByClassification("secret", { ...baseOptions, isSpaceAdmin: true })).toBe(true);
  });

  it("admin global a accès à tout", () => {
    expect(
      canViewByClassification("secret", { ...baseOptions, userGlobalRole: "admin" })
    ).toBe(true);
  });
});

describe("canManageTemplateCategory (legacy — anciens rôles parallèles migrés en badges)", () => {
  it("admin et super_admin gèrent toutes les catégories", () => {
    expect(canManageTemplateCategory("admin", [], "design")).toBe(true);
    expect(canManageTemplateCategory("admin", [], "rapport")).toBe(true);
    expect(canManageTemplateCategory("admin", [], null)).toBe(true);
    expect(canManageTemplateCategory("super_admin", [], "design")).toBe(true);
  });

  it("badge template_graphic_editor ne gère que la catégorie design", () => {
    expect(canManageTemplateCategory("editor", ["template_graphic_editor"], "design")).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_graphic_editor"], "rapport")).toBe(false);
    expect(canManageTemplateCategory("editor", ["template_graphic_editor"], null)).toBe(false);
  });

  it("badge template_doc_editor gère tout sauf design", () => {
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], "rapport")).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], null)).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], undefined)).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], "design")).toBe(false);
  });

  it("les rôles sans badge sont refusés", () => {
    expect(canManageTemplateCategory("editor", [], "rapport")).toBe(false);
    expect(canManageTemplateCategory("viewer", [], "design")).toBe(false);
    expect(canManageTemplateCategory("editor", ["automation_manager"], "rapport")).toBe(false);
  });
});

describe("hasCapability", () => {
  it("retourne false sur null/undefined/[]", () => {
    expect(hasCapability(null, "facility_manager")).toBe(false);
    expect(hasCapability(undefined, "facility_manager")).toBe(false);
    expect(hasCapability([], "facility_manager")).toBe(false);
  });
  it("détecte un badge présent", () => {
    expect(hasCapability(["facility_manager"], "facility_manager")).toBe(true);
    expect(hasCapability(["automation_manager"], "facility_manager")).toBe(false);
  });
});

describe("canManageMeetingRooms (socle + badge)", () => {
  it("editor sans badge ne gère pas les salles", () => {
    expect(canManageMeetingRooms("editor", [])).toBe(false);
  });
  it("editor avec badge facility_manager gère les salles", () => {
    expect(canManageMeetingRooms("editor", ["facility_manager"])).toBe(true);
  });
  it("admin gère les salles sans badge", () => {
    expect(canManageMeetingRooms("admin", [])).toBe(true);
    expect(canManageMeetingRooms("super_admin", [])).toBe(true);
  });
});

describe("canManageAutomations (socle + badge)", () => {
  it("editor sans badge ne gère pas les automatisations", () => {
    expect(canManageAutomations("editor", [])).toBe(false);
  });
  it("editor avec badge automation_manager gère les automatisations", () => {
    expect(canManageAutomations("editor", ["automation_manager"])).toBe(true);
  });
  it("admin gère les automatisations sans badge", () => {
    expect(canManageAutomations("admin", [])).toBe(true);
  });
});

describe("canManageTemplateCategory (socle + badges)", () => {
  it("editor sans badge ne gère aucun modèle", () => {
    expect(canManageTemplateCategory("editor", [], "design")).toBe(false);
    expect(canManageTemplateCategory("editor", [], "note")).toBe(false);
  });
  it("badge graphique <-> catégorie design uniquement", () => {
    expect(canManageTemplateCategory("editor", ["template_graphic_editor"], "design")).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_graphic_editor"], "note")).toBe(false);
  });
  it("badge doc <-> toutes catégories sauf design", () => {
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], "note")).toBe(true);
    expect(canManageTemplateCategory("editor", ["template_doc_editor"], "design")).toBe(false);
  });
  it("admin gère toutes catégories sans badge", () => {
    expect(canManageTemplateCategory("admin", [], "design")).toBe(true);
    expect(canManageTemplateCategory("admin", [], "note")).toBe(true);
  });
  it("badges cumulés : doc + graphique gèrent tout", () => {
    const caps = ["template_doc_editor", "template_graphic_editor"] as const;
    expect(canManageTemplateCategory("editor", [...caps], "design")).toBe(true);
    expect(canManageTemplateCategory("editor", [...caps], "note")).toBe(true);
  });
});

describe("canAccessAdminArea (entrée /admin)", () => {
  it("admin et super_admin accèdent toujours", () => {
    expect(canAccessAdminArea("admin", [])).toBe(true);
    expect(canAccessAdminArea("super_admin", [])).toBe(true);
  });
  it("badge facility_manager ou éditeur de templates ouvre l'admin", () => {
    expect(canAccessAdminArea("editor", ["facility_manager"])).toBe(true);
    expect(canAccessAdminArea("editor", ["template_doc_editor"])).toBe(true);
    expect(canAccessAdminArea("viewer", ["template_graphic_editor"])).toBe(true);
  });
  it("automation_manager seul n'ouvre PAS l'admin (géré par base)", () => {
    expect(canAccessAdminArea("editor", ["automation_manager"])).toBe(false);
  });
  it("editor/viewer sans badge pertinent n'accèdent pas", () => {
    expect(canAccessAdminArea("editor", [])).toBe(false);
    expect(canAccessAdminArea("viewer", [])).toBe(false);
  });
});
