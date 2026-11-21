/**
 * Garde des modèles de présentation (`src/lib/presentations/template-access.ts`,
 * lot 3bis, tâche T2).
 *
 * Trois propriétés :
 * - lire un modèle est ouvert à tout membre de l'organisation, écrire est
 *   réservé à son administrateur (403 explicite pour un membre) ;
 * - un modèle d'une autre organisation est refusé en 404 muet ;
 * - un module coupé répond 404 avant toute décision de rôle.
 *
 * Les assertions portent sur les effets (contexte rendu, réponse renvoyée,
 * garde de module appelée, `requireOrgScoped` interrogé sans ressource) et pas
 * seulement sur le statut.
 *
 * Preuve par mutation (exécutée, puis restaurée) :
 * - M1 : `requireTemplateAdmin` sans le contrôle `hasGlobalRole`. Échec attendu :
 *   « un membre est refusé en 403 par requireTemplateAdmin ».
 * - M2 : `assertTemplateInOrg` sans la clause d'organisation (rend toujours
 *   `null`). Échec attendu : « rend 404 muet pour un modèle d'une autre organisation ».
 * - M3 : `requireTemplateReader` sans `guardPresentationsModule`. Échec attendu :
 *   « un module coupé répond 404 avant toute décision de rôle ».
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const orgRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/presentations/org-role", () => ({ getOrgMemberRole: orgRole }));

const h = vi.hoisted(() => {
  class OrgScopeError extends Error {
    constructor(
      public readonly response: unknown,
      public readonly reason: string
    ) {
      super(reason);
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(),
    guardPresentationsModule: vi.fn(),
  };
});

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));

vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: h.guardPresentationsModule,
  isPresentationsModuleActive: vi.fn().mockResolvedValue(true),
}));

import { NextResponse } from "next/server";
import {
  requireTemplateReader,
  requireTemplateAdmin,
  requireTemplateAdminFor,
  assertTemplateInOrg,
} from "@/lib/presentations/template-access";

const ORG = "org-acme";

function utilisateur(globalRole: string) {
  return { id: "user-1", globalRole, email: "u@example.test" };
}

function accesOrg(globalRole: string) {
  return {
    user: utilisateur(globalRole),
    orgId: ORG,
    orgSlug: "acme",
  };
}

beforeEach(() => {
  orgRole.mockResolvedValue("member");
  vi.clearAllMocks();
  h.guardPresentationsModule.mockResolvedValue(null);
});

describe("lecture des modèles", () => {
  it("accepte un membre simple et interroge requireOrgScoped sans ressource", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("viewer"));
    const ctx = await requireTemplateReader();
    expect(ctx).not.toBeInstanceOf(NextResponse);
    expect(ctx).toMatchObject({ orgId: ORG });
    expect(h.requireOrgScoped).toHaveBeenCalledTimes(1);
    expect(h.requireOrgScoped.mock.calls[0][0].resource).toBeUndefined();
    expect(h.guardPresentationsModule).toHaveBeenCalledWith(utilisateur("viewer"));
  });

  it("renvoie le refus de requireOrgScoped tel quel", async () => {
    h.requireOrgScoped.mockRejectedValue(
      new h.OrgScopeError(NextResponse.json({ error: "Non connecté" }, { status: 401 }), "unauthenticated")
    );
    const res = await requireTemplateReader();
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("un module coupé répond 404 avant toute décision de rôle", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("admin"));
    h.guardPresentationsModule.mockResolvedValue(
      NextResponse.json({ error: "Introuvable" }, { status: 404 })
    );
    const res = await requireTemplateReader();
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(404);
    expect(await (res as NextResponse).json()).toEqual({ error: "Introuvable" });
  });
});

describe("écriture des modèles", () => {
  it("refuse un membre en 403 explicite par requireTemplateAdmin", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("viewer"));
    const res = await requireTemplateAdmin();
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
    expect(await (res as NextResponse).json()).toEqual({
      error: "Réservé aux administrateurs de l'organisation",
    });
  });

  it("accepte un administrateur d'organisation par requireTemplateAdmin", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("admin"));
    const ctx = await requireTemplateAdmin();
    expect(ctx).not.toBeInstanceOf(NextResponse);
    expect(ctx).toMatchObject({ orgId: ORG });
  });

  it("accepte un administrateur d'organisation par requireTemplateReader", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("admin"));
    const ctx = await requireTemplateReader();
    expect(ctx).not.toBeInstanceOf(NextResponse);
  });

  it("un membre est accepté par requireTemplateReader et refusé par requireTemplateAdmin", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("editor"));
    const lecteur = await requireTemplateReader();
    const admin = await requireTemplateAdmin();
    expect(lecteur).not.toBeInstanceOf(NextResponse);
    expect(admin).toBeInstanceOf(NextResponse);
    expect((admin as NextResponse).status).toBe(403);
  });

  it("un module coupé répond 404 à requireTemplateAdmin, sans 403", async () => {
    h.requireOrgScoped.mockResolvedValue(accesOrg("viewer"));
    h.guardPresentationsModule.mockResolvedValue(
      NextResponse.json({ error: "Introuvable" }, { status: 404 })
    );
    const res = await requireTemplateAdmin();
    expect((res as NextResponse).status).toBe(404);
  });
});

describe("rôle borné à l'organisation (I1)", () => {
  it("admin global sans ligne d'appartenance : lecture ouverte, écriture en 404", async () => {
    orgRole.mockResolvedValue(null);
    h.requireOrgScoped.mockResolvedValue(accesOrg("admin"));
    const lecteur = await requireTemplateReader();
    expect(lecteur).toMatchObject({ isMember: false, canManage: false });
    const res = await requireTemplateAdmin();
    expect((res as NextResponse).status).toBe(404);
  });

  it("propriétaire d'organisation avec rôle global editor : gère les modèles", async () => {
    orgRole.mockResolvedValue("owner");
    h.requireOrgScoped.mockResolvedValue(accesOrg("editor"));
    const ctx = await requireTemplateAdmin();
    expect(ctx).toMatchObject({ isMember: true, canManage: true });
  });

  it("super_admin franchit la frontière sans ligne d'appartenance", async () => {
    orgRole.mockResolvedValue(null);
    h.requireOrgScoped.mockResolvedValue(accesOrg("super_admin"));
    const ctx = await requireTemplateAdmin();
    expect(ctx).toMatchObject({ canManage: true });
  });

  it("requireTemplateAdminFor : autre organisation en 404 avant le rôle en 403", async () => {
    orgRole.mockResolvedValue("member");
    h.requireOrgScoped.mockResolvedValue(accesOrg("editor"));
    const dehors = await requireTemplateAdminFor({ organizationId: "org-autre" });
    expect((dehors as NextResponse).status).toBe(404);
    const dedans = await requireTemplateAdminFor({ organizationId: ORG });
    expect((dedans as NextResponse).status).toBe(403);
  });
});

describe("cloisonnement par organisation", () => {
  it("rend 404 muet pour un modèle d'une autre organisation, sans indice", async () => {
    const res = assertTemplateInOrg({ organizationId: "org-autre" }, ORG);
    expect(res).toBeInstanceOf(NextResponse);
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: "Introuvable" });
  });

  it("rend 404 pour un modèle sans organisation (présentation ordinaire)", async () => {
    const res = assertTemplateInOrg({ organizationId: null }, ORG);
    expect(res!.status).toBe(404);
  });

  it("laisse passer un modèle de l'organisation courante", () => {
    expect(assertTemplateInOrg({ organizationId: ORG }, ORG)).toBeNull();
  });
});
