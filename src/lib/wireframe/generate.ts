import { LlmClient, userContent, type LlmContentPart } from "@/lib/llm/client";
import { modelForLayout } from "@/lib/llm/models";
import { serializeElements } from "@/lib/copy/markdown";

import { listWireframeSections, stripCodeFences } from "./edit";
import { generateWireframeHeuristic, type SectionForLayout } from "./heuristic";
import { referenceNote } from "./references";
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
      /** reference material (screenshots, PDFs, page copy) to design against */
      references?: LlmContentPart[];
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
      model: modelForLayout(this.options.references),
      maxTokens: 8000,
      messages: [
        { role: "system", content: DESIGN_SYSTEM_SPEC },
        {
          role: "user",
          content: userContent(
            this.options.references,
            `Design a wireframe for a page with this copy. Return the HTML fragment only.` +
              `${referenceNote(this.options.references, "page")}${direction}\n\n${copySummary}${current}`,
          ),
        },
      ],
    });

    return acceptPageWireframe(result.content, sections.map((s) => s.slug));
  }
}

/**
 * The acceptance gate for a whole-page wireframe, whoever authored it —
 * the internal designer LLM and externally-authored HTML (MCP's
 * write_page_layout) both pass here: sanitize to the wf-* allowlist, then
 * require a data-copy slot for every linked section.
 */
export function acceptPageWireframe(rawHtml: string, requiredSlugs: string[]): string {
  const html = sanitizeWireframeHtml(stripCodeFences(rawHtml));
  // parse for real <section data-copy="…"> nodes — a substring check passes on
  // literal text or an attribute on a non-section tag, which the copy injector
  // (querySelectorAll on real section slots) would then silently drop
  const present = new Set(listWireframeSections(html).map((section) => section.slug));
  const missing = requiredSlugs.filter((slug) => !present.has(slug));
  if (missing.length) {
    throw new Error(`Wireframe is missing sections: ${missing.join(", ")} — every linked section needs a <section data-copy="…">.`);
  }
  return html;
}

/** Picks the best available generator; the heuristic is always safe. */
export function selectGenerator(llm: LlmClient | null): WireframeGenerator[] {
  return llm ? [new LlmGenerator(llm), new HeuristicGenerator()] : [new HeuristicGenerator()];
}

export interface WireframeResult {
  html: string;
  /**
   * The preferred generator failed and a later one answered. It matters
   * because the rule-based generator has never seen the reference material —
   * a page laid out this way is generic, and saying nothing about it reads as
   * "the designer ignored my screenshot".
   */
  fallback: boolean;
  /** Why the preferred generator failed, for the caller to pass on. */
  error?: string;
}

export async function generateWireframe(
  generators: WireframeGenerator[],
  sections: SectionForLayout[],
): Promise<WireframeResult> {
  // blank lines are editor layout, not copy — layouts see real elements only
  const layoutSections = sections.map((s) => ({
    ...s,
    elements: s.elements.filter((el) => !(el.type === "p" && !el.text)),
  }));
  let lastError: unknown;
  for (const [index, generator] of generators.entries()) {
    try {
      const html = await generator.generate(layoutSections);
      return index === 0
        ? { html, fallback: false }
        : { html, fallback: true, error: errorText(lastError) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("wireframe generation failed");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "unknown error");
}
