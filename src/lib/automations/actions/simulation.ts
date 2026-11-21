/**
 * Aides communes aux comportements simulés des actions (mode test du builder).
 */
import { randomUUID } from "node:crypto";

/** Identifiant fictif, reconnaissable comme tel par les étapes suivantes et l'interface. */
export function simId(): string {
  return `sim_${randomUUID()}`;
}

export function isSimId(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("sim_");
}
