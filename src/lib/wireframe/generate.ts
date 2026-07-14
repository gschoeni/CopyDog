import { LLM_MODELS, LlmClient } from "@/lib/llm/client";
import { serializeElements } from "@/lib/copy/markdown";

import { generateWireframeHeuristic, type SectionForLayout } from "./heuristic";
import { sanitizeWireframeHtml } from "./sanitize";

/**
 * Wireframe generation. With an LLM available it designs layout; without
 * one (or on any failure) the rule-based generator answers instead. Either
 * way the result is sanitized and every section keeps its data-copy slot.
 */

const DESIGN_SYSTEM_SPEC = `You generate greyscale wireframes in CopyDog's design system.

Output rules:
- Output ONLY an HTML fragment. No markdown fences, no <html>/<head>/<body>, no <style>, no <script>.
- Allowed tags: section div header footer nav main aside figure h1-h6 p a span ul ol li blockquote strong em code
- Allowed classes (nothing else): wf-section wf-container wf-center wf-split wf-grid-3 wf-stack wf-actions
  wf-eyebrow wf-h1 wf-h2 wf-h3 wf-h4 wf-h5 wf-h6 wf-p wf-list wf-quote wf-button wf-button-secondary
  wf-media wf-avatar wf-pill wf-navbar wf-logo wf-nav-items wf-footer
- Each copy section becomes: <section class="wf-section" data-copy="SECTION_SLUG"> … </section>
- Inside a section, each copy element gets an EMPTY slot element with data-element="TYPE" where TYPE is one of:
  h1 h2 h3 h4 h5 h6 p eyebrow button bullets numbered quote. Slots must appear in a sensible visual order.
  Use exactly one slot per copy element (count them). bullets slots are <ul class="wf-list" data-element="bullets"></ul>; numbered slots are <ol class="wf-list" data-element="numbered"></ol>.
  button slots are <a class="wf-button" data-element="button" href="#"></a> grouped inside <div class="wf-actions">.
- Add one element with data-overflow per section (usually the main text column) so extra copy has a home.
- Decorate freely with wf-media / wf-avatar / wf-pill placeholders (aria-hidden="true") to suggest imagery.
- Start with a wf-navbar header and end with a wf-footer, both aria-hidden="true" decoration.
- Vary layouts: hero centered, alternating wf-split sections, wf-grid-3 for feature triplets, a compact centered CTA.`;

export interface WireframeGenerator {
  generate(sections: SectionForLayout[]): Promise<string>;
}

export class HeuristicGenerator implements WireframeGenerator {
  async generate(sections: SectionForLayout[]): Promise<string> {
    return sanitizeWireframeHtml(generateWireframeHeuristic(sections));
  }
}

export class LlmGenerator implements WireframeGenerator {
  constructor(
    private readonly llm: LlmClient,
    /** optional layout direction, e.g. from the chat agent */
    private readonly instruction?: string,
  ) {}

  async generate(sections: SectionForLayout[]): Promise<string> {
    const copySummary = sections
      .map((s) => `### Section slug: ${s.slug} (${s.title})\n${serializeElements(s.elements) || "(no copy yet)"}`)
      .join("\n\n");

    const direction = this.instruction ? `\n\nLayout direction from the designer: ${this.instruction}` : "";
    const result = await this.llm.chat({
      model: LLM_MODELS.wireframe,
      maxTokens: 4000,
      messages: [
        { role: "system", content: DESIGN_SYSTEM_SPEC },
        {
          role: "user",
          content: `Design a wireframe for a page with this copy. Return the HTML fragment only.${direction}\n\n${copySummary}`,
        },
      ],
    });

    const html = sanitizeWireframeHtml(stripCodeFences(result.content));
    if (!coversAllSections(html, sections)) {
      throw new Error("LLM wireframe missed sections");
    }
    return html;
  }
}

/** Picks the best available generator; the heuristic is always safe. */
export function selectGenerator(llm: LlmClient | null): WireframeGenerator[] {
  return llm ? [new LlmGenerator(llm), new HeuristicGenerator()] : [new HeuristicGenerator()];
}

export async function generateWireframe(generators: WireframeGenerator[], sections: SectionForLayout[]): Promise<string> {
  // blank lines are editor layout, not copy — layouts see real elements only
  const layoutSections = sections.map((s) => ({
    ...s,
    elements: s.elements.filter((el) => !(el.type === "p" && !el.text)),
  }));
  let lastError: unknown;
  for (const generator of generators) {
    try {
      return await generator.generate(layoutSections);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("wireframe generation failed");
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
}

function coversAllSections(html: string, sections: SectionForLayout[]): boolean {
  return sections.every((s) => html.includes(`data-copy="${s.slug}"`));
}
