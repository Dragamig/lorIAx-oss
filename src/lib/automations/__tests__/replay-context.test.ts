import { describe, it, expect } from "vitest";
import {
  snapshotTriggerContext,
  replayContextFromPayload,
  REPLAY_MAX_BYTES,
} from "@/lib/automations/replay-context";

describe("snapshotTriggerContext", () => {
  it("retire secrets et en-têtes, garde les chaînes longues intactes", () => {
    const long = "x".repeat(2000);
    const snap = snapshotTriggerContext({
      event: "webhook_inbound",
      variables: { body: { name: "n", token: "t", headers: { a: "b" }, long } },
    }) as { variables: { body: Record<string, unknown> } };
    expect(snap.variables.body).toEqual({ name: "n", long });
  });

  it("ne partage pas de référence avec le contexte vivant", () => {
    const ctx = { variables: { a: 1 } };
    const snap = snapshotTriggerContext(ctx) as { variables: Record<string, unknown> };
    ctx.variables.a = 2;
    expect(snap.variables.a).toBe(1);
  });

  it("marque indisponible au-delà du plafond", () => {
    const snap = snapshotTriggerContext({ cells: { big: "y".repeat(REPLAY_MAX_BYTES + 10) } });
    expect(snap).toEqual({ unavailable: true });
    expect(replayContextFromPayload({ replay: snap })).toBeNull();
  });
});
