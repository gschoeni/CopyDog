import { describe, expect, it } from "vitest";

import { acceptPageWireframe, generateWireframe, type WireframeGenerator } from "./generate";

const SECTIONS = [{ slug: "hero", title: "Hero", elements: [{ type: "h1" as const, text: "Hi" }] }];

const answering = (html: string): WireframeGenerator => ({ generate: async () => html });
const failing = (message: string): WireframeGenerator => ({
  generate: async () => {
    throw new Error(message);
  },
});

describe("generateWireframe", () => {
  it("reports the first generator's answer as no fallback", async () => {
    const result = await generateWireframe([answering("<section data-copy='hero'></section>")], SECTIONS);
    expect(result).toMatchObject({ fallback: false });
    expect(result.error).toBeUndefined();
  });

  it("says so when the designer failed and the rule-based generator answered", async () => {
    // The heuristic generator has never seen the reference material, so a
    // silent fallback is indistinguishable from "the designer ignored my
    // screenshot" — which is exactly how a rejected oversized image looked.
    const result = await generateWireframe(
      [failing("LLM request failed: 400"), answering("<section data-copy='hero'></section>")],
      SECTIONS,
    );
    expect(result.fallback).toBe(true);
    expect(result.error).toContain("400");
    expect(result.html).toContain("data-copy");
  });

  it("throws when nothing can answer", async () => {
    await expect(generateWireframe([failing("nope")], SECTIONS)).rejects.toThrow("nope");
  });
});

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
