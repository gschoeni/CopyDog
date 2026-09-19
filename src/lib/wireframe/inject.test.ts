import { describe, expect, it } from "vitest";

import type { Element } from "@/lib/copy/elements";
import { injectCopy, unplacedElements } from "./inject";

const WIREFRAME = `<section class="wf-section" data-copy="hero">
  <div class="wf-container wf-center" data-overflow>
    <p class="wf-eyebrow" data-element="eyebrow"></p>
    <h1 class="wf-h1" data-element="h1"></h1>
    <p class="wf-p" data-element="p"></p>
    <div class="wf-actions"><a class="wf-button" data-element="button" href="#"></a></div>
  </div>
</section>`;

const heroBlocks: Element[] = [
  { type: "eyebrow", text: "NEW" },
  { type: "h1", text: "Ship **faster**" },
  { type: "p", text: "Copy and wireframes together." },
  { type: "button", label: "Start free", url: "#" },
];

describe("injectCopy", () => {
  it("fills slots in order with rendered copy", () => {
    const html = injectCopy(WIREFRAME, [{ slug: "hero", elements: heroBlocks }]);
    expect(html).toContain(`<p class="wf-eyebrow" data-element="eyebrow">NEW</p>`);
    expect(html).toContain(`<h1 class="wf-h1" data-element="h1">Ship <strong>faster</strong></h1>`);
    expect(html).toContain(`>Start free</a>`);
  });

  it("escapes copy text — copy can never inject markup", () => {
    const html = injectCopy(WIREFRAME, [
      { slug: "hero", elements: [{ type: "h1", text: `<script>alert(1)</script>` }] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("greys out slots with no matching copy", () => {
    const html = injectCopy(WIREFRAME, [{ slug: "hero", elements: [{ type: "h1", text: "Just a headline" }] }]);
    expect(html).toContain(`class="wf-eyebrow wf-empty"`);
    expect(html).toContain(`class="wf-p wf-empty"`);
  });

  it("appends copy without a slot to the overflow container", () => {
    const extra: Element[] = [...heroBlocks, { type: "bullets", items: ["One", "Two"] }];
    const html = injectCopy(WIREFRAME, [{ slug: "hero", elements: extra }]);
    expect(html).toContain(`<ul class="wf-list"><li>One</li><li>Two</li></ul>`);
  });

  it("any heading level fits a heading slot", () => {
    const html = injectCopy(WIREFRAME, [{ slug: "hero", elements: [{ type: "h2", text: "Second level" }] }]);
    expect(html).toContain(`<h1 class="wf-h1" data-element="h1">Second level</h1>`);
  });

  it("fills bullet slots as list items", () => {
    const wf = `<section data-copy="s"><ul class="wf-list" data-element="bullets"></ul></section>`;
    const html = injectCopy(wf, [{ slug: "s", elements: [{ type: "bullets", items: ["A", "B"] }] }]);
    expect(html).toContain(`<li>A</li><li>B</li>`);
  });

  it("fills quote slots and renders inline links safely", () => {
    const wf = `<section data-copy="s"><blockquote class="wf-quote" data-element="quote"></blockquote><p class="wf-p" data-element="p"></p></section>`;
    const html = injectCopy(wf, [
      {
        slug: "s",
        elements: [
          { type: "quote", text: "Love it." },
          { type: "p", text: "See [docs](javascript:alert(1)) and [site](https://x.dev)." },
        ],
      },
    ]);
    expect(html).toContain(`data-element="quote">Love it.</blockquote>`);
    expect(html).toContain(`<a href="https://x.dev">site</a>`);
    expect(html).not.toContain("javascript:");
  });

  it("leaves unknown sections untouched", () => {
    const html = injectCopy(WIREFRAME, []);
    expect(html).toContain("wf-empty");
  });

  it("strips legacy navbar/footer chrome but keeps nav built from copy", () => {
    const legacy = `<header class="wf-navbar" aria-hidden="true"><div class="wf-logo"></div></header>
<section class="wf-section" data-copy="s"><h1 class="wf-h1" data-element="h1"></h1></section>
<footer class="wf-footer" aria-hidden="true"><div class="wf-logo"></div></footer>`;
    const html = injectCopy(legacy, [{ slug: "s", elements: [{ type: "h1", text: "Hi" }] }]);
    expect(html).not.toContain("wf-navbar");
    expect(html).not.toContain("wf-footer");
    expect(html).toContain(">Hi</h1>");

    const copyNav = `<header class="wf-navbar" data-copy="nav"><p class="wf-p" data-element="p"></p></header>`;
    expect(injectCopy(copyNav, [{ slug: "nav", elements: [{ type: "p", text: "Home" }] }])).toContain("wf-navbar");
  });
});

describe("injectCopy — the copy is the only source of words", () => {
  it("labels each section with its title for the pane", () => {
    const html = injectCopy(WIREFRAME, [{ slug: "hero", title: "Hero", elements: heroBlocks }]);
    expect(html).toContain(`data-copy="hero" data-title="Hero"`);
  });

  it("drops words a stored layout carries outside its slots", () => {
    const stale = `<section class="wf-section" data-copy="hero">
  <div class="wf-container">
    <p class="wf-eyebrow">Old imported eyebrow</p>
    <h1 class="wf-h1" data-element="h1">stale</h1>
    <span>Editorial / Photo</span>
  </div>
</section>`;
    const html = injectCopy(stale, [{ slug: "hero", elements: [{ type: "h1", text: "Fresh headline" }] }]);
    expect(html).not.toContain("Old imported eyebrow");
    expect(html).not.toContain("Editorial");
    expect(html).not.toContain("stale");
    expect(html).toContain(`data-element="h1">Fresh headline</h1>`);
  });

  it("re-lays out a section whose layout has no slots at all", () => {
    const slotless = `<section class="wf-section" data-copy="hero"><div><div></div><span>Baked-in words</span></div></section>
<section class="wf-section" data-copy="who"><div class="wf-container"></div></section>`;
    const html = injectCopy(slotless, [
      { slug: "hero", title: "Hero", elements: heroBlocks },
      { slug: "who", title: "Who we are", elements: [{ type: "h2", text: "People" }, { type: "p", text: "Together." }] },
    ]);
    expect(html).not.toContain("Baked-in words");
    // the first section becomes a real hero: eyebrow, h1, p and button slots, in order, with media
    expect(html).toContain(`<p class="wf-eyebrow" data-element="eyebrow">NEW</p>`);
    expect(html).toContain(`<h1 class="wf-h1" data-element="h1">Ship <strong>faster</strong></h1>`);
    expect(html).toContain(`data-element="button" href="#">Start free</a>`);
    expect(html).toContain(`class="wf-media"`);
    // and a plain section gets a content layout with slots of its own
    expect(html).toContain(`<h2 class="wf-h2" data-element="h2">People</h2>`);
    expect(html).toContain(`<p class="wf-p" data-element="p">Together.</p>`);
    expect(html).toContain(`data-copy="who" data-title="Who we are"`);
  });

  it("leaves a slotless section alone when it has no copy to place", () => {
    const html = injectCopy(`<section class="wf-section" data-copy="empty"><div class="wf-container"></div></section>`, [
      { slug: "empty", elements: [] },
    ]);
    expect(html).toContain(`<div class="wf-container"></div>`);
  });
});

describe("unplacedElements", () => {
  it("lists the copy a layout has no slot for, in copy order", () => {
    const extra: Element[] = [...heroBlocks, { type: "bullets", items: ["One"] }, { type: "p", text: "Second paragraph" }];
    expect(unplacedElements(WIREFRAME, extra).map((el) => el.type)).toEqual(["bullets", "p"]);
    expect(unplacedElements(WIREFRAME, heroBlocks)).toEqual([]);
  });

  it("treats a bare fragment without a section wrapper as the section", () => {
    expect(unplacedElements(`<h1 class="wf-h1" data-element="h1"></h1>`, [{ type: "h2", text: "x" }])).toEqual([]);
  });
});
