import { describe, it, expect, vi } from "vitest";
import { buildBindingPayload } from "@/lib/automations/template-variables";
import { interpolate } from "@/lib/automations/interpolate";

// Le template builtin est mocké pour porter un placeholder nu `{{titre}}` :
// aucun builtin réel n'en contient, or on veut prouver que `instantiateTemplate`
// transmet bien `opts.extra` à `interpolate` (résolution du binding).
vi.mock("@/lib/templates/builtin", () => ({
  getBuiltinTemplateById: (id: string) =>
    id === "builtin_test_binding"
      ? { name: "T", content: { markdown: "Titre : {{titre}}" } }
      : null,
}));

import { instantiateTemplate } from "@/lib/templates/instantiate";

describe("buildBindingPayload", () => {
  const ctx = {
    cells: { col_prenom: "Alice" },
    user: { id: "u1", email: "a@b.fr", name: "Alice B" },
    variables: { doc: { title: "Rapport" } },
  };

  it("résout une source colonne, user, variable et statique", () => {
    const payload = buildBindingPayload(
      {
        prenom: { kind: "cells", ref: "col_prenom" },
        auteur: { kind: "user", ref: "name" },
        titre: { kind: "variables", ref: "doc.title" },
        mention: { kind: "static", ref: "Confidentiel" },
      },
      ctx
    );
    expect(payload).toEqual({
      prenom: "Alice",
      auteur: "Alice B",
      titre: "Rapport",
      mention: "Confidentiel",
    });
  });

  it("valeur absente → chaîne vide", () => {
    expect(buildBindingPayload({ x: { kind: "cells", ref: "absent" } }, ctx)).toEqual({ x: "" });
  });
});

describe("interpolate — canal extra", () => {
  it("résout une clé nue via extra avant le fallback vide", () => {
    expect(interpolate("Bonjour {{prenom}}", {}, { prenom: "Alice" })).toBe("Bonjour Alice");
  });

  it("préserve le fallback vide si la clé n'est ni connue ni dans extra", () => {
    expect(interpolate("X{{inconnu}}Y", {}, { autre: "z" })).toBe("XY");
  });

  it("rétro-compatible : sans extra, comportement inchangé", () => {
    expect(interpolate("Nom {{user.name}}", { user: { name: "Bob" } })).toBe("Nom Bob");
    expect(interpolate("Vide {{libre}}", {})).toBe("Vide ");
  });

  it("les clés connues du payload priment sur extra", () => {
    expect(interpolate("{{user.name}}", { user: { name: "Bob" } }, { "user.name": "Ignoré" })).toBe(
      "Bob"
    );
  });
});

describe("instantiateTemplate — bindings résolus via extra", () => {
  it("substitue un placeholder nu du template par la valeur bindée (extra)", async () => {
    const extra = buildBindingPayload({ titre: { kind: "static", ref: "Rapport Q2" } }, {});
    const tpl = await instantiateTemplate("builtin_test_binding", {}, { extra });
    expect(tpl.markdown).toBe("Titre : Rapport Q2");
  });

  it("placeholder non bindé → reste vide (activable plus tard)", async () => {
    const tpl = await instantiateTemplate("builtin_test_binding", {}, {});
    expect(tpl.markdown).toBe("Titre : ");
  });
});
