import { describe, expect, it } from "vitest";

import type { Block } from "./blocks";
import { parseSectionMarkdown, serializeBlocks } from "./markdown";

describe("parseSectionMarkdown", () => {
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

    expect(parseSectionMarkdown(md)).toEqual([
      { type: "eyebrow", text: "NEW FOR 2026" },
      { type: "h1", text: "Ship copy and wireframes together" },
      { type: "p", text: "Stop pasting between docs and design tools." },
      { type: "button", label: "Start free", url: "https://copydog.app/signup" },
      { type: "bullets", items: ["No credit card", "Unlimited collaborators"] },
    ]);
  });

  it("parses all heading levels", () => {
    for (let level = 1; level <= 6; level++) {
      expect(parseSectionMarkdown(`${"#".repeat(level)} Title`)).toEqual([
        { type: `h${level}`, text: "Title" },
      ]);
    }
  });

  it("keeps inline markdown inside block text", () => {
    expect(parseSectionMarkdown("Some **bold** and *italic* copy.")).toEqual([
      { type: "p", text: "Some **bold** and *italic* copy." },
    ]);
  });

  it("treats a paragraph with a link amid text as a paragraph, not a button", () => {
    expect(parseSectionMarkdown("Read [the docs](https://x.dev) today.")).toEqual([
      { type: "p", text: "Read [the docs](https://x.dev) today." },
    ]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseSectionMarkdown("")).toEqual([]);
    expect(parseSectionMarkdown("\n\n  \n")).toEqual([]);
  });

  it("ignores an eyebrow marker with no text", () => {
    expect(parseSectionMarkdown("<!--eyebrow-->")).toEqual([]);
  });
});

describe("serializeBlocks", () => {
  it("writes readable markdown", () => {
    const blocks: Block[] = [
      { type: "eyebrow", text: "PRICING" },
      { type: "h2", text: "Simple plans" },
      { type: "p", text: "One price, everything included." },
      { type: "button", label: "See pricing", url: "#" },
    ];
    expect(serializeBlocks(blocks)).toBe(
      ["<!--eyebrow-->", "PRICING", "", "## Simple plans", "", "One price, everything included.", "", "[See pricing](#)", ""].join(
        "\n",
      ),
    );
  });

  it("serializes empty input to an empty string", () => {
    expect(serializeBlocks([])).toBe("");
  });

  it("defaults empty button urls to #", () => {
    expect(serializeBlocks([{ type: "button", label: "Go", url: "" }])).toBe("[Go](#)\n");
  });
});

describe("round-trip", () => {
  const cases: [string, Block[]][] = [
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
    ["multiple buttons", [
      { type: "button", label: "Primary", url: "https://a.dev" },
      { type: "button", label: "Secondary", url: "https://b.dev" },
    ]],
  ];

  it.each(cases)("parse(serialize(x)) === x — %s", (_name, blocks) => {
    expect(parseSectionMarkdown(serializeBlocks(blocks))).toEqual(blocks);
  });
});
