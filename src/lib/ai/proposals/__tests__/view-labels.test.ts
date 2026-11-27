import { describe, expect, it } from "vitest";
import { buildRowLabels } from "../row-labels";
import type { ProposalPayload } from "../types";

const snap = (id: string, cells: Record<string, unknown>) => ({ id, cells, position: 0 });

describe("buildRowLabels", () => {
  it("fusion : libellé = valeurs des colonnes clés, pour la ligne conservée et les retirées", () => {
    const payload = {
      type: "merge_duplicates",
      keyColumnIds: ["nom", "email"],
      relationColumnIds: [],
      groups: [
        {
          groupId: "g1",
          keepRowId: "k",
          removeRowIds: ["r"],
          keepRow: snap("k", { nom: "Marie", email: "m@x.fr" }),
          removedRows: [snap("r", { nom: "Marie", email: "m@x.fr" })],
        },
      ],
    } as unknown as ProposalPayload;
    expect(buildRowLabels(payload, "nom")).toEqual({ k: "Marie, m@x.fr", r: "Marie, m@x.fr" });
  });

  it("suppression : première colonne ; cellule vide ou objet : pas de libellé", () => {
    const payload = {
      type: "delete_rows",
      rows: [snap("a", { nom: "Karim" }), snap("b", { nom: "" }), snap("c", { nom: { x: 1 } })],
    } as unknown as ProposalPayload;
    expect(buildRowLabels(payload, "nom")).toEqual({ a: "Karim" });
  });

  it("mise à jour : libellé tiré de l'état avant ; création : aucun", () => {
    const upd = { type: "update_rows", changes: [{ rowId: "u", before: { nom: "Léa" }, after: {} }] } as unknown as ProposalPayload;
    expect(buildRowLabels(upd, "nom")).toEqual({ u: "Léa" });
    expect(buildRowLabels({ type: "create_rows", rows: [] }, "nom")).toEqual({});
  });
});
