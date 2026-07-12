import { describe, expect, it } from "vitest";

import { exportPageHtml } from "./export";

describe("exportPageHtml", () => {
  it("produces a standalone document with injected copy and inlined styles", () => {
    const html = exportPageHtml({
      title: "Acme — Home",
      wireframeHtml: `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-block="h1"></h1></section>`,
      sections: [{ slug: "hero", blocks: [{ type: "h1", text: "Ship it" }] }],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Acme — Home</title>");
    expect(html).toContain(">Ship it</h1>");
    expect(html).toContain(".wf-root .wf-h1"); // design system inlined
    expect(html).toContain(`<body class="wf-root">`);
  });

  it("escapes the title", () => {
    const html = exportPageHtml({ title: `<script>x</script>`, wireframeHtml: "", sections: [] });
    expect(html).toContain("&lt;script&gt;");
  });
});
