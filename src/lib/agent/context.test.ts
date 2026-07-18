import { describe, expect, it } from "vitest";

import { chatContextListSchema, contextRefLabel, describeContextRefs, type ChatContextRef } from "./context";

const heroSelection: ChatContextRef = {
  source: "copy",
  sectionSlug: "sec-ab12",
  sectionTitle: "Hero",
  text: "Ship your docs faster",
  elementType: null,
};

const wireframeSection: ChatContextRef = {
  source: "wireframe",
  sectionSlug: "sec-cd34",
  sectionTitle: "Features",
  text: null,
  elementType: null,
};

describe("describeContextRefs", () => {
  it("is empty with no refs", () => {
    expect(describeContextRefs([])).toBe("");
  });

  it("renders a text selection with its exact text and location", () => {
    const described = describeContextRefs([heroSelection]);
    expect(described).toContain('the "Hero" section (slug: sec-ab12)');
    expect(described).toContain('"""\nShip your docs faster\n"""');
    expect(described).toContain("copy editor");
  });

  it("renders a whole-section attachment without a text block", () => {
    const described = describeContextRefs([wireframeSection]);
    expect(described).toContain('The whole "Features" section (slug: sec-cd34)');
    expect(described).toContain("wireframe");
    expect(described).not.toContain('"""');
  });

  it("numbers multiple refs and includes the element slot", () => {
    const described = describeContextRefs([
      heroSelection,
      { source: "wireframe", sectionSlug: "sec-cd34", sectionTitle: "Features", text: "Fast sync", elementType: "h2" },
    ]);
    expect(described).toContain("1. ");
    expect(described).toContain("2. ");
    expect(described).toContain('inside a "h2" element');
  });

  it("falls back to loose copy when there is no section", () => {
    const described = describeContextRefs([
      { source: "copy", sectionSlug: null, sectionTitle: null, text: "orphan line", elementType: null },
    ]);
    expect(described).toContain("loose copy outside any section");
  });
});

describe("contextRefLabel", () => {
  it("prefers the section title, then slug, then a source fallback", () => {
    expect(contextRefLabel(heroSelection)).toBe("Hero");
    expect(contextRefLabel({ ...heroSelection, sectionTitle: null })).toBe("sec-ab12");
    expect(contextRefLabel({ ...heroSelection, sectionTitle: null, sectionSlug: null })).toBe("Copy selection");
    expect(contextRefLabel({ ...wireframeSection, sectionTitle: null, sectionSlug: null })).toBe(
      "Wireframe selection",
    );
  });
});

describe("chatContextListSchema", () => {
  it("accepts a valid list and rejects oversized ones", () => {
    expect(chatContextListSchema.safeParse([heroSelection, wireframeSection]).success).toBe(true);
    expect(chatContextListSchema.safeParse(Array.from({ length: 9 }, () => heroSelection)).success).toBe(false);
    expect(chatContextListSchema.safeParse([{ ...heroSelection, text: "" }]).success).toBe(false);
  });
});
