import { describe, expect, it } from "vitest";

import type { Block } from "./blocks";
import { deriveSectionTitle, splitIntoSections } from "./sections";

const h1 = (text: string): Block => ({ type: "h1", text });
const h2 = (text: string): Block => ({ type: "h2", text });
const h3 = (text: string): Block => ({ type: "h3", text });
const p = (text: string): Block => ({ type: "p", text });
const eyebrow = (text: string): Block => ({ type: "eyebrow", text });
const button = (label: string): Block => ({ type: "button", label, url: "#" });

describe("splitIntoSections", () => {
  it("keeps a single hero together (eyebrow + h1 + body + cta)", () => {
    const blocks = [eyebrow("NEW"), h1("Big claim"), p("Support."), button("Go")];
    expect(splitIntoSections(blocks)).toEqual([blocks]);
  });

  it("splits at an h2 that follows body content", () => {
    const blocks = [h1("Hero"), p("Body."), h2("Features"), p("More.")];
    expect(splitIntoSections(blocks)).toEqual([
      [h1("Hero"), p("Body.")],
      [h2("Features"), p("More.")],
    ]);
  });

  it("does not split a subtitle directly under a title", () => {
    const blocks = [h1("Title"), h2("Subtitle"), p("Body.")];
    expect(splitIntoSections(blocks)).toEqual([blocks]);
  });

  it("h3-h6 never split", () => {
    const blocks = [h1("Hero"), p("Body."), h3("Detail"), p("Fine print.")];
    expect(splitIntoSections(blocks)).toEqual([blocks]);
  });

  it("an h2 after an h3 body still splits", () => {
    const blocks = [h1("Hero"), p("Body."), h3("Detail"), h2("Pricing"), p("Plans.")];
    expect(splitIntoSections(blocks)).toEqual([
      [h1("Hero"), p("Body."), h3("Detail")],
      [h2("Pricing"), p("Plans.")],
    ]);
  });

  it("carries an eyebrow forward into the new section", () => {
    const blocks = [h1("Hero"), p("Body."), eyebrow("PRICING"), h2("Plans"), p("Cheap.")];
    expect(splitIntoSections(blocks)).toEqual([
      [h1("Hero"), p("Body.")],
      [eyebrow("PRICING"), h2("Plans"), p("Cheap.")],
    ]);
  });

  it("splits repeatedly for pasted multi-section copy", () => {
    const blocks = [h1("A"), p("a"), h2("B"), p("b"), h2("C"), p("c")];
    expect(splitIntoSections(blocks)).toHaveLength(3);
  });

  it("an empty heading still splits (mid-typing '## ')", () => {
    const blocks = [h1("Hero"), p("Body."), h2("")];
    expect(splitIntoSections(blocks)).toEqual([
      [h1("Hero"), p("Body.")],
      [h2("")],
    ]);
  });

  it("never returns empty and keeps empty input as one group", () => {
    expect(splitIntoSections([])).toEqual([[]]);
  });
});

describe("deriveSectionTitle", () => {
  it("uses the first non-empty heading, stripped of inline markdown", () => {
    expect(deriveSectionTitle([eyebrow("NEW"), h1("Ship **it**")])).toBe("Ship it");
  });

  it("falls back when no heading", () => {
    expect(deriveSectionTitle([p("just prose")])).toBe("Untitled section");
  });

  it("clips very long headings", () => {
    expect(deriveSectionTitle([h1("x".repeat(80))])).toHaveLength(60);
  });
});
