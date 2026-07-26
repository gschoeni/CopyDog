import { describe, expect, it } from "vitest";

import {
  chatContextListSchema,
  chatContextRefSchema,
  contextRefLabel,
  describeContextRefs,
  type PageContextRef,
  type ReferenceContextRef,
} from "./context";

const heroSelection: PageContextRef = {
  kind: "page",
  source: "copy",
  sectionSlug: "sec-ab12",
  sectionTitle: "Hero",
  text: "Ship your docs faster",
  elementType: null,
};

const wireframeSection: PageContextRef = {
  kind: "page",
  source: "wireframe",
  sectionSlug: "sec-cd34",
  sectionTitle: "Features",
  text: null,
  elementType: null,
};

const screenshot: ReferenceContextRef = {
  kind: "reference",
  id: "ref_abc123",
  media: "image",
  label: "pricing-page.png",
  sourceUrl: null,
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
      {
        kind: "page",
        source: "wireframe",
        sectionSlug: "sec-cd34",
        sectionTitle: "Features",
        text: "Fast sync",
        elementType: "h2",
      },
    ]);
    expect(described).toContain("1. ");
    expect(described).toContain("2. ");
    expect(described).toContain('inside a "h2" element');
  });

  it("falls back to loose copy when there is no section", () => {
    const described = describeContextRefs([
      { kind: "page", source: "copy", sectionSlug: null, sectionTitle: null, text: "orphan line", elementType: null },
    ]);
    expect(described).toContain("loose copy outside any section");
  });

  it("lists references by id, with their origin, in their own block", () => {
    const described = describeContextRefs([
      heroSelection,
      screenshot,
      { kind: "reference", id: "ref_def456", media: "text", label: "stripe.com", sourceUrl: "https://stripe.com/" },
    ]);
    expect(described).toContain("reference material");
    expect(described).toContain("Reference id: ref_abc123");
    expect(described).toContain("https://stripe.com/");
    expect(described).toContain("read_reference");
    // page selections keep their own framing rather than merging into one list
    expect(described).toContain("attached page context");
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

  it("uses a reference's own label", () => {
    expect(contextRefLabel(screenshot)).toBe("pricing-page.png");
  });
});

describe("chatContextRefSchema", () => {
  it("reads rows written before references existed as page context", () => {
    const { kind: _kind, ...legacy } = heroSelection;
    expect(chatContextRefSchema.parse(legacy)).toEqual(heroSelection);
  });

  it("round-trips a reference descriptor", () => {
    expect(chatContextRefSchema.parse(screenshot)).toEqual(screenshot);
  });
});

describe("chatContextListSchema", () => {
  it("accepts a valid list and rejects oversized ones", () => {
    expect(chatContextListSchema.safeParse([heroSelection, wireframeSection, screenshot]).success).toBe(true);
    expect(chatContextListSchema.safeParse(Array.from({ length: 9 }, () => heroSelection)).success).toBe(false);
    expect(chatContextListSchema.safeParse([{ ...heroSelection, text: "" }]).success).toBe(false);
  });

  it("caps references separately from page selections", () => {
    expect(chatContextListSchema.safeParse(Array.from({ length: 4 }, () => screenshot)).success).toBe(true);
    expect(chatContextListSchema.safeParse(Array.from({ length: 5 }, () => screenshot)).success).toBe(false);
    // a full complement of each still fits
    expect(
      chatContextListSchema.safeParse([
        ...Array.from({ length: 8 }, () => heroSelection),
        ...Array.from({ length: 4 }, () => screenshot),
      ]).success,
    ).toBe(true);
  });
});
