import { describe, expect, it } from "vitest";
import fr from "../../../../messages/fr.json";
import { createTranslator } from "next-intl";
import { formatRelanceDay, relativeLabel } from "./relative-label";

const tr = createTranslator({ locale: "fr", messages: fr, namespace: "crm.relances" });
const t = (key: string, values?: Record<string, number>) => tr(key as never, values as never) as string;

describe("relativeLabel", () => {
  const today = "2026-11-18";
  it("jour courant, demain, hier", () => {
    expect(relativeLabel("2026-11-18", today, t)).toBe("Aujourd'hui");
    expect(relativeLabel("2026-11-19", today, t)).toBe("Demain");
    expect(relativeLabel("2026-11-17", today, t)).toBe("Hier");
  });
  it("dans N jours et en retard de N jours", () => {
    expect(relativeLabel("2026-11-21", today, t)).toBe("Dans 3 jours");
    expect(relativeLabel("2026-11-14", today, t)).toBe("En retard de 4 jours");
  });
  it("formate le jour sans décalage de fuseau", () => {
    expect(formatRelanceDay("2026-11-18", "fr")).toBe("18 nov.");
  });
});
