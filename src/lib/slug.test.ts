import { describe, expect, it } from "vitest";

import { shortId, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Landing Page")).toBe("acme-landing-page");
  });

  it("strips accents and symbols", () => {
    expect(slugify("Café & Crème!")).toBe("cafe-creme");
  });

  it("collapses runs and trims hyphens", () => {
    expect(slugify("  --Hello   World--  ")).toBe("hello-world");
  });

  it("falls back for empty input", () => {
    expect(slugify("!!!")).toBe("untitled");
  });
});

describe("shortId", () => {
  it("generates ids of the requested length from the safe alphabet", () => {
    const id = shortId(8);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
  });

  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => shortId()));
    expect(ids.size).toBe(50);
  });
});
