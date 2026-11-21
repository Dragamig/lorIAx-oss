import { describe, it, expect } from "vitest";
import { taskEventKindFor } from "@/lib/tasks/record-task-event";

describe("taskEventKindFor", () => {
  it.each([
    ["open", "done", "completed"],
    ["in_progress", "done", "completed"],
    ["done", "open", "reopened"],
    ["done", "in_progress", "reopened"],
    ["done", "cancelled", null],
    ["open", "in_progress", null],
    ["cancelled", "open", null],
    ["done", "done", null],
  ] as const)("%s vers %s : %s", (prev, next, expected) => {
    expect(taskEventKindFor(prev, next)).toBe(expected);
  });
});
