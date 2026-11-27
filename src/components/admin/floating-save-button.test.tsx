// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminSaveBar } from "./floating-save-button";

describe("AdminSaveBar", () => {
  it("désactive le bouton et masque le témoin quand rien n'a changé", () => {
    render(<AdminSaveBar onSave={vi.fn()} saving={false} isDirty={false} />);

    const button = screen.getByRole("button", { name: /enregistrer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText(/modifications non enregistrées/i)).toBeNull();
  });

  it("active le bouton et affiche le témoin quand il y a des modifications", () => {
    const onSave = vi.fn();
    render(<AdminSaveBar onSave={onSave} saving={false} isDirty title="Paramètres système" />);

    expect(screen.getByText("Paramètres système")).toBeTruthy();
    expect(screen.getByText(/modifications non enregistrées/i)).toBeTruthy();

    const button = screen.getByRole("button", { name: /enregistrer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("affiche l'enregistrement en cours et bloque le bouton pendant la sauvegarde", () => {
    render(<AdminSaveBar onSave={vi.fn()} saving isDirty />);

    expect(screen.getByText(/enregistrement en cours/i)).toBeTruthy();
    expect(screen.queryByText(/modifications non enregistrées/i)).toBeNull();
    const button = screen.getByRole("button", { name: /enregistrer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("garde le bouton actif quand la page ne suit pas les modifications", () => {
    render(<AdminSaveBar onSave={vi.fn()} saving={false} />);

    const button = screen.getByRole("button", { name: /enregistrer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/modifications non enregistrées/i)).toBeNull();
  });

  it("remplace le témoin de modifications par pendingLabel quand il est fourni", () => {
    render(<AdminSaveBar onSave={vi.fn()} saving={false} isDirty pendingLabel="Brouillon modifié à 14:02" />);

    expect(screen.getByText("Brouillon modifié à 14:02")).toBeTruthy();
    expect(screen.queryByText(/modifications non enregistrées/i)).toBeNull();
  });

  it("affiche disabledHint sur le bouton désactivé quand il n'y a pas de modifications", () => {
    render(<AdminSaveBar onSave={vi.fn()} saving={false} isDirty={false} disabledHint="Aucune modification à enregistrer" />);

    const button = screen.getByRole("button", { name: /enregistrer/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Aucune modification à enregistrer");
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
  });
});
