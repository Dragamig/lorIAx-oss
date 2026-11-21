import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/media/list", () => ({ listMedia: h.list }));

import { searchMedia } from "./search";
import type { SessionUser } from "@/types";

const user = { id: "u1" } as SessionUser;
const item = (over: Record<string, unknown>) => ({
  id: "m1",
  filename: "photo.png",
  title: null,
  altText: null,
  kind: "image",
  spaceName: "Marketing",
  thumbnailUrl: "/api/media/m1/thumbnail",
  tags: [],
  ...over,
});

beforeEach(() => {
  h.list.mockReset();
  h.list.mockResolvedValue({ items: [], nextCursor: null });
});

describe("searchMedia", () => {
  it("rend une liste vide sous 2 caractères sans interroger la base", async () => {
    expect(await searchMedia(user, "org1", "a")).toEqual([]);
    expect(await searchMedia(user, "org1", " b ")).toEqual([]);
    expect(h.list).not.toHaveBeenCalled();
  });

  it("passe par la visibilité de listMedia : vue all (jamais corbeille), organisation, pas d'ids", async () => {
    await searchMedia(user, "org1", "logo");
    expect(h.list).toHaveBeenCalledTimes(1);
    const [u, org, f] = h.list.mock.calls[0];
    expect(u).toBe(user);
    expect(org).toBe("org1");
    expect(f.view).toBe("all");
    expect(f.q).toBe("logo");
    expect(f.ids).toBeUndefined();
    expect(f.limit).toBe(5);
  });

  it("ne rend que ce que listMedia accepte de montrer (non-fuite)", async () => {
    h.list.mockResolvedValue({ items: [], nextCursor: null });
    expect(await searchMedia(user, "org1", "logo")).toEqual([]);
  });

  it("indique la source de la correspondance : nom, titre, texte alternatif, tag", async () => {
    h.list.mockResolvedValue({
      items: [
        item({ id: "a", filename: "logo.png" }),
        item({ id: "b", filename: "x.png", title: "Le Logo rouge" }),
        item({ id: "c", filename: "y.png", altText: "un logo bleu" }),
        item({ id: "d", filename: "z.png", tags: [{ id: "t", label: "logos" }] }),
        item({ id: "e", filename: "w.png" }),
      ],
      nextCursor: null,
    });
    const hits = await searchMedia(user, "org1", "logo");
    expect(hits.map((x) => x.matchedOn)).toEqual(["name", "title", "alt", "tag", "description"]);
    expect(hits[2].snippet).toBe("un logo bleu");
    expect(hits[0]).not.toHaveProperty("tags");
  });
});
