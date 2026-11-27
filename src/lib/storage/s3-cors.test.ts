import { describe, it, expect, vi } from "vitest";

vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class {} }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

import { mergeMultipartCors, multipartCorsOrigins } from "./s3";

const ORIGIN = "https://app.example.com";
const GET_ALL = { AllowedOrigins: ["*"], AllowedMethods: ["GET"], AllowedHeaders: ["*"] };

describe("mergeMultipartCors", () => {
  it("ajoute PUT pour l'origine de l'app sans retirer la règle GET existante", () => {
    const { rules, changed } = mergeMultipartCors([GET_ALL], ORIGIN);
    expect(changed).toBe(true);
    expect(rules[0]).toEqual(GET_ALL);
    expect(rules[1]).toMatchObject({
      AllowedOrigins: [ORIGIN],
      AllowedMethods: expect.arrayContaining(["PUT", "GET", "HEAD"]),
      ExposeHeaders: ["ETag"],
    });
  });

  it("bucket sans configuration : une seule règle", () => {
    expect(mergeMultipartCors([], ORIGIN).rules).toHaveLength(1);
  });

  it("idempotent : une seconde passe ne change rien", () => {
    const first = mergeMultipartCors([GET_ALL], ORIGIN);
    const second = mergeMultipartCors(first.rules, ORIGIN);
    expect(second.changed).toBe(false);
    expect(second.rules).toEqual(first.rules);
  });

  it("origine modifiée : la règle de l'app est remplacée, pas dupliquée", () => {
    const first = mergeMultipartCors([GET_ALL], ORIGIN);
    const next = mergeMultipartCors(first.rules, "https://autre.example");
    expect(next.changed).toBe(true);
    expect(next.rules).toHaveLength(2);
    expect(next.rules[1].AllowedOrigins).toEqual(["https://autre.example"]);
  });

  it("plusieurs origines : une règle par origine (Garage ne tolère pas une liste), idempotent", () => {
    const origins = [ORIGIN, "https://acme.example.com"];
    const { rules, changed } = mergeMultipartCors([GET_ALL], origins);
    expect(changed).toBe(true);
    expect(rules[0]).toEqual(GET_ALL);
    const ours = rules.slice(1);
    expect(ours.map((r) => r.AllowedOrigins)).toEqual(origins.map((o) => [o]));
    expect(ours.every((r) => r.AllowedOrigins!.length === 1 && r.AllowedOrigins![0] !== "*")).toBe(true);
    expect(mergeMultipartCors(rules, origins).changed).toBe(false);
    const fewer = mergeMultipartCors(rules, [ORIGIN]);
    expect(fewer.changed).toBe(true);
    expect(fewer.rules).toHaveLength(2);
  });

  it("multipartCorsOrigins : app seule sans domaine racine, sinon sous-domaines des organisations", () => {
    expect(multipartCorsOrigins("https://app.example.com/x", undefined)).toEqual(["https://app.example.com"]);
    expect(multipartCorsOrigins("https://app.example.com", "example.com", ["acme", "Bad Slug", "x.y"])).toEqual([
      "https://app.example.com",
      "https://acme.example.com",
    ]);
    expect(multipartCorsOrigins("http://localhost:3000", "")).toEqual(["http://localhost:3000"]);
    expect(multipartCorsOrigins(undefined, "example.com")).toEqual([]);
    expect(multipartCorsOrigins("https://app.example.com", "*")).toEqual(["https://app.example.com"]);
  });
});
