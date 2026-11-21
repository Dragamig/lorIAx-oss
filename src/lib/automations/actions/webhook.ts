/**
 * Action « webhook » — POST le payload de la ligne vers une URL externe.
 * Anti-SSRF : URL validée à la création (validate) ET re-vérifiée à l'exécution
 * par `safeExternalFetch`, qui résout le DNS avant de se connecter et revalide
 * chaque redirection. Le suivi aveugle des redirections rouvrait le chemin vers
 * le réseau interne malgré la double validation (audit du 2026-08-19, INJ-19).
 */
import { z } from "zod";
import { validateExternalUrl } from "@/lib/security/url-validator";
import { safeExternalFetch } from "@/lib/security/outbound-fetch";
import type { ActionDefinition } from "./types";

const configSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const webhookAction: ActionDefinition = {
  type: "webhook",
  configSchema,
  validate(config) {
    const url = (config as { url?: string }).url;
    if (!url) return "URL du webhook requise pour l'action webhook";
    const err = validateExternalUrl(url);
    if (err) return `URL refusée : ${err}`;
    return null;
  },
  async simulate(actionConfig) {
    const cfg = (actionConfig ?? {}) as { url?: string; method?: string };
    if (!cfg.url) throw new Error("URL du webhook manquante");
    const err = validateExternalUrl(cfg.url);
    if (err) throw new Error(`URL refusée : ${err}`);
    return { webhook: { url: cfg.url, method: cfg.method ?? "POST", status: "simulated" }, simulated: true };
  },
  async execute(actionConfig, _automation, ctx) {
    const cfg = (actionConfig ?? {}) as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
    };
    if (!cfg.url) throw new Error("URL du webhook manquante");

    // Anti-SSRF re-vérifié à l'exécution (cf. spec §4 R4)
    const err = validateExternalUrl(cfg.url);
    if (err) throw new Error(`URL refusée : ${err}`);

    // Le body n'inclut JAMAIS orgId/userId — uniquement le payload de la ligne
    const body = {
      event: ctx.event,
      databaseId: ctx.databaseId,
      rowId: ctx.rowId,
      cells: ctx.cells,
    };

    const res = await safeExternalFetch(cfg.url, {
      timeoutMs: 15_000,
      init: {
        method: cfg.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LorIAx-Automation/1.0",
          ...(cfg.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
    });
    if (!res.ok) {
      throw new Error(`Webhook a renvoyé ${res.status}`);
    }
  },
};
