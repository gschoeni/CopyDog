import { describe, expect, it } from "vitest";

import type { Element } from "./elements";
import { deriveSectionTitle } from "./sections";

const h1 = (text: string): Element => ({ type: "h1", text });
const p = (text: string): Element => ({ type: "p", text });
const eyebrow = (text: string): Element => ({ type: "eyebrow", text });

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
