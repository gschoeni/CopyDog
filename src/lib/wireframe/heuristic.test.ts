import { describe, expect, it } from "vitest";

import { injectCopy } from "./inject";
import { generateWireframeHeuristic, type SectionForLayout } from "./heuristic";
import { sanitizeWireframeHtml } from "./sanitize";

const SECTIONS: SectionForLayout[] = [
  {
    slug: "hero",
    title: "Hero",
    elements: [
      { type: "eyebrow", text: "NEW" },
      { type: "h1", text: "Big headline" },
      { type: "p", text: "Support copy." },
      { type: "button", label: "Start", url: "#" },
    ],
  },
  {
    slug: "features",
    title: "Features",
    elements: [
      { type: "h2", text: "Why it works" },
      { type: "bullets", items: ["Fast", "Versioned", "Together"] },
    ],
  },
  {
    slug: "cta",
    title: "CTA",
    elements: [
      { type: "h2", text: "Ready?" },
      { type: "button", label: "Go", url: "#" },
    ],
  },
];

describe("generateWireframeHeuristic", () => {
  it("produces a slot for every copy element in every section", () => {
    const html = generateWireframeHeuristic(SECTIONS);
    for (const section of SECTIONS) {
      expect(html).toContain(`data-copy="${section.slug}"`);
    }
    expect(html.match(/data-element="h1"/g)).toHaveLength(1);
    expect(html.match(/data-element="button"/g)).toHaveLength(2);
    expect(html.match(/data-element="bullets"/g)).toHaveLength(1);
  });

  it("survives sanitization unchanged in structure", () => {
    const html = generateWireframeHeuristic(SECTIONS);
    const sanitized = sanitizeWireframeHtml(html);
    for (const section of SECTIONS) {
      expect(sanitized).toContain(`data-copy="${section.slug}"`);
    }
  });

  it("injection fills a generated wireframe with no leftovers", () => {
    const html = sanitizeWireframeHtml(generateWireframeHeuristic(SECTIONS));
    const injected = injectCopy(html, SECTIONS);
    expect(injected).toContain("Big headline");
    expect(injected).toContain("Fast");
    expect(injected).toContain(">Go</a>");
    expect(injected).not.toContain("wf-empty");
  });

  it("handles empty sections gracefully", () => {
    const html = generateWireframeHeuristic([{ slug: "empty", title: "Empty", elements: [] }]);
    expect(html).toContain(`data-copy="empty"`);
  });

  it("lays repeated h3+p copy out as a grid of cards", () => {
    const section: SectionForLayout = {
      slug: "features",
      title: "Features",
      elements: [
        { type: "h2", text: "Why it works" },
        { type: "h3", text: "Fast" },
        { type: "p", text: "Really fast." },
        { type: "h3", text: "Versioned" },
        { type: "p", text: "Every change kept." },
        { type: "h3", text: "Together" },
        { type: "p", text: "Built for teams." },
      ],
    };
    const html = generateWireframeHeuristic([section]);
    expect(html).toContain("wf-grid-3");
    expect(html.match(/wf-card/g)).toHaveLength(3);
    expect(html.match(/data-element="h3"/g)).toHaveLength(3);

    const injected = injectCopy(sanitizeWireframeHtml(html), [section]);
    expect(injected).toContain("Every change kept.");
    expect(injected).not.toContain("wf-empty");
  });

  it("gives quotes the testimonial treatment", () => {
    const section: SectionForLayout = {
      slug: "praise",
      title: "Praise",
      elements: [{ type: "quote", text: "It changed how we write." }],
    };
    const html = generateWireframeHeuristic([section]);
    expect(html).toContain("wf-section-tint");
    expect(html).toContain("wf-avatar-row");
    expect(html).toContain(`data-element="quote"`);
  });
});
