// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteColumnDialog } from "../delete-column-dialog";
import type { PairingInfo } from "../relation-pairing";

const paired: PairingInfo = {
  kind: "paired",
  targetDatabaseId: "b2",
  targetDatabaseName: "Interactions",
  inverseColumnId: "c9",
  inverseColumnName: "Contacts",
};

describe("DeleteColumnDialog", () => {
  it("jumelée : deux choix, true pour les deux et false pour celle-ci", () => {
    const onConfirm = vi.fn();
    render(<DeleteColumnDialog open columnName="Interactions" isRelation pairing={paired} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Supprimer les deux colonnes"));
    expect(onConfirm).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText(/Supprimer seulement/));
    expect(onConfirm).toHaveBeenLastCalledWith(false);
  });
  it("simple : un seul bouton de suppression, Annuler appelle onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteColumnDialog open columnName="Nom" isRelation={false} pairing={{ kind: "none" }} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.queryByText("Supprimer les deux colonnes")).toBeNull();
    fireEvent.click(screen.getByText("Annuler"));
    expect(onCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Supprimer la colonne"));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });
});
