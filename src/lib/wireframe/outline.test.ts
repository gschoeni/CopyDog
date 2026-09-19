import { describe, expect, it } from "vitest";

import { describeSectionLayout, outlineWireframe } from "./outline";

const PAGE = `<section class="wf-section" data-copy="hero"><div class="wf-container wf-center"><p class="wf-eyebrow" data-element="eyebrow"></p><h1 class="wf-h1" data-element="h1"></h1><p class="wf-p" data-element="p"></p><div class="wf-actions"><a class="wf-button" data-element="button" href="#"></a></div><div class="wf-media" aria-hidden="true"></div></div></section>
<section class="wf-section wf-section-tint" data-copy="story"><div class="wf-container wf-split-reverse wf-split"><div class="wf-stack" data-overflow><h2 class="wf-h2" data-element="h2"></h2><p class="wf-p" data-element="p"></p></div><div class="wf-media" aria-hidden="true"></div></div></section>
<section class="wf-section" data-copy="features"><div class="wf-container wf-grid-3"><div class="wf-card"><h3 class="wf-h3" data-element="h3"></h3><p class="wf-p" data-element="p"></p></div><div class="wf-card"><h3 class="wf-h3" data-element="h3"></h3><p class="wf-p" data-element="p"></p></div><div class="wf-card"><h3 class="wf-h3" data-element="h3"></h3><p class="wf-p" data-element="p"></p></div></div></section>
<section class="wf-section" data-copy="praise"><div class="wf-container wf-center"><blockquote class="wf-quote" data-element="quote"></blockquote><div class="wf-avatar-row" aria-hidden="true"><span class="wf-avatar"></span><span class="wf-pill"></span></div></div></section>
<section class="wf-section" data-copy="faq"><div class="wf-container wf-stack"><div class="wf-faq-item"><h4 class="wf-h4" data-element="h4"></h4><p class="wf-p" data-element="p"></p></div><div class="wf-faq-item"><h4 class="wf-h4" data-element="h4"></h4><p class="wf-p" data-element="p"></p></div></div></section>
<section class="wf-section" data-copy="imported"><div><div></div></div></section>`;

describe("describeSectionLayout", () => {
  it("names the pattern, the tint, and the slots", () => {
    const lines = outlineWireframe(PAGE).split("\n");
    expect(lines[0]).toBe("1. hero — centered hero; media below; slots: eyebrow, h1, p, button");
    expect(lines[1]).toBe("2. story — split, media left; tinted; slots: h2, p");
    expect(lines[2]).toBe("3. features — 3-column grid of 3 cards; slots: h3, p, h3, p, h3, p");
    expect(lines[3]).toBe("4. praise — testimonial; slots: quote");
    expect(lines[4]).toBe("5. faq — FAQ list, 2 rows; slots: h4, p, h4, p");
    expect(lines[5]).toBe("6. imported — single column; NO copy slots");
  });

  it("works on a lone section fragment", () => {
    expect(describeSectionLayout(`<section data-copy="x" class="wf-section wf-section-tint"><div class="wf-split"><h2 data-element="h2"></h2></div></section>`)).toBe(
      "split, media right; tinted; slots: h2",
    );
  });
});

describe("outlineWireframe", () => {
  it("adds titles, marks the section being designed, and flags copy with no slot", () => {
    const outline = outlineWireframe(
      PAGE,
      [
        { slug: "hero", title: "Hero", elements: [{ type: "h1", text: "a" }, { type: "p", text: "b" }, { type: "p", text: "c" }] },
        { slug: "story", title: "Our story" },
      ],
      { highlight: "story" },
    );
    expect(outline).toContain("1. hero (Hero) — centered hero; media below; slots: eyebrow, h1, p, button; NO SLOT for 1 element (p) — they render as overflow");
    expect(outline).toContain("2. story (Our story) — split, media left; tinted; slots: h2, p  ← the section being designed");
  });

  it("is empty for an empty wireframe", () => {
    expect(outlineWireframe("")).toBe("");
  });
});
