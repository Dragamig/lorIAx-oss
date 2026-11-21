// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ClassificationSelector } from "./classification-selector";
import {
  getAllowedDocClassifications,
  canShareExternally,
} from "@/lib/auth/classification";

afterEach(cleanup);

const ALL = ["public", "internal", "confidential", "secret"] as const;

function setup(
  props: Partial<React.ComponentProps<typeof ClassificationSelector>> = {},
) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ClassificationSelector
      current="internal"
      allowedLevels={[...ALL]}
      onChange={onChange}
      open
      onClose={onClose}
      {...props}
    />,
  );
  return { onChange, onClose };
}

function option(label: string) {
  return screen.getByText(label).closest("button") as HTMLButtonElement;
}

describe("ClassificationSelector", () => {
  it("ne rend rien quand il est fermé", () => {
    const { container } = render(
      <ClassificationSelector
        current="public"
        allowedLevels={[...ALL]}
        onChange={vi.fn()}
        open={false}
        onClose={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("propose les quatre niveaux", () => {
    setup();
    for (const label of ["Public", "Interne", "Confidentiel", "Secret"]) {
      expect(option(label)).toBeTruthy();
    }
  });

  it("change de niveau, notifie le parent et se ferme", () => {
    const { onChange, onClose } = setup();
    fireEvent.click(option("Confidentiel"));
    expect(onChange).toHaveBeenCalledWith("confidential");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("désactive les niveaux non autorisés par l'espace et ignore leur clic", () => {
    const { onChange, onClose } = setup({
      current: "confidential",
      allowedLevels: getAllowedDocClassifications("confidential"),
    });
    expect(option("Public").disabled).toBe(true);
    expect(option("Interne").disabled).toBe(true);
    expect(option("Confidentiel").disabled).toBe(false);
    expect(option("Secret").disabled).toBe(false);
    fireEvent.click(option("Public"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getAllByText("Non autorisé par la classification de l'espace"),
    ).toHaveLength(2);
  });

  it("n'affiche le repère actif que sur le niveau courant", () => {
    setup({ current: "secret" });
    expect(option("Secret").querySelector("svg.text-primary")).toBeTruthy();
    expect(option("Public").querySelector("svg.text-primary")).toBeNull();
  });

  it("se ferme au clic hors du panneau mais pas à l'intérieur", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByText("Classification du document"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("liste vide (aucun droit) : tous les niveaux sont désactivés", () => {
    const { onChange } = setup({ allowedLevels: [] });
    for (const label of ["Public", "Interne", "Confidentiel", "Secret"]) {
      expect(option(label).disabled).toBe(true);
    }
    fireEvent.click(option("Interne"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.todo(
    "lecture seule : le bandeau (document-page-client.tsx) ne grise pas le sélecteur, aucune prop de droit n'existe",
  );
});

describe("règles de classification du bandeau", () => {
  it("le plafond de l'espace filtre les niveaux proposés", () => {
    expect(getAllowedDocClassifications("public")).toEqual([...ALL]);
    expect(getAllowedDocClassifications("secret")).toEqual(["secret"]);
  });

  it("le partage externe exige document ET espace publics", () => {
    expect(canShareExternally("public", "public")).toBe(true);
    expect(canShareExternally("internal", "public")).toBe(false);
    expect(canShareExternally("public", "internal")).toBe(false);
  });
});

describe("partage externe (SharePopover)", () => {
  it.todo(
    "ouverture, création de lien (POST), révocation (DELETE), état désactivé : SharePopover n'est pas exporté de document-page-client.tsx, non testable sans modifier le code produit",
  );
});
