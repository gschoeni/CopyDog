import { describe, expect, it } from "vitest";

import type { LlmClient, LlmMessage } from "@/lib/llm/client";

import { acceptPageWireframe, generateWireframe, LlmGenerator, pageCoverage, type WireframeGenerator } from "./generate";

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

describe("LlmGenerator", () => {
  const sections = [
    { slug: "hero", title: "Hero", elements: [{ type: "h1" as const, text: "Hi" }, { type: "button" as const, label: "Go", url: "#" }] },
    { slug: "cta", title: "CTA", elements: [{ type: "h2" as const, text: "Ready" }] },
  ];
  const complete =
    `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1><div class="wf-actions"><a class="wf-button" data-element="button" href="#"></a></div></section>` +
    `<section class="wf-section wf-section-tint" data-copy="cta"><h2 class="wf-h2" data-element="h2"></h2></section>`;
  const missingButton =
    `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1></section>` +
    `<section class="wf-section" data-copy="cta"><h2 class="wf-h2" data-element="h2"></h2></section>`;

  function scriptedLlm(answers: string[]) {
    const calls: LlmMessage[][] = [];
    const llm = {
      calls,
      chat: async ({ messages }: { messages: LlmMessage[] }) => {
        calls.push([...messages]);
        return { content: answers[Math.min(calls.length - 1, answers.length - 1)]!, toolCalls: [], model: "fake" };
      },
    };
    return llm as unknown as LlmClient & { calls: LlmMessage[][] };
  }

  it("asks the designer to fix a page that leaves copy without a slot, naming the section", async () => {
    const llm = scriptedLlm([missingButton, complete]);
    const html = await new LlmGenerator(llm).generate(sections);
    expect(llm.calls).toHaveLength(2);
    const correction = llm.calls[1]!.at(-1)!.content as string;
    expect(correction).toContain(`section "hero"`);
    expect(correction).toContain("(button)");
    expect(html).toContain(`data-element="button"`);
  });

  it("tells every section how many slots it needs", async () => {
    const llm = scriptedLlm([complete]);
    await new LlmGenerator(llm).generate(sections);
    expect(JSON.stringify(llm.calls[0]![1]!.content)).toContain("Slots needed, in order: h1, button");
  });

  it("reports remaining gaps through generateWireframe", async () => {
    const result = await generateWireframe([new LlmGenerator(scriptedLlm([missingButton]))], sections);
    expect(result.unplaced).toEqual([{ slug: "hero", unplaced: [{ type: "button", label: "Go", url: "#" }] }]);
    expect(pageCoverage(complete, sections)).toEqual([]);
  });
});
