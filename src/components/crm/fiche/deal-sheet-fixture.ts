import type { DealSheetDto } from "@/lib/crm/deals";

export const TITLE = "c-titre";
export const RELANCE = "c-relance";
export const CONTACT = "c-contact";

/** Dossier fictif complet (contact lié, relance, interactions) pour les tests de la fiche. */
export function makeDealSheetDto(over: Partial<DealSheetDto> = {}, relance: string | null = "2030-01-10"): DealSheetDto {
  const cells = { [TITLE]: "Dossier 1", [RELANCE]: relance, [CONTACT]: ["k1"] };
  return {
    deal: { id: "1", title: "Dossier 1", status: "Nouveau", amount: null, relance, closeDate: null, ownerIds: [], contactId: "k1" },
    contact: { id: "k1", name: "Camille Roche", email: "camille@example.org", phone: "06 12 34 56 78", org: "BELOW DREAMS" },
    row: { id: "1", databaseId: "db-d", cells, position: 0, createdAt: "", updatedAt: "" },
    columns: [
      { id: TITLE, name: "Titre", type: "text", config: {} },
      { id: RELANCE, name: "Relance", type: "date", config: {} },
      { id: CONTACT, name: "Contact", type: "relation", config: { targetDatabaseId: "db-c" } },
    ],
    databaseId: "db-d",
    spaceId: "s",
    canEdit: true,
    missing: [],
    contactRow: { id: "k1", databaseId: "db-c", cells: { "c-nom": "Camille Roche" }, position: 0, createdAt: "", updatedAt: "" },
    contactColumns: [{ id: "c-nom", name: "Nom", type: "text", config: {} }],
    interactionTypes: ["Appel", "Mail"],
    canLog: true,
    canNote: true,
    canEditInteractions: true,
    titleColumnId: TITLE,
    relanceColumnId: RELANCE,
    contactColumnId: CONTACT,
    contactTitleColumnId: "c-nom",
    contactDatabaseId: "db-c",
    contactSpaceId: "s",
    ...over,
  };
}
