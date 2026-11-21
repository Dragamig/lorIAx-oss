import { describe, it, expect } from "vitest";
import { ASSIGNABLE_ROLES } from "@/lib/meeting-rooms/permissions";

describe("ASSIGNABLE_ROLES", () => {
  it("inclut les 5 rôles globaux", () => {
    expect(ASSIGNABLE_ROLES).toContain("super_admin");
    expect(ASSIGNABLE_ROLES).toContain("admin");
    expect(ASSIGNABLE_ROLES).toContain("facility_manager");
    expect(ASSIGNABLE_ROLES).toContain("editor");
    expect(ASSIGNABLE_ROLES).toContain("viewer");
    expect(ASSIGNABLE_ROLES.length).toBe(5);
  });
});

// Note : les helpers canBookRoom / listBookableRoomIds touchent la BDD
// (db.select avec joins et OR multi-axes). Ils sont couverts en e2e avec
// des fixtures plutôt qu'en unit tests pour éviter de mocker tout l'ORM.
// Les types et la signature sont validés par tsc, et la matrice est
// testable visuellement via la page /admin/meeting-rooms.
