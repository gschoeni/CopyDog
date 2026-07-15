import { LLM_MODELS, LlmClient } from "@/lib/llm/client";
import { serializeElements } from "@/lib/copy/markdown";

import { stripCodeFences } from "./edit";
import { generateWireframeHeuristic, type SectionForLayout } from "./heuristic";
import { sanitizeWireframeHtml } from "./sanitize";
import { DESIGN_SYSTEM_SPEC } from "./spec";

/**
 * Wireframe generation. With an LLM available it designs layout; without
 * one (or on any failure) the rule-based generator answers instead. Either
 * way the result is sanitized and every section keeps its data-copy slot.
 */

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
    private readonly options: {
      /** layout direction, e.g. from the chat agent */
      instruction?: string;
      /** the page's current wireframe — redesigns start from it instead of a blank slate */
      currentHtml?: string;
    } = {},
  ) {}

  async generate(sections: SectionForLayout[]): Promise<string> {
    const copySummary = sections
      .map((s) => `### Section slug: ${s.slug} (${s.title})\n${serializeElements(s.elements) || "(no copy yet)"}`)
      .join("\n\n");

    const direction = this.options.instruction
      ? `\n\nLayout direction from the designer: ${this.options.instruction}`
      : "";
    const current = this.options.currentHtml
      ? `\n\nThe page's current wireframe is below. Treat it as the starting point: keep sections the direction doesn't mention as they are, and redesign the ones it does.\n\n${this.options.currentHtml}`
      : "";
    const result = await this.llm.chat({
      model: LLM_MODELS.wireframe,
      maxTokens: 8000,
      messages: [
        { role: "system", content: DESIGN_SYSTEM_SPEC },
        {
          role: "user",
          content: `Design a wireframe for a page with this copy. Return the HTML fragment only.${direction}\n\n${copySummary}${current}`,
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

function coversAllSections(html: string, sections: SectionForLayout[]): boolean {
  return sections.every((s) => html.includes(`data-copy="${s.slug}"`));
}
