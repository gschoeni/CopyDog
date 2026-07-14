import { describe, expect, it } from "vitest";

import { parseInline, serializeInline, type TextRun } from "./inline";

describe("parseInline", () => {
  it("parses plain text to one run", () => {
    expect(parseInline("hello world")).toEqual([{ text: "hello world" }]);
  });

  it("parses bold, italic, and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", code: true },
    ]);
  });

  it("parses bold-italic", () => {
    expect(parseInline("***loud***")).toEqual([{ text: "loud", bold: true, italic: true }]);
  });

  it("treats unbalanced markers as plain text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
  });

  it("unescapes backslash escapes", () => {
    expect(parseInline("not \\*italic\\*")).toEqual([{ text: "not *italic*" }]);
  });
});

describe("inline links", () => {
  it("parses an anchor into a link run", () => {
    expect(parseInline("read [the docs](https://x.dev) now")).toEqual([
      { text: "read " },
      { text: "the docs", link: "https://x.dev" },
      { text: " now" },
    ]);
  });

  it("keeps escaped brackets as plain text", () => {
    const runs = [{ text: "[not a link](nope)" }];
    expect(parseInline(serializeInline(runs))).toEqual(runs);
  });
});

describe("serializeInline / round-trip", () => {
  const cases: [string, TextRun[]][] = [
    ["mixed marks", [{ text: "Get " }, { text: "twice", bold: true }, { text: " the " }, { text: "flow", italic: true }]],
    ["code run", [{ text: "run " }, { text: "npm i", code: true }]],
    ["bold italic", [{ text: "very", bold: true, italic: true }]],
    ["literal asterisks", [{ text: "2 * 3 * 4" }]],
    ["literal backtick-free code chars", [{ text: "a*b", bold: true }]],
    ["link run", [{ text: "before " }, { text: "docs", link: "https://x.dev" }, { text: " after" }]],
    ["link with bracket in label", [{ text: "a]b", link: "#" }]],
  ];

  it.each(cases)("parse(serialize(x)) === x — %s", (_name, runs) => {
    const md = serializeInline(runs);
    expect(parseInline(md)).toEqual(runs);
  });
});
