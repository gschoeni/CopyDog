import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNextPath("/projects/abc")).toBe("/projects/abc");
  });

  it.each([
    [null, "null"],
    ["", "empty"],
    ["https://evil.example", "external URL"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "backslash trick"],
    ["javascript:alert(1)", "javascript scheme"],
  ])("falls back for %s (%s)", (input, _label) => {
    expect(safeNextPath(input)).toBe("/projects");
  });
});
