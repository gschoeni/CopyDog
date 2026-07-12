import { describe, expect, it } from "vitest";

import { sanitizeWireframeHtml } from "./sanitize";

describe("sanitizeWireframeHtml", () => {
  it("keeps allowed structure and wf- classes", () => {
    const html = sanitizeWireframeHtml(
      `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-block="h1"></h1></section>`,
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
