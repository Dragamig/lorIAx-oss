/**
 * Données des commentaires de ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";
import {
  createRowComment,
  editRowComment,
  deleteRowComment,
  restoreRowComment,
  type CommentActor,
} from "../row-comments";
import { formatMention, MAX_MENTIONS_PER_COMMENT } from "../row-comment-mentions";
import type { CanView } from "../row-eligibility";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("commentaires de ligne", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const SPACE = randomUUID();
  const DB = randomUUID();
  const OTHER_DB = randomUUID();
  const ROW = randomUUID();
  const OTHER_ROW = randomUUID();
  const AUTHOR = randomUUID();
  const EDITOR = randomUUID();
  const ADMIN = randomUUID();
  const M1 = randomUUID();
  const M2 = randomUUID();
  const NOACCESS = randomUUID();
  const OUTSIDER = randomUUID();
  const canView: CanView = async (id) => id !== NOACCESS;
  const author: CommentActor = { userId: AUTHOR, permission: "editor" };
  const editor: CommentActor = { userId: EDITOR, permission: "editor" };
  const admin: CommentActor = { userId: ADMIN, permission: "admin" };
  const m = (id: string) => formatMention("X", id);
  const base = { databaseId: DB, rowId: ROW, orgId: ORG, canView };

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_l3_comments");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM database_row_comments");
    await pool.query("DELETE FROM organization_members");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    for (const id of [AUTHOR, EDITOR, ADMIN, M1, M2, NOACCESS, OUTSIDER]) {
      await pool.query("INSERT INTO users (id, name) VALUES ($1, 'U')", [id]);
    }
    for (const id of [AUTHOR, EDITOR, ADMIN, M1, M2, NOACCESS]) {
      await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [ORG, id]);
    }
    for (const id of [DB, OTHER_DB]) {
      await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [id, SPACE]);
    }
  });

  const create = (body: string, a: CommentActor = author) => createRowComment(exec, { ...base, author: a, body });

  it("crée un commentaire, mentions limitées aux éligibles", async () => {
    const { comment, newMentions } = await create(
      `a ${m(M1)} ${m(NOACCESS)} ${m(OUTSIDER)} ${m(randomUUID())}`,
    );
    expect(comment.mentions).toEqual([M1]);
    expect(newMentions).toEqual([M1]);
    expect(comment.authorId).toBe(AUTHOR);
  });

  it("l'auto-mention reste dans mentions mais pas dans newMentions", async () => {
    const { comment, newMentions } = await create(`${m(AUTHOR)} ${m(M1)}`);
    expect(comment.mentions).toEqual([AUTHOR, M1]);
    expect(newMentions).toEqual([M1]);
  });

  it("tronque silencieusement à 100 mentions", async () => {
    const ids = Array.from({ length: MAX_MENTIONS_PER_COMMENT + 5 }, () => randomUUID());
    const { comment } = await create(`${ids.map(m).join(" ")} ${m(M1)}`);
    expect(comment.mentions).toEqual([]);
  });

  it("édition : seul l'auteur ; autre éditeur et admin forbidden", async () => {
    const { comment } = await create("x");
    const edit = (a: CommentActor) =>
      editRowComment(exec, { ...base, commentId: comment.id, actor: a, body: "y" });
    await expect(edit(editor)).rejects.toMatchObject({ code: "forbidden" });
    await expect(edit(admin)).rejects.toMatchObject({ code: "forbidden" });
    await expect(edit({ userId: AUTHOR, permission: "viewer" })).rejects.toMatchObject({ code: "forbidden" });
    const r = await edit(author);
    expect(r.comment.body).toBe("y");
    expect(r.comment.editedAt).not.toBeNull();
  });

  it("édition : newMentions ne contient que les nouvelles mentions, hors auteur", async () => {
    const { comment } = await create(m(M1));
    const r = await editRowComment(exec, {
      ...base,
      commentId: comment.id,
      actor: author,
      body: `${m(M1)} ${m(M2)} ${m(AUTHOR)}`,
    });
    expect(r.comment.mentions).toEqual([M1, M2, AUTHOR]);
    expect(r.newMentions).toEqual([M2]);
  });

  it("édition d'un commentaire supprimé : not_found, corps inchangé, aucune newMentions", async () => {
    const { comment } = await create("x");
    await deleteRowComment(exec, { databaseId: DB, rowId: ROW, commentId: comment.id, actor: admin });
    await expect(
      editRowComment(exec, { ...base, commentId: comment.id, actor: author, body: m(M1) }),
    ).rejects.toMatchObject({ code: "not_found" });
    const { rows } = await pool.query("SELECT body, mentions FROM database_row_comments WHERE id = $1", [comment.id]);
    expect(rows[0].body).toBe("x");
    expect(rows[0].mentions).toEqual([]);
  });

  it("suppression logique par l'auteur et par un admin, forbidden pour un autre éditeur", async () => {
    const a = await create("x");
    const b = await create("y");
    const args = (id: string, actor: CommentActor) => ({ databaseId: DB, rowId: ROW, commentId: id, actor });
    await expect(deleteRowComment(exec, args(a.comment.id, editor))).rejects.toMatchObject({ code: "forbidden" });
    expect((await deleteRowComment(exec, args(a.comment.id, author))).deletedAt).not.toBeNull();
    expect((await deleteRowComment(exec, args(b.comment.id, admin))).deletedAt).not.toBeNull();
  });

  it("suppression deux fois : idempotente", async () => {
    const { comment } = await create("x");
    const args = { databaseId: DB, rowId: ROW, commentId: comment.id, actor: author };
    const first = await deleteRowComment(exec, args);
    const second = await deleteRowComment(exec, args);
    expect(second.deletedAt?.getTime()).toBe(first.deletedAt?.getTime());
  });

  it("restauration : autre éditeur forbidden, admin ok, non supprimé sans erreur", async () => {
    const { comment } = await create("x");
    const args = (actor: CommentActor) => ({ databaseId: DB, rowId: ROW, commentId: comment.id, actor });
    expect((await restoreRowComment(exec, args(author))).deletedAt).toBeNull();
    await deleteRowComment(exec, args(author));
    await expect(restoreRowComment(exec, args(editor))).rejects.toMatchObject({ code: "forbidden" });
    expect((await restoreRowComment(exec, args(admin))).deletedAt).toBeNull();
  });

  it("commentaire d'une autre ligne ou d'une autre base : not_found", async () => {
    const { comment } = await create("x");
    await expect(
      deleteRowComment(exec, { databaseId: DB, rowId: OTHER_ROW, commentId: comment.id, actor: admin }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      editRowComment(exec, { ...base, databaseId: OTHER_DB, commentId: comment.id, actor: author, body: "y" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      restoreRowComment(exec, { databaseId: DB, rowId: ROW, commentId: randomUUID(), actor: admin }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("auteur supprimé : modification forbidden pour tous, suppression permise à l'admin", async () => {
    const { comment } = await create("x");
    await pool.query("UPDATE database_row_comments SET author_id = NULL WHERE id = $1", [comment.id]);
    for (const a of [author, editor, admin]) {
      await expect(
        editRowComment(exec, { ...base, commentId: comment.id, actor: a, body: "y" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(
      deleteRowComment(exec, { databaseId: DB, rowId: ROW, commentId: comment.id, actor: editor }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const r = await deleteRowComment(exec, { databaseId: DB, rowId: ROW, commentId: comment.id, actor: admin });
    expect(r.deletedAt).not.toBeNull();
  });
});
