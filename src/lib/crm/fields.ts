import { z } from "zod";
import type { DbColumnType } from "@/lib/databases/column-types";
import type { CrmFieldMap, CrmRole } from "@/lib/db/schema-crm";

export type { CrmFieldMap, CrmRole };

export const CRM_ROLES = ["contacts", "dossiers", "interactions"] as const satisfies readonly CrmRole[];

export interface CrmFieldDef {
  key: string;
  role: CrmRole;
  required: boolean;
  types: readonly DbColumnType[];
  /** Sous-chaînes minuscules d'un nom de colonne qui suggèrent ce champ. */
  hints: readonly string[];
  relationTargetRole?: CrmRole;
}

/** Registre des champs métier par rôle. Les libellés sont les clés `crm.fields.<role>.<key>`. */
export const CRM_FIELDS: Record<CrmRole, readonly CrmFieldDef[]> = {
  contacts: [
    { key: "nom", role: "contacts", required: true, types: ["text", "formula"], hints: ["nom"] },
    { key: "email", role: "contacts", required: false, types: ["email", "text"], hints: ["mail"] },
    { key: "telephone", role: "contacts", required: false, types: ["text"], hints: ["tel"] },
    { key: "structure", role: "contacts", required: false, types: ["text"], hints: ["marque", "structure"] },
  ],
  dossiers: [
    { key: "titre", role: "dossiers", required: true, types: ["text"], hints: ["titre"] },
    { key: "statut", role: "dossiers", required: true, types: ["select"], hints: ["statut"] },
    { key: "montant", role: "dossiers", required: false, types: ["number", "formula"], hints: ["montant", "devis"] },
    { key: "relance", role: "dossiers", required: false, types: ["date"], hints: ["relance"] },
    { key: "responsable", role: "dossiers", required: false, types: ["person"], hints: ["responsable"] },
    {
      key: "contact",
      role: "dossiers",
      required: true,
      types: ["relation"],
      hints: ["contact"],
      relationTargetRole: "contacts",
    },
    { key: "cloture", role: "dossiers", required: false, types: ["date"], hints: ["clôture", "cloture"] },
  ],
  interactions: [
    { key: "date", role: "interactions", required: true, types: ["date"], hints: ["date"] },
    { key: "type", role: "interactions", required: true, types: ["select"], hints: ["type", "demande"] },
    {
      key: "dossier",
      role: "interactions",
      required: true,
      types: ["relation"],
      hints: ["dossier"],
      relationTargetRole: "dossiers",
    },
    { key: "intitule", role: "interactions", required: false, types: ["text"], hints: ["intitulé", "objet"] },
    { key: "compte_rendu", role: "interactions", required: false, types: ["text"], hints: ["compte rendu", "notes"] },
    { key: "pieces", role: "interactions", required: false, types: ["attachment"], hints: ["pièces"] },
  ],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lecture tolérante d'un `field_map` stocké : ignore tout ce qui est inconnu ou mal typé, ne lève jamais. */
export function parseFieldMap(raw: unknown): CrmFieldMap {
  const out: CrmFieldMap = {};
  if (!isPlainObject(raw)) return out;
  for (const role of CRM_ROLES) {
    if (!Object.prototype.hasOwnProperty.call(raw, role)) continue;
    const entry = raw[role];
    if (!isPlainObject(entry)) continue;
    const fields: Record<string, string | null> = {};
    for (const def of CRM_FIELDS[role]) {
      if (!Object.prototype.hasOwnProperty.call(entry, def.key)) continue;
      const v = entry[def.key];
      if (v === null || (typeof v === "string" && UUID_RE.test(v))) fields[def.key] = v;
    }
    out[role] = fields;
  }
  return out;
}

const uuidString = z.string().regex(UUID_RE);

const fieldMapRoleSchema = (role: CrmRole) =>
  z
    .object(
      Object.fromEntries(CRM_FIELDS[role].map((f) => [f.key, uuidString.nullable().optional()])),
    )
    .strict();

/** Corps de `PUT connection` : base par rôle et colonne par champ. */
export const bindingsSchema = z
  .object({
    roles: z
      .object({
        contacts: uuidString.nullable().optional(),
        dossiers: uuidString.nullable().optional(),
        interactions: uuidString.nullable().optional(),
      })
      .strict(),
    fieldMap: z
      .object({
        contacts: fieldMapRoleSchema("contacts").optional(),
        dossiers: fieldMapRoleSchema("dossiers").optional(),
        interactions: fieldMapRoleSchema("interactions").optional(),
      })
      .strict(),
  })
  .strict();

export type CrmBindings = z.infer<typeof bindingsSchema>;

const activateRoleSchema = (role: CrmRole) =>
  z
    .object({
      databaseId: uuidString,
      fieldMap: fieldMapRoleSchema(role).optional(),
    })
    .strict();

/** Corps de `POST activate` : de zéro à trois rôles raccordés, colonnes optionnelles (automap sinon). */
export const activateBodySchema = z
  .object({
    bindings: z
      .object({
        contacts: activateRoleSchema("contacts").optional(),
        dossiers: activateRoleSchema("dossiers").optional(),
        interactions: activateRoleSchema("interactions").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CrmActivateBody = z.infer<typeof activateBodySchema>;

const connectRoleSchema = (role: CrmRole) =>
  z.object({ mode: z.literal("connect"), databaseId: uuidString, fieldMap: fieldMapRoleSchema(role).optional() }).strict();
const completeRoleSchema = z.object({ mode: z.literal("complete"), databaseId: uuidString }).strict();
const createRoleSchema = z.object({ mode: z.literal("create") }).strict();

/** Un rôle : raccorder (correspondance facultative), compléter (plan recalculé par le serveur) ou créer. */
const activateRoleV2Schema = (role: CrmRole) =>
  z.discriminatedUnion("mode", [connectRoleSchema(role), completeRoleSchema, createRoleSchema]);

/**
 * Corps v2 de `POST activate` : espace et mode par rôle. Aucune organisation ni liste de colonnes
 * n'est acceptée du client : l'organisation est celle de la requête, le plan de complétion est serveur.
 */
export const activateBodyV2Schema = z
  .object({
    space: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("create") }).strict(),
      z.object({ mode: z.literal("existing"), spaceId: uuidString }).strict(),
    ]),
    roles: z
      .object({
        contacts: activateRoleV2Schema("contacts").optional(),
        dossiers: activateRoleV2Schema("dossiers").optional(),
        interactions: activateRoleV2Schema("interactions").optional(),
      })
      .strict(),
  })
  .strict();

export type CrmActivateBodyV2 = z.infer<typeof activateBodyV2Schema>;
