import { describe, it, expect, vi } from "vitest";
import { createSerialSaver } from "./serial-saver";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSerialSaver", () => {
  it("n'envoie qu'une requête à la fois et fusionne les changements en attente sur le dernier", async () => {
    const calls: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const send = vi.fn((v: string) => {
      calls.push(v);
      return gates[calls.length - 1].promise;
    });
    const saver = createSerialSaver<string>(send);
    const a = saver.save("A");
    const b = saver.save("B");
    const c = saver.save("C");
    expect(calls).toEqual(["A"]);
    gates[0].resolve();
    expect(await a).toBe("saved");
    expect(await b).toBe("superseded");
    expect(calls).toEqual(["A", "C"]);
    gates[1].resolve();
    expect(await c).toBe("saved");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("l'échec de la requête en vol n'empêche pas l'envoi de l'état en attente", async () => {
    const gates = [deferred(), deferred()];
    let n = 0;
    const saver = createSerialSaver<string>(() => gates[n++].promise);
    const a = saver.save("A");
    const b = saver.save("B");
    gates[0].reject(new Error("boom"));
    expect(await a).toBe("failed");
    expect(n).toBe(2);
    gates[1].resolve();
    expect(await b).toBe("saved");
  });

  it("repart librement une fois inactif", async () => {
    const send = vi.fn(() => Promise.resolve());
    const saver = createSerialSaver<number>(send);
    expect(await saver.save(1)).toBe("saved");
    expect(await saver.save(2)).toBe("saved");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
