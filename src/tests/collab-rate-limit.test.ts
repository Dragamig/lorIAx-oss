/**
 * Limiteur de débit par connexion Hocuspocus (horloge simulée).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as encoding from "lib0/encoding";
import {
  createMessageRateLimiter,
  CONTROL_MESSAGES_PER_MINUTE,
  SYNC_MESSAGES_PER_MINUTE,
  RATE_WINDOW_MS,
  MESSAGE_TYPE,
} from "@/lib/collab/message-rate-limit";

const msg = (type: number) => {
  const e = encoding.createEncoder();
  encoding.writeVarString(e, "doc-1");
  encoding.writeVarUint(e, type);
  return encoding.toUint8Array(e);
};

let clock = 0;
beforeEach(() => {
  clock = 1_000_000;
});
afterEach(() => vi.restoreAllMocks());

describe("createMessageRateLimiter", () => {
  it("accepte 60 messages stateless par minute puis refuse le suivant", () => {
    const rl = createMessageRateLimiter(() => clock);
    for (let i = 0; i < CONTROL_MESSAGES_PER_MINUTE; i++) {
      expect(rl.allow("c1", msg(MESSAGE_TYPE.Stateless))).toBe(true);
    }
    expect(rl.allow("c1", msg(MESSAGE_TYPE.Stateless))).toBe(false);
  });

  it("repart à zéro après la fenêtre d'une minute", () => {
    const rl = createMessageRateLimiter(() => clock);
    for (let i = 0; i <= CONTROL_MESSAGES_PER_MINUTE; i++) rl.allow("c1", msg(MESSAGE_TYPE.Stateless));
    clock += RATE_WINDOW_MS;
    expect(rl.allow("c1", msg(MESSAGE_TYPE.Stateless))).toBe(true);
  });

  it("n'étrangle pas la synchro Yjs ni l'awareness (frappe rapide)", () => {
    const rl = createMessageRateLimiter(() => clock);
    for (let i = 0; i < 500; i++) {
      expect(rl.allow("c1", msg(MESSAGE_TYPE.Sync))).toBe(true);
      expect(rl.allow("c1", msg(MESSAGE_TYPE.Awareness))).toBe(true);
    }
  });

  it("borne tout de même un flood de synchro", () => {
    const rl = createMessageRateLimiter(() => clock);
    let refused = false;
    for (let i = 0; i <= SYNC_MESSAGES_PER_MINUTE; i++) {
      if (!rl.allow("c1", msg(MESSAGE_TYPE.Sync))) refused = true;
    }
    expect(refused).toBe(true);
  });

  it("isole les connexions entre elles", () => {
    const rl = createMessageRateLimiter(() => clock);
    for (let i = 0; i <= CONTROL_MESSAGES_PER_MINUTE; i++) rl.allow("c1", msg(MESSAGE_TYPE.Stateless));
    expect(rl.allow("c2", msg(MESSAGE_TYPE.Stateless))).toBe(true);
  });

  it("libère l'état à la déconnexion", () => {
    const rl = createMessageRateLimiter(() => clock);
    rl.allow("c1", msg(MESSAGE_TYPE.Stateless));
    rl.allow("c1", msg(MESSAGE_TYPE.Sync));
    expect(rl.size()).toBe(2);
    rl.release("c1");
    expect(rl.size()).toBe(0);
  });
});
