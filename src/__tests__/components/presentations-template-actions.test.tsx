// @vitest-environment jsdom
/**
 * T8 : registre central d'actions et composants de base des modèles.
 * Preuve par mutation : retirer `aria-label` ou `Hint` de
 * `template-action-button.tsx`, ou changer une classe de dimension de
 * `TemplateTileSkeleton`, fait échouer ce test (vérifié).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import fr from "../../../messages/fr.json";
import { renderWithIntl } from "./support/render-intl";
import {
  TEMPLATE_ACTIONS,
  actionsForRole,
  getActionKeys,
} from "@/components/presentations/templates/template-actions";
import { TemplateActionButton } from "@/components/presentations/templates/template-action-button";
import { TemplateBadge } from "@/components/presentations/templates/template-badge";
import {
  TemplateTile,
  TemplateTileSkeleton,
} from "@/components/presentations/templates/template-tile";

afterEach(cleanup);

const tpl = (fr as unknown as { presentations: { templates: Record<string, string> } })
  .presentations.templates;

describe("registre des actions", () => {
  it("chaque action a un id unique, une icône et des clés i18n existantes", () => {
    const ids = TEMPLATE_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of TEMPLATE_ACTIONS) {
      expect(a.icon, a.id).toBeTruthy();
      expect(tpl[a.labelKey], `${a.id} label`).toBeTruthy();
      expect(tpl[a.tipKey], `${a.id} tip`).toBeTruthy();
      for (const k of [a.toastSuccessKey, a.toastErrorKey]) if (k) expect(tpl[k], k).toBeTruthy();
      for (const v of Object.values(a.variants ?? {})) {
        expect(tpl[v.labelKey]).toBeTruthy();
        expect(tpl[v.tipKey]).toBeTruthy();
      }
    }
  });

  it("retirer et masquer sont une seule action à deux libellés", () => {
    expect(TEMPLATE_ACTIONS.filter((a) => a.id === "hide")).toHaveLength(1);
    expect(getActionKeys("hide").labelKey).toBe("hideTemplate");
    expect(getActionKeys("hide", "remove").labelKey).toBe("removeTemplate");
  });

  it("les actions réservées admin disparaissent pour un membre", () => {
    const member = actionsForRole(false).map((a) => a.id);
    expect(member).toEqual(expect.arrayContaining(["use", "preview", "newPresentation"]));
    expect(member).not.toContain("hide");
    expect(actionsForRole(true)).toHaveLength(TEMPLATE_ACTIONS.length);
  });
});

describe("TemplateActionButton", () => {
  it.each(TEMPLATE_ACTIONS.map((a) => a.id))(
    "%s : icône, aria-label, info-bulle au survol et au focus, clic",
    (id) => {
      const onClick = vi.fn();
      renderWithIntl(
        id === "preview" ? (
          <TemplateActionButton action={id} onClick={onClick} values={{ name: "Pitch" }} />
        ) : (
          <TemplateActionButton action={id} onClick={onClick} />
        )
      );
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("aria-label")).toBeTruthy();
      expect(btn.querySelector("svg")).toBeTruthy();
      expect(screen.queryByRole("tooltip", { hidden: false })).toBeNull();
      fireEvent.mouseEnter(btn.parentElement as HTMLElement);
      expect(screen.getByRole("tooltip").textContent).toBeTruthy();
      fireEvent.mouseLeave(btn.parentElement as HTMLElement);
      fireEvent.focus(btn);
      expect(screen.getByRole("tooltip")).toBeTruthy();
      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  );

  it("un bouton désactivé explique pourquoi dans son info-bulle", () => {
    const { container } = renderWithIntl(
      <TemplateActionButton action="reset" disabledReason="Réservé aux administrateurs" />
    );
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.focus(container.firstElementChild as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Réservé aux administrateurs");
  });

  it("le bouton porte un focus visible et une cible d'au moins 24 px", () => {
    renderWithIntl(<TemplateActionButton action="edit" />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("focus-visible:ring");
    expect(cls).toContain("min-h-6");
    expect(cls).toContain("min-w-6");
  });
});

describe("TemplateBadge", () => {
  it("affiche LorIAx, Organisation et Masqué", () => {
    const { container } = renderWithIntl(
      <>
        <TemplateBadge kind="lorIAx" />
        <TemplateBadge kind="org" />
        <TemplateBadge kind="hidden" />
      </>
    );
    const texts = [...container.querySelectorAll("[data-template-badge]")].map((e) => e.textContent);
    expect(texts).toEqual([tpl.badgeLorIAx, tpl.badgeOrg, tpl.badgeHidden]);
  });
});

describe("TemplateTile", () => {
  it("toutes les tuiles rendues ont les mêmes classes de dimension", () => {
    const { container } = renderWithIntl(
      <>
        <TemplateTile title="Court" tip="Aperçu Court" badge="lorIAx" />
        <TemplateTile
          title="Un titre extrêmement long qui doit être tronqué et ne jamais changer la hauteur"
          subtitle="Un sous-titre tout aussi long pour vérifier la troncature du pied de tuile"
          tip="Aperçu long"
          badge="org"
          selected
        />
        <TemplateTile title="Vierge" tip="Vierge" blank />
        <TemplateTileSkeleton />
      </>
    );
    const tiles = [...container.querySelectorAll("[data-template-tile]")] as HTMLElement[];
    expect(tiles).toHaveLength(4);
    const dims = (el: HTMLElement) =>
      el.className.split(/\s+/).filter((c) => /^(h|w|min-h|max-h)-/.test(c)).sort().join(" ");
    const ref = dims(tiles[0]);
    expect(ref).toContain("h-56");
    for (const t of tiles) expect(dims(t)).toBe(ref);
    const foots = tiles.map((t) => t.children[1] as HTMLElement);
    for (const f of foots) {
      expect(f.className).toContain("h-16");
      expect(f.className).toContain("overflow-hidden");
    }
    expect(tiles[1].querySelector(".truncate")).toBeTruthy();
  });

  it("la tuile a un aria-label, une info-bulle au focus et un focus visible", () => {
    renderWithIntl(<TemplateTile title="Pitch" tip="Aperçu du modèle Pitch" />);
    const btn = screen.getByRole("button", { name: "Pitch" });
    expect(btn.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip", { hidden: true }).id);
    expect(btn.querySelector("div")).toBeNull();
    expect(btn.className).toContain("focus-visible:ring");
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip").textContent).toBe("Aperçu du modèle Pitch");
  });
});
