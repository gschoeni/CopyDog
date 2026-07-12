import { describe, expect, it } from "vitest";

import { diffLines, hasChanges } from "./diff";

describe("diffLines", () => {
  it("marks identical content as same", () => {
    const diff = diffLines("a\nb\n", "a\nb\n");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
    expect(hasChanges(diff)).toBe(false);
  });

  it("detects additions, removals, and edits", () => {
    const diff = diffLines("# Hello\n\nOld line\n", "# Hello\n\nNew line\nExtra\n");
    expect(diff).toEqual([
      { kind: "same", text: "# Hello" },
      { kind: "same", text: "" },
      { kind: "removed", text: "Old line" },
      { kind: "added", text: "New line" },
      { kind: "added", text: "Extra" },
    ]);
    expect(hasChanges(diff)).toBe(true);
  });

  it("handles empty sides", () => {
    expect(diffLines("", "a\n")).toEqual([{ kind: "added", text: "a" }]);
    expect(diffLines("a\n", "")).toEqual([{ kind: "removed", text: "a" }]);
    expect(diffLines("", "")).toEqual([]);
  });
});
