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
});
