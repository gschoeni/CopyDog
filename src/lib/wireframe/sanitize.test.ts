import { describe, expect, it } from "vitest";

import { sanitizeWireframeHtml } from "./sanitize";

describe("sanitizeWireframeHtml", () => {
  it("keeps allowed structure and wf- classes", () => {
    const html = sanitizeWireframeHtml(
      `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1></section>`,
    );
    expect(html).toContain(`data-copy="hero"`);
    expect(html).toContain(`class="wf-h1"`);
  });

  it("strips scripts, styles, and unknown tags", () => {
    const html = sanitizeWireframeHtml(
      `<section class="wf-section"><script>alert(1)</script><style>*{}</style><iframe></iframe><p class="wf-p"></p></section>`,
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("style");
    expect(html).not.toContain("iframe");
    expect(html).toContain(`<p class="wf-p"></p>`);
  });

  it("strips event handlers and non-allowlisted attributes", () => {
    const html = sanitizeWireframeHtml(`<div class="wf-stack" onclick="evil()" id="x" style="color:red"></div>`);
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("id=");
  });

  it("drops non-design-system classes", () => {
    const html = sanitizeWireframeHtml(`<div class="wf-split absolute inset-0 evil"></div>`);
    expect(html).toContain(`class="wf-split"`);
    expect(html).not.toContain("absolute");
  });

  it("forces links to be inert", () => {
    const html = sanitizeWireframeHtml(`<a class="wf-button" href="https://evil.example">Go</a>`);
    expect(html).toContain(`href="#"`);
  });
});

describe("sanitizeWireframeHtml — layout carries no words", () => {
  it("drops wf- classes that aren't in the design system", () => {
    const html = sanitizeWireframeHtml(`<div class="wf-split wf-hero-content wf-btn--ghost"></div>`);
    expect(html).toBe(`<div class="wf-split"></div>`);
  });

  it("removes text outside copy slots and keeps text inside them", () => {
    const html = sanitizeWireframeHtml(
      `<section class="wf-section" data-copy="hero">
  <div class="wf-container">
    Looking for Civics Unplugged? <a class="wf-button" href="#">Click here</a>
    <h1 class="wf-h1" data-element="h1">Today <strong>we</strong> build</h1>
    <span class="wf-eyebrow"><span>Editorial / Photo</span></span>
  </div>
</section>`,
    );
    expect(html).not.toContain("Civics");
    expect(html).not.toContain("Click here");
    expect(html).not.toContain("Editorial");
    expect(html).toContain(`data-element="h1">Today <strong>we</strong> build</h1>`);
    expect(html).toContain(`<a class="wf-button" href="#"></a>`);
  });
});
