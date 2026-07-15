import { describe, expect, it } from "vitest";

import type { LlmClient } from "@/lib/llm/client";

import { generateSectionLayout, listWireframeSections, upsertWireframeSection } from "./edit";

const PAGE = `<header class="wf-navbar" aria-hidden="true"><div class="wf-logo"></div></header>
<section class="wf-section" data-copy="hero"><div class="wf-container wf-center"><h1 class="wf-h1" data-element="h1"></h1></div></section>
<section class="wf-section" data-copy="features"><div class="wf-container" data-overflow><p class="wf-p" data-element="p"></p></div></section>
<section class="wf-section wf-section-tint" data-copy="cta"><div class="wf-container wf-center"><div class="wf-actions"><a class="wf-button" data-element="button" href="#"></a></div></div></section>
<footer class="wf-footer" aria-hidden="true"><div class="wf-logo"></div></footer>`;

describe("listWireframeSections", () => {
  it("returns sections in page order with their html", () => {
    const sections = listWireframeSections(PAGE);
    expect(sections.map((s) => s.slug)).toEqual(["hero", "features", "cta"]);
    expect(sections[0]!.html).toContain(`data-element="h1"`);
  });

  it("is empty for an empty page", () => {
    expect(listWireframeSections("")).toEqual([]);
  });
});

describe("upsertWireframeSection", () => {
  const docOrder = ["hero", "features", "praise", "cta"];

  it("replaces an existing section in place", () => {
    const next = upsertWireframeSection(
      PAGE,
      "features",
      `<section class="wf-section" data-copy="features"><div class="wf-grid-3"><div class="wf-card"><p class="wf-p" data-element="p"></p></div></div></section>`,
      docOrder,
    );
    expect(next.match(/data-copy="features"/g)).toHaveLength(1);
    expect(next).toContain("wf-grid-3");
    // neighbors untouched, order preserved
    expect(listWireframeSections(next).map((s) => s.slug)).toEqual(["hero", "features", "cta"]);
  });

  it("inserts a missing section at its doc-order position", () => {
    const next = upsertWireframeSection(
      PAGE,
      "praise",
      `<section class="wf-section" data-copy="praise"><blockquote class="wf-quote" data-element="quote"></blockquote></section>`,
      docOrder,
    );
    expect(listWireframeSections(next).map((s) => s.slug)).toEqual(["hero", "features", "praise", "cta"]);
  });

  it("inserts before the footer when the page has no known neighbors", () => {
    const bare = `<header class="wf-navbar" aria-hidden="true"></header><footer class="wf-footer" aria-hidden="true"></footer>`;
    const next = upsertWireframeSection(
      bare,
      "hero",
      `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1></section>`,
      ["hero"],
    );
    expect(next.indexOf("data-copy")).toBeLessThan(next.indexOf("wf-footer"));
  });

  it("appends when there is no footer either", () => {
    const next = upsertWireframeSection("", "hero", `<section class="wf-section" data-copy="hero"></section>`, ["hero"]);
    expect(next).toContain(`data-copy="hero"`);
  });
});

describe("generateSectionLayout", () => {
  const section = {
    slug: "hero",
    title: "Hero",
    elements: [{ type: "h1", text: "Big" } as const],
  };

  function fakeLlm(content: string): LlmClient {
    return { chat: async () => ({ content, toolCalls: [], model: "fake" }) } as unknown as LlmClient;
  }

  it("returns the sanitized section fragment", async () => {
    const html = await generateSectionLayout(
      fakeLlm(
        "```html\n<section class=\"wf-section\" data-copy=\"hero\" onclick=\"x()\"><h1 class=\"wf-h1 evil\" data-element=\"h1\"></h1></section>\n```",
      ),
      section,
      { instruction: "center it" },
    );
    expect(html).toContain(`data-copy="hero"`);
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("evil");
  });

  it("rejects output without the requested section", async () => {
    await expect(
      generateSectionLayout(fakeLlm(`<section class="wf-section" data-copy="other"></section>`), section, {
        instruction: "x",
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects output with extra sections", async () => {
    await expect(
      generateSectionLayout(
        fakeLlm(
          `<section class="wf-section" data-copy="hero"></section><section class="wf-section" data-copy="stray"></section>`,
        ),
        section,
        { instruction: "x" },
      ),
    ).rejects.toThrow(/exactly one/);
  });
});
