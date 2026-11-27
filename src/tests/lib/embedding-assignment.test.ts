import { describe, it, expect } from "vitest";
import { compareAssignedToCurrent } from "@/lib/ai/embedding-assignment";

const cur = { providerId: "p1", model: "mistral-embed", dimensions: 1024 };

describe("compareAssignedToCurrent", () => {
  it("identique : même modèle et même fournisseur", () => {
    expect(compareAssignedToCurrent({ providerId: "p1", model: "mistral-embed" }, cur)).toBe("same");
  });
  it("fournisseur différent", () => {
    expect(compareAssignedToCurrent({ providerId: "p2", model: "mistral-embed" }, cur)).toBe("different");
  });
  it("dimensions différentes", () => {
    expect(
      compareAssignedToCurrent({ providerId: "p1", model: "text-embedding-3-small" }, { ...cur, model: "text-embedding-3-small" })
    ).toBe("different");
  });
  it("absence d'index", () => {
    expect(compareAssignedToCurrent({ providerId: "p1", model: "mistral-embed" }, null)).toBe("no-index");
  });
  it("aucune assignation", () => {
    expect(compareAssignedToCurrent(null, cur)).toBe("unassigned");
  });
});
