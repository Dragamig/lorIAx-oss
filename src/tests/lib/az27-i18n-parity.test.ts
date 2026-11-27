import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LOCALES = ["fr", "en", "de", "es", "br", "ja", "zh"] as const;

type Tree = { [k: string]: string | Tree };

function load(locale: string): Tree {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Tree;
}

function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function pick(auth: Tree): Record<string, string> {
  const flat = flatten(auth, "auth");
  const login = [
    "emailNotVerifiedHint",
    "resendLink",
    "resendSent",
    "resendCooldown",
    "inviteOnly",
  ].map((k) => `auth.login.${k}`);
  const keys = Object.keys(flat).filter(
    (k) =>
      k.startsWith("auth.closed.") ||
      k.startsWith("auth.checkEmail.") ||
      k.startsWith("auth.verifyEmail.") ||
      login.includes(k) ||
      k === "auth.login.errors.emailNotVerified",
  );
  return Object.fromEntries(keys.map((k) => [k, flat[k]]));
}

const EXPECTED = [
  "auth.closed.title", "auth.closed.body", "auth.closed.back",
  "auth.checkEmail.title", "auth.checkEmail.sentTo", "auth.checkEmail.validity",
  "auth.checkEmail.resend", "auth.checkEmail.resendCooldown",
  "auth.checkEmail.editAddress", "auth.checkEmail.resendDone",
  "auth.verifyEmail.loading", "auth.verifyEmail.doneTitle", "auth.verifyEmail.doneBody",
  "auth.verifyEmail.signIn", "auth.verifyEmail.expiredTitle", "auth.verifyEmail.expiredBody",
  "auth.verifyEmail.newLink", "auth.verifyEmail.usedTitle", "auth.verifyEmail.usedBody",
  "auth.verifyEmail.networkError", "auth.verifyEmail.tooManyRequests",
  "auth.login.emailNotVerifiedHint", "auth.login.resendLink", "auth.login.resendSent",
  "auth.login.resendCooldown", "auth.login.inviteOnly",
  "auth.login.errors.emailNotVerified",
];

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
const fr = pick(load("fr").auth as Tree);

describe("AZ-27 i18n parity", () => {
  it("fr contient toutes les clés attendues", () => {
    expect(Object.keys(fr).sort()).toEqual([...EXPECTED].sort());
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const got = pick(load(locale).auth as Tree);

      it("a les mêmes clés que fr, en chaînes non vides", () => {
        expect(Object.keys(got).sort()).toEqual(Object.keys(fr).sort());
        for (const [k, v] of Object.entries(got)) {
          expect(typeof v, k).toBe("string");
          expect(v.trim().length, k).toBeGreaterThan(0);
        }
      });

      it("conserve les placeholders de fr", () => {
        for (const k of Object.keys(fr)) {
          expect(placeholders(got[k] ?? ""), k).toEqual(placeholders(fr[k]));
        }
      });

      it("sans tiret cadratin", () => {
        for (const [k, v] of Object.entries(got)) {
          expect(/[–—]/.test(v), k).toBe(false);
        }
      });
    });
  }
});
