import { describe, expect, it } from "vitest";

import { acceptPageWireframe } from "./generate";

describe("acceptPageWireframe", () => {
  it("accepts a page with a real <section data-copy> for every required slug", () => {
    const html = acceptPageWireframe(
      '<section class="wf-section" data-copy="hero"></section><section class="wf-section" data-copy="cta"></section>',
      ["hero", "cta"],
    );
    expect(html).toContain('data-copy="hero"');
    expect(html).toContain('data-copy="cta"');
  });

  it("rejects a slug that only appears as literal text, not a real section node", () => {
    // The copy injector fills real section[data-copy] slots; a substring match
    // on `data-copy="ghost"` inside body text would pass validation and then
    // silently drop that section's copy at render. Require a parsed node.
    const withLiteral =
      '<section class="wf-section" data-copy="hero"><p class="wf-body" data-element="body">data-copy="ghost"</p></section>';
    expect(() => acceptPageWireframe(withLiteral, ["hero", "ghost"])).toThrow(/ghost/);
  });
});
