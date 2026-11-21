import { describe, expect, it } from "vitest";
import { deduceTriggerMode } from "../trigger-mode";

describe("deduceTriggerMode", () => {
  it("attend tant que la connexion Tally est inconnue", () => {
    expect(deduceTriggerMode({ tallyConnected: null, hasReceived: true })).toBe("pending");
  });
  it("Tally si clé connectée", () => {
    expect(deduceTriggerMode({ tallyConnected: true, hasReceived: false })).toBe("tally");
  });
  it("Tally si des imports existent", () => {
    expect(deduceTriggerMode({ tallyConnected: false, hasReceived: false, hasTallyImports: true })).toBe("tally");
  });
  it("cartes si rien n'est configuré", () => {
    expect(deduceTriggerMode({ tallyConnected: false, hasReceived: false })).toBe("choose");
  });
  it("webhook si un corps a été reçu", () => {
    expect(deduceTriggerMode({ tallyConnected: false, hasReceived: true })).toBe("webhook");
  });
});
