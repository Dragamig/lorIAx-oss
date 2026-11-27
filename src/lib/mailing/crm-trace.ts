/**
 * Contexte CRM d'une fiche et trace d'un mail en Interaction.
 *
 * Lecture de la fiche : contrôlée au niveau « viewer » de l'espace (`loadConnection` de l'utilisateur).
 * Écritures (dossier automatique, option de select, Interaction) : exécutées par le système mais seulement
 * si l'expéditeur a le droit éditeur sur les bases visées (`assertSenderCanEdit`). Les bases viennent de `crm_connections` de l'organisation (filtre
 * d'organisation conservé par `loadConnection`), jamais d'un identifiant client. L'historique de ligne
 * porte `source: "system"`, `actorLabel: "Mailing"` et l'auteur réel ; aucune valeur d'enum nouvelle.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseRows } from "@/lib/db/schema";
import { mailMessages, type MailMessageRow } from "@/lib/db/schema-mailing";
import { auditLog } from "@/lib/audit/log";
import { loadConnection, type CrmDeps, type ResolvedConnection } from "@/lib/crm/connection";
import { createDatabaseRow, findRowById, withMatchLock, type DbExecutor } from "@/lib/databases/row-writes";
import type { RowChangeContext } from "@/lib/databases/row-change-context";

export interface TraceContext {
  orgId: string;
  /** Auteur réel du mail, consigné dans l'historique de ligne et l'audit. */
  userId: string;
}

export interface FicheContext {
  role: "contacts" | "dossiers";
  contactRowId: string;
  contactDatabaseId: string;
  contactEmail: string | null;
  contactName: string;
  dossiers: { rowId: string; title: string; updatedAt: Date }[];
  defaultDossierRowId: string | null;
  fixedDossierRowId: string | null;
}

export class CrmTraceError extends Error {
  constructor(
    public readonly code: "crm_disconnected" | "forbidden" | "contact_not_found" | "dossier_mismatch" | "dossier_missing",
    message: string,
  ) {
    super(message);
    this.name = "CrmTraceError";
  }
}

export class CrmDisconnectedError extends CrmTraceError {
  constructor(message = "CRM non raccordé") {
    super("crm_disconnected", message);
    this.name = "CrmDisconnectedError";
  }
}

/** L'expéditeur n'a pas le droit éditeur requis : la trace est abandonnée, jamais rejouée. */
export class CrmTraceForbiddenError extends CrmTraceError {
  constructor(message = "Droit d'édition requis sur le CRM pour tracer le mail") {
    super("forbidden", message);
    this.name = "CrmTraceForbiddenError";
  }
}

const MAIL_SENT = "Mail envoyé";
const MAIL_RECEIVED = "Mail reçu";
const EXCERPT_MAX = 500;
const DOSSIER_LIST_MAX = 100;

/** Juge de permission du système : les écritures du Mailing ne dépendent pas du droit de l'utilisateur. */
function systemDeps(): CrmDeps {
  return { executor: db, permissionOf: async () => "admin" };
}

export function interactionLabels(direction: "out" | "in"): { type: string; sens: string } {
  return direction === "out"
    ? { type: MAIL_SENT, sens: "Sortant" }
    : { type: MAIL_RECEIVED, sens: "Entrant" };
}

/** Extrait texte du corps : lignes vides regroupées, plafonné, terminé par « … » si coupé. */
export function mailExcerpt(text: string): string {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX)}…` : t;
}

/**
 * Les écritures de trace ne s'exécutent que si l'expéditeur a le droit éditeur sur les bases visées
 * (jugé avec SES permissions, pas celles du système). Sinon le mail part sans trace, abandonnée une fois
 * pour toutes (`CrmTraceForbiddenError`). L'appelant a déjà vérifié le raccordement en lecture.
 */
async function assertSenderCanEdit(ctx: TraceContext, roles: ("contacts" | "dossiers" | "interactions")[]): Promise<void> {
  const conn = await loadConnection(ctx.orgId, ctx.userId, "editor");
  for (const r of roles) {
    if (!conn?.enabled || !conn.roles[r]?.connected) {
      throw new CrmTraceForbiddenError();
    }
  }
}

function systemRowContext(userId: string): RowChangeContext {
  return { source: "system", actorUserId: userId, actorLabel: "Mailing" };
}

function cellText(cells: Record<string, unknown> | null | undefined, columnId: string | null | undefined): string {
  if (!cells || !columnId) return "";
  const v = cells[columnId];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function cellIds(cells: Record<string, unknown> | null | undefined, columnId: string): string[] {
  const v = cells?.[columnId];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

interface CrmBases {
  contactsDb: string;
  dossiersDb: string;
  nameCol: string | null;
  emailCol: string | null;
  titleCol: string;
  statutCol: string | null;
  dossierContactCol: string;
  contactsRole: ResolvedConnection["roles"]["contacts"];
  dossiersRole: ResolvedConnection["roles"]["dossiers"];
}

function pickColumn(role: { columnIds: Record<string, string | null>; fields: Record<string, { state: string }> }, key: string) {
  const id = role.columnIds[key];
  return id && role.fields[key]?.state === "ok" ? id : null;
}

/** Bases Contacts et Dossiers raccordées et exploitables, sinon null. */
function crmBases(conn: ResolvedConnection | null): CrmBases | null {
  if (!conn || !conn.enabled) return null;
  const c = conn.roles.contacts;
  const d = conn.roles.dossiers;
  if (!c.connected || !c.databaseId || !d.connected || !d.databaseId) return null;
  const titleCol = pickColumn(d, "titre");
  const dossierContactCol = pickColumn(d, "contact");
  if (!titleCol || !dossierContactCol) return null;
  return {
    contactsDb: c.databaseId,
    dossiersDb: d.databaseId,
    nameCol: pickColumn(c, "nom"),
    emailCol: pickColumn(c, "email"),
    titleCol,
    statutCol: pickColumn(d, "statut"),
    dossierContactCol,
    contactsRole: c,
    dossiersRole: d,
  };
}

async function listDossiers(executor: DbExecutor, b: CrmBases, contactRowId: string) {
  const rows = await executor
    .select()
    .from(userDatabaseRows)
    .where(
      and(
        eq(userDatabaseRows.databaseId, b.dossiersDb),
        sql`${userDatabaseRows.cells} -> ${b.dossierContactCol}::text @> ${JSON.stringify([contactRowId])}::jsonb`,
      ),
    )
    .orderBy(desc(userDatabaseRows.updatedAt), desc(userDatabaseRows.createdAt))
    .limit(DOSSIER_LIST_MAX);
  return rows.map((r) => ({
    rowId: r.id,
    title: cellText(r.cells as Record<string, unknown>, b.titleCol),
    updatedAt: r.updatedAt,
  }));
}

/**
 * Contexte d'une fiche (ligne de la base Contacts ou Dossiers du CRM). `null` si la base n'est pas
 * un rôle du CRM de l'organisation, si la ligne n'existe pas dans cette base, si le CRM est
 * désactivé, si l'espace n'est pas lisible par l'utilisateur ou si le dossier n'a pas de contact.
 */
export async function resolveFicheContext(
  orgId: string,
  userId: string,
  ref: { databaseId: string; rowId: string },
): Promise<FicheContext | null> {
  const b = crmBases(await loadConnection(orgId, userId, "viewer"));
  if (!b) return null;
  const role = ref.databaseId === b.contactsDb ? "contacts" : ref.databaseId === b.dossiersDb ? "dossiers" : null;
  if (!role) return null;
  const row = await findRowById(ref.databaseId, ref.rowId);
  if (!row) return null;
  const cells = row.cells as Record<string, unknown>;

  let contactRowId = row.id;
  let contactCells = cells;
  if (role === "dossiers") {
    const linked = cellIds(cells, b.dossierContactCol)[0];
    if (!linked) return null;
    const contact = await findRowById(b.contactsDb, linked);
    if (!contact) return null;
    contactRowId = contact.id;
    contactCells = contact.cells as Record<string, unknown>;
  }

  const dossiers = await listDossiers(db, b, contactRowId);
  const email = cellText(contactCells, b.emailCol);
  return {
    role,
    contactRowId,
    contactDatabaseId: b.contactsDb,
    contactEmail: email || null,
    contactName: cellText(contactCells, b.nameCol),
    dossiers,
    defaultDossierRowId: role === "dossiers" ? row.id : (dossiers[0]?.rowId ?? null),
    fixedDossierRowId: role === "dossiers" ? row.id : null,
  };
}

/**
 * Dossier de rattachement d'un mail. `dossierRowId` fourni : doit appartenir au contact. Sinon le
 * dossier le plus récemment modifié du contact, ou à défaut un dossier « Contact entrant : <nom> »
 * créé sous verrou (jamais deux dossiers pour deux mails simultanés).
 */
export async function ensureDossierForMail(
  ctx: TraceContext,
  input: { contactRowId: string; dossierRowId?: string | null },
): Promise<{ dossierRowId: string; created: boolean }> {
  const b = crmBases(await loadConnection(ctx.orgId, ctx.userId, "viewer", systemDeps()));
  if (!b) throw new CrmDisconnectedError("Contacts ou Dossiers non raccordés");
  const contact = await findRowById(b.contactsDb, input.contactRowId);
  if (!contact) throw new CrmTraceError("contact_not_found", "Contact introuvable");

  if (input.dossierRowId) {
    const dossier = await findRowById(b.dossiersDb, input.dossierRowId);
    // Dossier supprimé depuis le choix : repli sur le dossier automatique plutôt qu'un échec définitif.
    if (dossier) {
      if (!cellIds(dossier.cells as Record<string, unknown>, b.dossierContactCol).includes(contact.id)) {
        throw new CrmTraceError("dossier_mismatch", "Ce dossier n'appartient pas au contact");
      }
      return { dossierRowId: dossier.id, created: false };
    }
  }

  const result = await withMatchLock(b.dossiersDb, b.dossierContactCol, contact.id, async (tx) => {
    const existing = await listDossiers(tx, b, contact.id);
    if (existing[0]) return { dossierRowId: existing[0].rowId, created: false };
    // Le droit éditeur ne se contrôle que pour écrire : un dossier existant se rattache sans écriture.
    await assertSenderCanEdit(ctx, ["dossiers"]);
    const name = cellText(contact.cells as Record<string, unknown>, b.nameCol);
    const cells: Record<string, unknown> = {
      [b.titleCol]: `Contact entrant : ${name || cellText(contact.cells as Record<string, unknown>, b.emailCol)}`.trim(),
      [b.dossierContactCol]: [contact.id],
    };
    if (b.statutCol) {
      const options = await tx.execute(
        sql`SELECT config -> 'options' ->> 0 AS first FROM user_database_columns WHERE id = ${b.statutCol} AND database_id = ${b.dossiersDb}`,
      );
      const list = (Array.isArray(options) ? options : (options as { rows: unknown[] }).rows) as { first: string | null }[];
      if (list[0]?.first) cells[b.statutCol] = list[0].first;
    }
    const row = await createDatabaseRow(b.dossiersDb, cells, tx, systemRowContext(ctx.userId));
    return { dossierRowId: row.id, created: true };
  });
  if (result.created) {
    auditLog("mailing.dossier_created", ctx.userId, {
      organizationId: ctx.orgId,
      dossierRowId: result.dossierRowId,
      contactRowId: contact.id,
    });
  }
  return result;
}

/**
 * Ajoute `label` aux options d'une colonne select si absent. Un seul UPDATE conditionnel : le verrou
 * de ligne et la réévaluation du WHERE rendent l'ajout atomique et sans doublon sous concurrence.
 */
async function ensureSelectOption(orgId: string, databaseId: string, columnId: string, label: string): Promise<void> {
  // Rattachement : la base de la colonne doit appartenir à l'organisation (jointure sur spaces).
  const owned = await db.execute(sql`
    SELECT 1 AS ok FROM user_databases ud JOIN spaces s ON s.id = ud.space_id
    JOIN user_database_columns c ON c.database_id = ud.id
    WHERE c.id = ${columnId} AND ud.id = ${databaseId} AND s.organization_id = ${orgId}
  `);
  const found = (Array.isArray(owned) ? owned : (owned as { rows: unknown[] }).rows) as unknown[];
  if (found.length === 0) throw new CrmTraceError("crm_disconnected", "Colonne hors de l'organisation");
  await db.execute(sql`
    UPDATE user_database_columns
    SET config = jsonb_set(
      COALESCE(config, '{}'::jsonb), '{options}',
      (CASE WHEN jsonb_typeof(config -> 'options') = 'array' THEN config -> 'options' ELSE '[]'::jsonb END)
        || jsonb_build_array(${label}::text))
    WHERE id = ${columnId} AND database_id = ${databaseId} AND type = 'select'
      AND NOT ((CASE WHEN jsonb_typeof(config -> 'options') = 'array' THEN config -> 'options' ELSE '[]'::jsonb END)
        @> jsonb_build_array(${label}::text))
  `);
}

export async function ensureInteractionTypeOption(
  orgId: string,
  databaseId: string,
  columnId: string,
  label: "Mail envoyé" | "Mail reçu",
): Promise<void> {
  await ensureSelectOption(orgId, databaseId, columnId, label);
}

function attachmentCells(attachments: MailMessageRow["attachments"]): Record<string, unknown>[] {
  return (attachments ?? []).map((a) =>
    a.source === "media" && a.mediaId
      ? { mediaId: a.mediaId, filename: a.fileName, mimeType: a.mimeType, size: a.size }
      : { key: a.storageKey, filename: a.fileName, mimeType: a.mimeType, size: a.size },
  );
}

/**
 * Écrit la ligne Interaction d'un mail (écriture système). Idempotent : `interaction_row_id` est relu
 * sous verrou et la ligne et le renvoi du lien se font dans une même transaction.
 */
export async function writeMailInteraction(message: MailMessageRow): Promise<{ interactionRowId: string }> {
  const conn = await loadConnection(message.organizationId, message.userId, "viewer", systemDeps());
  const ix = conn?.enabled ? conn.roles.interactions : null;
  if (!ix || !ix.connected || !ix.databaseId) throw new CrmDisconnectedError("Interactions non raccordées");
  await assertSenderCanEdit({ orgId: message.organizationId, userId: message.userId }, ["interactions"]);
  const dateCol = pickColumn(ix, "date");
  const typeCol = pickColumn(ix, "type");
  const dossierCol = pickColumn(ix, "dossier");
  if (!dateCol || !typeCol || !dossierCol) throw new CrmDisconnectedError("Colonnes des Interactions incomplètes");
  const contactCol = pickColumn(ix, "contact");
  const sensCol = pickColumn(ix, "sens");
  const titleCol = pickColumn(ix, "intitule");
  const notesCol = pickColumn(ix, "compte_rendu");
  const piecesCol = pickColumn(ix, "pieces");
  const databaseId = ix.databaseId;

  if (!message.dossierRowId) throw new CrmTraceError("dossier_missing", "Mail sans dossier");
  const b = crmBases(conn);
  if (!b) throw new CrmDisconnectedError("Contacts ou Dossiers non raccordés");
  const contact = message.contactRowId ? await findRowById(b.contactsDb, message.contactRowId) : undefined;
  if (!contact) throw new CrmTraceError("contact_not_found", "Contact introuvable");
  const dossier = await findRowById(b.dossiersDb, message.dossierRowId);
  if (!dossier) throw new CrmTraceError("dossier_missing", "Dossier introuvable");
  if (!cellIds(dossier.cells as Record<string, unknown>, b.dossierContactCol).includes(contact.id)) {
    throw new CrmTraceError("dossier_mismatch", "Ce dossier n'appartient pas au contact");
  }

  const labels = interactionLabels(message.direction);
  await ensureSelectOption(message.organizationId, databaseId, typeCol, labels.type);
  if (sensCol) await ensureSelectOption(message.organizationId, databaseId, sensCol, labels.sens);

  const cells: Record<string, unknown> = {
    [dateCol]: (message.sentAt ?? message.createdAt).toISOString(),
    [typeCol]: labels.type,
    [dossierCol]: [message.dossierRowId],
  };
  if (contactCol && message.contactRowId) cells[contactCol] = [message.contactRowId];
  if (sensCol) cells[sensCol] = labels.sens;
  if (titleCol) cells[titleCol] = message.subject;
  if (notesCol) cells[notesCol] = mailExcerpt(message.bodyText);
  const pieces = attachmentCells(message.attachments);
  if (piecesCol && pieces.length > 0) cells[piecesCol] = pieces;

  const interactionRowId = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail_trace:${message.id}`}, 0))`);
    const [current] = await tx
      .select({ interactionRowId: mailMessages.interactionRowId })
      .from(mailMessages)
      .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)))
      .limit(1);
    if (current?.interactionRowId) return current.interactionRowId;
    const row = await createDatabaseRow(databaseId, cells, tx, systemRowContext(message.userId));
    await tx
      .update(mailMessages)
      .set({ interactionRowId: row.id, updatedAt: new Date() })
      .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)));
    return row.id;
  });

  auditLog("mailing.interaction_written", message.userId, {
    organizationId: message.organizationId,
    messageId: message.id,
    interactionRowId,
  });
  return { interactionRowId };
}
