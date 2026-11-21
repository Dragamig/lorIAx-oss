import { describe, it, expect, vi, beforeEach } from "vitest";

const queue: unknown[][] = [];
const setCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({ limit: async () => queue.shift() ?? [] }),
    }),
  });
  const update = () => ({
    set: (values: Record<string, unknown>) => {
      setCalls.push(values);
      return { where: async () => undefined };
    },
  });
  return { db: { select, update } };
});
vi.mock("@/lib/storage/filesystem", () => ({ writeDocument: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ commitFile: vi.fn() }));
vi.mock("@/lib/collab/auth-ws", () => ({ checkCollabDocumentEditAccess: vi.fn() }));
vi.mock("@/lib/tasks/sync-document-tasks", () => ({
  syncDocumentTasks: vi.fn(async () => undefined),
}));

import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { syncYjsToStorage } from "../markdown-sync";
import { writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";

const schema = getSchema([StarterKit]);
const makeDoc = () =>
  prosemirrorJSONToYDoc(
    schema,
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bonjour" }] }] },
    "default"
  ) as Y.Doc;

beforeEach(() => {
  queue.length = 0;
  setCalls.length = 0;
  vi.mocked(writeDocument).mockReset();
  vi.mocked(commitFile).mockReset();
  queue.push([{ filePath: "a.md", spaceId: "s1", title: "Titre" }], [{ gitRepoPath: "repo" }]);
});

describe("syncYjsToStorage : options", () => {
  it("sans options : comportement historique", async () => {
    const ok = await syncYjsToStorage("d1", makeDoc());
    expect(ok).toBe(true);
    expect(writeDocument).toHaveBeenCalledWith("repo", "a.md", "Bonjour\n");
    expect(commitFile).toHaveBeenCalledWith("repo", "a.md", "Auto-save: Titre", "LorIAx Collab", "collab@loriax.local");
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].contentText).toBe("Bonjour\n");
    expect(setCalls[0].updatedAt).toBeInstanceOf(Date);
  });

  it("avec options : message, auteur, updatedAt intact", async () => {
    const ok = await syncYjsToStorage("d1", makeDoc(), undefined, undefined, {
      commitMessage: "Retrait attachments",
      author: { name: "Script", email: "script@loriax.local" },
      touchUpdatedAt: false,
    });
    expect(ok).toBe(true);
    expect(commitFile).toHaveBeenCalledWith("repo", "a.md", "Retrait attachments", "Script", "script@loriax.local");
    expect(setCalls[0]).toEqual({ contentText: "Bonjour\n" });
    expect("updatedAt" in setCalls[0]).toBe(false);
  });

  it("échec d'écriture disque : retourne false sans lever", async () => {
    vi.mocked(writeDocument).mockRejectedValueOnce(new Error("disque plein"));
    await expect(syncYjsToStorage("d1", makeDoc())).resolves.toBe(false);
    expect(commitFile).not.toHaveBeenCalled();
  });

  it("document introuvable : retourne false", async () => {
    queue.length = 0;
    await expect(syncYjsToStorage("d1", makeDoc())).resolves.toBe(false);
  });
});
