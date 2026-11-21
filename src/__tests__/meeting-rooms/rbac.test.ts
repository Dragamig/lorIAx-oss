import { describe, it, expect } from "vitest";
import { canManageMeetingRooms, hasGlobalRole } from "@/lib/auth/rbac";

describe("canManageMeetingRooms", () => {
  it("admin et super_admin peuvent gérer les salles", () => {
    expect(canManageMeetingRooms("admin")).toBe(true);
    expect(canManageMeetingRooms("super_admin")).toBe(true);
  });

  it("le badge facility_manager (par-dessus le socle) donne la gestion des salles", () => {
    expect(canManageMeetingRooms("editor", ["facility_manager"])).toBe(true);
    expect(canManageMeetingRooms("viewer", ["facility_manager"])).toBe(true);
  });

  it("editor et viewer sans badge ne peuvent pas gérer", () => {
    expect(canManageMeetingRooms("editor")).toBe(false);
    expect(canManageMeetingRooms("viewer")).toBe(false);
    expect(canManageMeetingRooms("editor", [])).toBe(false);
  });

  it("un autre badge ne donne pas la gestion des salles", () => {
    expect(canManageMeetingRooms("editor", ["automation_manager"])).toBe(false);
  });
});

describe("hasGlobalRole — le socle ne confère pas les droits admin", () => {
  it("editor ne donne pas l'accès admin global", () => {
    expect(hasGlobalRole("editor", "admin")).toBe(false);
    expect(hasGlobalRole("editor", "super_admin")).toBe(false);
  });

  it("editor couvre editor et viewer en niveau", () => {
    expect(hasGlobalRole("editor", "editor")).toBe(true);
    expect(hasGlobalRole("editor", "viewer")).toBe(true);
  });
});
