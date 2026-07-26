import { describe, expect, it } from "vitest";

import { outlineHtmlStructure } from "./outline";

/** A page shaped like the one the layout evaluation used. */
const PAGE = `<main>
  <section><div><h1>Ship faster</h1><p>Docs that keep up.</p><a href="#">Start</a></div><img src="hero.png"></section>
  <section><p>Trusted by</p><div class="logos">
    <div class="logo"><img src="1.png"></div><div class="logo"><img src="2.png"></div>
    <div class="logo"><img src="3.png"></div><div class="logo"><img src="4.png"></div>
  </div></section>
  <section><h2>Features</h2><div class="grid">
    <div class="card"><img src="i1.png"><h3>Branch</h3><p>Every draft.</p></div>
    <div class="card"><img src="i2.png"><h3>Review</h3><p>Real diffs.</p></div>
    <div class="card"><img src="i3.png"><h3>Publish</h3><p>One click.</p></div>
  </div></section>
  <section><img src="shot.png"><div><h2>See changes</h2><p>Side by side.</p></div></section>
</main>`;

describe("outlineHtmlStructure", () => {
  const outline = outlineHtmlStructure(PAGE);

  it("reports one numbered band per section, in order", () => {
    expect(outline).toContain("1.");
    expect(outline).toContain("2.");
    expect(outline).toContain("3.");
    expect(outline).toContain("4.");
    expect(outline).not.toContain("5.");
  });

  it("counts repeated items, which is what a grid actually is", () => {
    expect(outline).toMatch(/row of 4 repeated items/);
    expect(outline).toMatch(/row of 3 repeated items, each with an image/);
  });

  it("says whether the image leads or follows the text — the split direction", () => {
    const bands = outline.split("\n");
    expect(bands.find((l) => l.startsWith("1."))).toContain("after the text");
    expect(bands.find((l) => l.startsWith("4."))).toContain("before the text");
  });

  it("notes headings, paragraphs, and links", () => {
    expect(outline).toContain("h1 heading");
    expect(outline).toContain("1 link");
  });

  it("is empty for a page with nothing in it", () => {
    expect(outlineHtmlStructure("<main></main>")).toBe("");
  });

  it("falls back to top-level blocks when a page has no sections", () => {
    const flat = outlineHtmlStructure(
      `<body><div><h1>Title</h1><p>${"words ".repeat(20)}</p></div><div><h2>Next</h2><p>${"more ".repeat(20)}</p></div></body>`,
    );
    expect(flat).toContain("1.");
    expect(flat).toContain("2.");
  });
});
