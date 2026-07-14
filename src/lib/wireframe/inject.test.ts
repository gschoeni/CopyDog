import { describe, expect, it } from "vitest";

import type { Element } from "@/lib/copy/elements";
import { injectCopy } from "./inject";

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
});
