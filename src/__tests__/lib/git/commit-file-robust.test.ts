import { describe, it, expect, vi, beforeEach } from "vitest";

const { gitMock, fsMock } = vi.hoisted(() => ({
  gitMock: {
    init: vi.fn(async () => {}),
    add: vi.fn(async () => {}),
    commit: vi.fn(async () => "sha1"),
  },
  fsMock: { mkdir: vi.fn(async () => {}), access: vi.fn(async () => {}), writeFile: vi.fn() },
}));

vi.mock("isomorphic-git", () => ({ default: gitMock }));
vi.mock("fs", () => ({ promises: fsMock }));
vi.mock("@/lib/storage/filesystem", () => ({ getWorkspacePath: (p: string) => `/ws/${p}` }));

import { commitFile } from "@/lib/git/repository";

describe("commitFile robustness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to a default author when name and email are null", async () => {
    await commitFile("r", "a.md", "msg", null, null);
    expect(gitMock.commit).toHaveBeenCalledWith(
      expect.objectContaining({ author: { name: "LorIAx", email: "system@loriax.local" } })
    );
  });

  it("initialises the repository when HEAD is missing", async () => {
    fsMock.access.mockRejectedValueOnce(new Error("ENOENT"));
    await commitFile("r", "a.md", "msg", "A", "a@b.c");
    expect(gitMock.init).toHaveBeenCalledTimes(1);
    expect(gitMock.commit).toHaveBeenCalled();
  });

  it("does not re-initialise an existing repository", async () => {
    await commitFile("r", "a.md", "msg", "A", "a@b.c");
    expect(gitMock.init).not.toHaveBeenCalled();
  });
});
