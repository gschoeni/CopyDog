import { describe, expect, it } from "vitest";

import type { Element } from "./elements";
import { parseElementsMarkdown, serializeElements } from "./markdown";

describe("parseElementsMarkdown", () => {
  it("parses a typical hero section", () => {
    const md = [
      "<!--eyebrow-->",
      "NEW FOR 2026",
      "",
      "# Ship copy and wireframes together",
      "",
      "Stop pasting between docs and design tools.",
      "",
      "[Start free](https://copydog.app/signup)",
      "",
      "- No credit card",
      "- Unlimited collaborators",
    ].join("\n");

    expect(parseElementsMarkdown(md)).toEqual([
      { type: "eyebrow", text: "NEW FOR 2026" },
      { type: "h1", text: "Ship copy and wireframes together" },
      { type: "p", text: "Stop pasting between docs and design tools." },
      { type: "button", label: "Start free", url: "https://copydog.app/signup" },
      { type: "bullets", items: ["No credit card", "Unlimited collaborators"] },
    ]);
  });

  it("parses all heading levels", () => {
    for (let level = 1; level <= 6; level++) {
      expect(parseElementsMarkdown(`${"#".repeat(level)} Title`)).toEqual([
        { type: `h${level}`, text: "Title" },
      ]);
    }
  });

  it("keeps inline markdown inside block text", () => {
    expect(parseElementsMarkdown("Some **bold** and *italic* copy.")).toEqual([
      { type: "p", text: "Some **bold** and *italic* copy." },
    ]);
  });

  it("treats a paragraph with a link amid text as a paragraph, not a button", () => {
    expect(parseElementsMarkdown("Read [the docs](https://x.dev) today.")).toEqual([
      { type: "p", text: "Read [the docs](https://x.dev) today." },
    ]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseElementsMarkdown("")).toEqual([]);
    expect(parseElementsMarkdown("\n\n  \n")).toEqual([]);
  });

  it("ignores an eyebrow marker with no text", () => {
    expect(parseElementsMarkdown("<!--eyebrow-->")).toEqual([]);
  });
});

describe("serializeElements", () => {
  it("writes readable markdown", () => {
    const blocks: Element[] = [
      { type: "eyebrow", text: "PRICING" },
      { type: "h2", text: "Simple plans" },
      { type: "p", text: "One price, everything included." },
      { type: "button", label: "See pricing", url: "#" },
    ];
    expect(serializeElements(blocks)).toBe(
      ["<!--eyebrow-->", "PRICING", "", "## Simple plans", "", "One price, everything included.", "", "[See pricing](#)", ""].join(
        "\n",
      ),
    );
  });

  it("serializes empty input to an empty string", () => {
    expect(serializeElements([])).toBe("");
  });

  it("defaults empty button urls to #", () => {
    expect(serializeElements([{ type: "button", label: "Go", url: "" }])).toBe("[Go](#)\n");
  });
});

describe("quote blocks", () => {
  it("parses > lines into a quote", () => {
    expect(parseElementsMarkdown("> Simply the best tool.\n> Ever.")).toEqual([
      { type: "quote", text: "Simply the best tool. Ever." },
    ]);
  });

  it("serializes quotes and protects paragraphs starting with >", () => {
    expect(serializeElements([{ type: "quote", text: "Wow." }])).toBe("> Wow.\n");
    const tricky = [{ type: "p" as const, text: "> not a quote" }];
    expect(parseElementsMarkdown(serializeElements(tricky))).toEqual(tricky);
  });
});

describe("round-trip", () => {
  const cases: [string, Element[]][] = [
    ["hero", [
      { type: "eyebrow", text: "NEW" },
      { type: "h1", text: "Big claim" },
      { type: "p", text: "Support copy with **bold** words." },
      { type: "button", label: "Get started", url: "#" },
    ]],
    ["paragraph starting with #", [{ type: "p", text: "#1 in customer love" }]],
    ["paragraph starting with dash", [{ type: "p", text: "- or so they say" }]],
    ["paragraph that looks like a button", [{ type: "p", text: "[Not a button](https://x.dev)" }]],
    ["paragraph starting with a comment", [{ type: "p", text: "<!--eyebrow--> is our marker" }]],
    ["bullets with tricky items", [{ type: "bullets", items: ["- nested-looking", "#hashtag item"] }]],
    ["heading with inline emphasis", [{ type: "h3", text: "The *fine* print" }]],
    ["empty bullets pruned to none", []],
    ["quote with inline emphasis", [{ type: "quote", text: "It *just* works" }]],
    ["multiple buttons", [
      { type: "button", label: "Primary", url: "https://a.dev" },
      { type: "button", label: "Secondary", url: "https://b.dev" },
    ]],
  ];

  it.each(cases)("parse(serialize(x)) === x — %s", (_name, blocks) => {
    expect(parseElementsMarkdown(serializeElements(blocks))).toEqual(blocks);
  });
});
