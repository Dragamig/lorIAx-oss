import { ilike, or, type SQL, sql } from "drizzle-orm";
import { userDatabaseRows } from "@/lib/db/schema";
import { escapeLike } from "@/lib/databases/like-escape";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { missingFields, readRoleRows, type ColumnDto, type CrmContext, type CrmRow } from "./context";
import { contactNameOf, contactReader, toInteraction, type ContactDto } from "./deal-model";
import { loadOpenDeals } from "./relances";

export interface ContactItem extends ContactDto {
  row: CrmRow;
  openDeals: number;
  openAmount: number;
  lastInteraction: { date: string | null; type: string | null; title: string | null } | null;
}

export interface ContactsDto {
  contacts: ContactItem[];
  columns: ColumnDto[];
  databaseId: string;
  spaceId: string;
  canEdit: boolean;
  missing: string[];
  /** Devise des montants cumulés (celle des totaux du Pipeline). */
  currency: string;
}

export const CONTACT_SEARCH_MAX = 100;

function searchTerm(search: string): string {
  return search.trim().slice(0, CONTACT_SEARCH_MAX);
}

function searchCondition(ctx: CrmContext, search: string): SQL | undefined {
  const term = searchTerm(search);
  if (term === "") return undefined;
  // Nom en formule : invisible du SQL (valeurs non stockées), la recherche se fait après évaluation.
  if (contactNameOf(ctx)) return undefined;
  const pattern = `%${escapeLike(term)}%`;
  const conds = ["nom", "email", "structure"]
    .map((k) => ctx.fieldColumn("contacts", k))
    .filter((c): c is string => c !== null)
    .map((c) => ilike(sql`${userDatabaseRows.cells} ->> ${c}`, pattern));
  // Aucun champ cherchable raccordé : aucun résultat plutôt que tout.
  return conds.length === 0 ? sql`false` : or(...conds);
}

const blank = (v: string | null) => (v === null || v.trim() === "" ? null : v);

export async function loadContacts(
  ctx: CrmContext,
  q: { search: string; tz?: string },
  deps: CrmDeps = defaultCrmDeps(),
): Promise<ContactsDto> {
  const [rows, { deals, currency }, interactionRows] = await Promise.all([
    readRoleRows(ctx, "contacts", deps, searchCondition(ctx, q.search)),
    loadOpenDeals(ctx, false, deps),
    readRoleRows(ctx, "interactions", deps),
  ]);

  const stats = new Map<string, { openDeals: number; openAmount: number }>();
  for (const d of deals) {
    if (!d.contactId) continue;
    const s = stats.get(d.contactId) ?? { openDeals: 0, openAmount: 0 };
    s.openDeals += 1;
    s.openAmount += d.amount ?? 0;
    stats.set(d.contactId, s);
  }

  // Dernière interaction par dossier, puis par contact via ses dossiers (ouverts ou non : tous les dossiers).
  const allDeals = await loadAllDealContacts(ctx, deps);
  const lastByDeal = new Map<string, { date: string | null; type: string | null; title: string | null; sort: string }>();
  for (const r of interactionRows) {
    const it = toInteraction(r, ctx.fieldColumn);
    if (!it.dealId) continue;
    const sort = it.date ?? "";
    const prev = lastByDeal.get(it.dealId);
    if (!prev || sort > prev.sort) lastByDeal.set(it.dealId, { date: it.date, type: it.type, title: it.title, sort });
  }
  const lastByContact = new Map<string, { date: string | null; type: string | null; title: string | null; sort: string }>();
  for (const [dealId, contactId] of allDeals) {
    const last = lastByDeal.get(dealId);
    if (!last) continue;
    const prev = lastByContact.get(contactId);
    if (!prev || last.sort > prev.sort) lastByContact.set(contactId, last);
  }

  const readContact = contactReader(ctx);
  const term = searchTerm(q.search).toLowerCase();
  const inMemory = term !== "" && !!contactNameOf(ctx);
  const contacts = rows
    .filter((row) => {
      if (!inMemory) return true;
      const c = readContact(row);
      return [c.name, c.email, c.org].some((v) => (v ?? "").toLowerCase().includes(term));
    })
    .map((row): ContactItem => {
      const c = readContact(row);
      const s = stats.get(row.id);
      const last = lastByContact.get(row.id);
      return {
        ...c,
        email: blank(c.email),
        phone: blank(c.phone),
        org: blank(c.org),
        row,
        openDeals: s?.openDeals ?? 0,
        openAmount: s?.openAmount ?? 0,
        lastInteraction: last ? { date: last.date, type: last.type, title: last.title } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id));

  return {
    contacts,
    columns: ctx.columns.contacts,
    databaseId: ctx.databaseId("contacts"),
    spaceId: ctx.spaceId("contacts"),
    canEdit: ctx.canEdit("contacts"),
    missing: missingFields(ctx, "contacts", ["nom"]),
    currency,
  };
}

/** Couples (dossier, contact) de tous les dossiers, ouverts ou clos. */
async function loadAllDealContacts(ctx: CrmContext, deps: CrmDeps): Promise<Map<string, string>> {
  const col = ctx.fieldColumn("dossiers", "contact");
  const out = new Map<string, string>();
  if (col === null) return out;
  for (const r of await readRoleRows(ctx, "dossiers", deps)) {
    const v = r.cells[col];
    const first = Array.isArray(v) ? v[0] : null;
    if (typeof first === "string") out.set(r.id, first);
  }
  return out;
}
