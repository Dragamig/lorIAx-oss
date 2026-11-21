// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceNoteActionsDialog } from "./voice-note-actions-dialog";

describe("VoiceNoteActionsDialog", () => {
  it("propose toutes les actions cochées et éditables par défaut", () => {
    render(
      <VoiceNoteActionsDialog
        actions={["Relancer le fournisseur", "Préparer le budget"]}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((box) => box.checked)).toBe(true);
    expect(screen.getByDisplayValue("Relancer le fournisseur")).toBeTruthy();
    expect(screen.getByDisplayValue("Préparer le budget")).toBeTruthy();
  });

  it("exclut du résultat une ligne décochée", () => {
    const onConfirm = vi.fn();
    render(
      <VoiceNoteActionsDialog
        actions={["Relancer le fournisseur", "Préparer le budget"]}
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByRole("button", { name: /Créer/ }));
    expect(onConfirm).toHaveBeenCalledWith(["Relancer le fournisseur"]);
  });

  it("normalise les espaces des intitulés retenus", () => {
    const onConfirm = vi.fn();
    render(
      <VoiceNoteActionsDialog
        actions={["  Relancer   le fournisseur  "]}
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Créer/ }));
    expect(onConfirm).toHaveBeenCalledWith(["Relancer le fournisseur"]);
  });

  it("désactive la confirmation quand tout est décoché", () => {
    render(
      <VoiceNoteActionsDialog
        actions={["Relancer le fournisseur", "Préparer le budget"]}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes.forEach((box) => fireEvent.click(box));

    const confirmButton = screen.getByRole("button", { name: /Créer/ }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it("désactive la confirmation quand les lignes cochées sont toutes vides", () => {
    render(
      <VoiceNoteActionsDialog
        actions={["Relancer le fournisseur"]}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    const input = screen.getByDisplayValue("Relancer le fournisseur");
    fireEvent.change(input, { target: { value: "   " } });

    const confirmButton = screen.getByRole("button", { name: /Créer/ }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });
});
