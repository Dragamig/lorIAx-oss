import { describe, it, expect } from "vitest";
import { isNearBottom, FOLLOW_END_THRESHOLD_PX } from "./use-follow-end";

describe("isNearBottom", () => {
  it("reconnaît le bas exact du conteneur", () => {
    expect(isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("tolère un écart inférieur au seuil", () => {
    expect(isNearBottom({ scrollTop: 640, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("accepte l'écart pile au seuil", () => {
    const scrollTop = 1000 - 300 - FOLLOW_END_THRESHOLD_PX;
    expect(isNearBottom({ scrollTop, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
  });

  it("refuse dès que l'utilisateur a remonté au-delà du seuil", () => {
    expect(isNearBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 300 })).toBe(false);
  });

  it("considère un contenu plus court que le cadre comme étant en bas", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true);
  });

  it("respecte un seuil personnalisé", () => {
    const metrics = { scrollTop: 500, scrollHeight: 1000, clientHeight: 300 };
    expect(isNearBottom(metrics, 10)).toBe(false);
    expect(isNearBottom(metrics, 250)).toBe(true);
  });
});
