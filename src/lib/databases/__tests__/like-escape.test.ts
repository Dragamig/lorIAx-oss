import { describe, it, expect } from "vitest";
import { escapeLike } from "../like-escape";

describe("escapeLike", () => {
  it("échappe %, _ et \\", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });
});
