import { describe, expect, it } from "vitest";
import { filterDeals, isLate, isOpenDeal, toContact, toDeal, toInteraction, type DealDto } from "../deal-model";
import type { CrmRow } from "../context";
import type { CrmRole } from "../fields";

const cols: Record<string, string> = {
  "dossiers.titre": "c-titre",
  "dossiers.statut": "c-statut",
  "dossiers.montant": "c-montant",
  "dossiers.relance": "c-relance",
  "dossiers.responsable": "c-resp",
  "dossiers.contact": "c-contact",
  "dossiers.cloture": "c-cloture",
  "contacts.nom": "k-nom",
  "contacts.email": "k-email",
  "contacts.telephone": "k-tel",
  "contacts.structure": "k-struct",
  "interactions.date": "i-date",
  "interactions.type": "i-type",
  "interactions.dossier": "i-doss",
  "interactions.intitule": "i-titre",
  "interactions.compte_rendu": "i-cr",
};
const fc = (role: CrmRole, key: string) => cols[`${role}.${key}`] ?? null;
const none = () => null;
const row = (cells: Record<string, unknown>, id = "r1"): CrmRow => ({
  id,
  databaseId: "d",
  cells,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("toDeal", () => {
  it("lit un dossier complet", () => {
    const d = toDeal(
      row({
        "c-titre": "Devis A",
        "c-statut": "Devis",
        "c-montant": 1200,
        "c-relance": "2026-11-20",
        "c-cloture": "2026-12-01",
        "c-resp": ["u1", "u2"],
        "c-contact": ["k1"],
      }),
      fc,
    );
    expect(d).toEqual({
      id: "r1",
      title: "Devis A",
      status: "Devis",
      amount: 1200,
      relance: "2026-11-20",
      closeDate: "2026-12-01",
      ownerIds: ["u1", "u2"],
      contactId: "k1",
    });
  });
  it("rend null pour un montant texte ou NaN", () => {
    expect(toDeal(row({ "c-montant": "1200" }), fc).amount).toBeNull();
    expect(toDeal(row({ "c-montant": NaN }), fc).amount).toBeNull();
  });
  it("accepte un responsable scalaire hérité", () => {
    expect(toDeal(row({ "c-resp": "u1" }), fc).ownerIds).toEqual(["u1"]);
  });
  it("relation vide ou multiple", () => {
    expect(toDeal(row({ "c-contact": [] }), fc).contactId).toBeNull();
    expect(toDeal(row({ "c-contact": ["a", "b"] }), fc).contactId).toBe("a");
    expect(toDeal(row({ "c-contact": 5 }), fc).contactId).toBeNull();
  });
  it("colonne non raccordée : champ null sans exception", () => {
    const d = toDeal(row({ "c-titre": "x" }), none);
    expect(d).toEqual({
      id: "r1",
      title: "",
      status: null,
      amount: null,
      relance: null,
      closeDate: null,
      ownerIds: [],
      contactId: null,
    });
  });
  it("évalue un montant formule via amountOf", () => {
    const d = toDeal(row({ "c-montant": undefined }), fc, () => 450);
    expect(d.amount).toBe(450);
    expect(toDeal(row({ "c-montant": 10 }), fc, () => "abc").amount).toBeNull();
  });
});

describe("toContact / toInteraction", () => {
  it("lit un contact", () => {
    expect(
      toContact(row({ "k-nom": "Ada", "k-email": "a@b.fr", "k-tel": "01", "k-struct": "ACME" }, "k1"), fc),
    ).toEqual({ id: "k1", name: "Ada", email: "a@b.fr", phone: "01", org: "ACME" });
    expect(toContact(row({ "k-email": 3 }, "k2"), fc)).toEqual({
      id: "k2",
      name: "",
      email: null,
      phone: null,
      org: null,
    });
  });
  it("lit une interaction", () => {
    expect(
      toInteraction(
        row({ "i-date": "2026-11-10", "i-type": "Appel", "i-doss": ["d1"], "i-titre": "T", "i-cr": "N" }, "i1"),
        fc,
      ),
    ).toEqual({ id: "i1", date: "2026-11-10", type: "Appel", title: "T", note: "N", dealId: "d1" });
    expect(toInteraction(row({}, "i2"), none).dealId).toBeNull();
  });
});

const mk = (o: Partial<DealDto>): DealDto => ({
  id: "x",
  title: "",
  status: "Devis",
  amount: null,
  relance: null,
  closeDate: null,
  ownerIds: [],
  contactId: null,
  ...o,
});

describe("isOpenDeal / isLate", () => {
  const closed = ["Gagné", "Perdu"];
  it("statut clos", () => {
    expect(isOpenDeal(mk({ status: "Gagné" }), closed)).toBe(false);
    expect(isOpenDeal(mk({ status: "Devis" }), closed)).toBe(true);
    expect(isOpenDeal(mk({ status: null }), closed)).toBe(true);
  });
  it("en retard", () => {
    expect(isLate(mk({ status: "Gagné", relance: "2026-01-01" }), closed, "2026-11-18")).toBe(false);
    expect(isLate(mk({ relance: "2026-11-17" }), closed, "2026-11-18")).toBe(true);
    expect(isLate(mk({ relance: "2026-11-18" }), closed, "2026-11-18")).toBe(false);
    expect(isLate(mk({ relance: null }), closed, "2026-11-18")).toBe(false);
  });
});

describe("filterDeals", () => {
  const closed = ["Gagné"];
  const today = "2026-11-18";
  const deals = [
    mk({ id: "a", ownerIds: ["u1"], relance: "2026-11-01" }),
    mk({ id: "b", ownerIds: ["u1"], relance: "2026-12-01" }),
    mk({ id: "c", ownerIds: ["u2"], relance: "2026-11-01" }),
  ];
  const ids = (l: DealDto[]) => l.map((d) => d.id);
  it("sans filtre", () => expect(ids(filterDeals(deals, { closed, today }))).toEqual(["a", "b", "c"]));
  it("mine", () =>
    expect(ids(filterDeals(deals, { mine: { userId: "u1" }, closed, today }))).toEqual(["a", "b"]));
  it("late ET mine", () =>
    expect(ids(filterDeals(deals, { mine: { userId: "u1" }, late: true, closed, today }))).toEqual(["a"]));
  it("ownerId", () => expect(ids(filterDeals(deals, { ownerId: "u2", closed, today }))).toEqual(["c"]));
});
