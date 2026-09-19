import { parse, HTMLElement as ParsedElement } from "node-html-parser";

import type { Element } from "@/lib/copy/elements";
import { userContent, type LlmClient, type LlmContentPart, type LlmMessage } from "@/lib/llm/client";
import { modelForLayout } from "@/lib/llm/models";
import { serializeElements } from "@/lib/copy/markdown";

import type { SectionForLayout } from "./heuristic";
import { unplacedElements } from "./inject";
import { referenceNote } from "./references";
import { sanitizeWireframeHtml } from "./sanitize";
import { DESIGN_SYSTEM_SPEC } from "./spec";

/**
 * Section-scoped wireframe edits. A design conversation iterates — "make the
 * hero split", "put the image on the left" — so the agent needs to touch one
 * <section data-copy="…"> at a time and leave the rest of the page alone.
 */

export interface WireframeSection {
  slug: string;
  html: string;
}

/** The page's sections in document order, by their data-copy slug. */
export function listWireframeSections(html: string): WireframeSection[] {
  return sectionNodes(parse(html)).map((node) => ({
    slug: node.getAttribute("data-copy") ?? "",
    html: node.outerHTML,
  }));
}

/**
 * Replaces the slug's section with new HTML, or inserts it when the page
 * doesn't have it yet. `docOrder` (the doc's linked-section slugs, in order)
 * decides where an insert lands; without a placeable neighbor it goes before
 * the trailing footer.
 */
export function upsertWireframeSection(
  wireframeHtml: string,
  slug: string,
  sectionHtml: string,
  docOrder: string[],
): string {
  const root = parse(wireframeHtml);
  const sections = sectionNodes(root);

  const existing = sections.find((node) => node.getAttribute("data-copy") === slug);
  if (existing) {
    existing.replaceWith(sectionHtml);
    return root.outerHTML.trim();
  }

  const present = new Map(sections.map((node) => [node.getAttribute("data-copy") ?? "", node]));
  const index = docOrder.indexOf(slug);

  if (index !== -1) {
    // nearest doc-order neighbor already on the page wins: after a predecessor…
    for (let i = index - 1; i >= 0; i--) {
      const neighbor = present.get(docOrder[i]!);
      if (neighbor) {
        neighbor.insertAdjacentHTML("afterend", sectionHtml);
        return root.outerHTML.trim();
      }
    }
    // …or before a successor
    for (let i = index + 1; i < docOrder.length; i++) {
      const neighbor = present.get(docOrder[i]!);
      if (neighbor) {
        neighbor.insertAdjacentHTML("beforebegin", sectionHtml);
        return root.outerHTML.trim();
      }
    }
  }

  // no neighbors: before the trailing footer chrome, else at the end
  const footer = root.querySelectorAll("footer.wf-footer").at(-1);
  if (footer) footer.insertAdjacentHTML("beforebegin", sectionHtml);
  else root.insertAdjacentHTML("beforeend", sectionHtml);
  return root.outerHTML.trim();
}

export interface SectionLayoutResult {
  html: string;
  /** Copy elements the accepted layout still has no slot for (they render as overflow). */
  unplaced: Element[];
}

/**
 * Asks the LLM to (re)design a single section and returns the sanitized
 * <section> fragment. The current layout, when there is one, is the starting
 * point — the instruction says what changes about it. `pageOutline` is the
 * rest of the page in words, so "match the band above" and "don't repeat the
 * neighbour's pattern" are things the designer can actually do.
 *
 * A layout that fails the gate, or leaves copy without a slot, goes back to
 * the designer once with the exact shortfall. A second structural failure
 * throws; a second coverage gap is accepted and reported, because a slightly
 * imperfect layout the user can see beats an error they can't act on.
 */
export async function generateSectionLayout(
  llm: LlmClient,
  section: SectionForLayout,
  options: { instruction: string; currentHtml?: string; references?: LlmContentPart[]; pageOutline?: string },
): Promise<SectionLayoutResult> {
  const copy = serializeElements(section.elements) || "(no copy yet)";
  const current = options.currentHtml
    ? `\n\nIts current layout, the starting point — change what the instruction asks and keep the rest of its character:\n${options.currentHtml}`
    : "";
  const outline = options.pageOutline
    ? `\n\nThe whole page in order, for context (do NOT output the other sections — design only the one asked for, and make it sit well between its neighbours):\n${options.pageOutline}`
    : "";
  const slotList = section.elements.map((el) => el.type).join(", ") || "none";

  const messages: LlmMessage[] = [
    { role: "system", content: DESIGN_SYSTEM_SPEC },
    {
      role: "user",
      content: userContent(
        options.references,
        `Design ONE wireframe section — output only that single <section class="wf-section" data-copy="${section.slug}"> fragment, ` +
          `no navbar, no footer, no other sections.${referenceNote(options.references, "section")}\n\nInstruction: ${options.instruction}\n\n` +
          `### Section slug: ${section.slug} (${section.title})\n${copy}\n\nIt needs exactly these slots, one per copy element, in this order: ${slotList}.${current}${outline}`,
      ),
    },
  ];

  const attempt = async (): Promise<{ html: string; unplaced: Element[] } | { error: string }> => {
    const result = await llm.chat({ model: modelForLayout(options.references), maxTokens: 2000, messages });
    messages.push({ role: "assistant", content: result.content });
    try {
      const html = acceptSectionLayout(result.content, section.slug);
      return { html, unplaced: unplacedElements(html, section.elements) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const first = await attempt();
  const problem = "error" in first ? first.error : coverageProblem(first.unplaced);
  if (!("error" in first) && !problem) return first;

  messages.push({ role: "user", content: `That layout was rejected: ${problem} Return the corrected <section> fragment only.` });
  const second = await attempt();
  if ("error" in second) throw new Error(second.error);
  return second;
}

/** Why a layout goes back for another pass, or null when it needn't. */
export function coverageProblem(unplaced: Element[]): string | null {
  if (unplaced.length === 0) return null;
  const types = unplaced.map((el) => el.type).join(", ");
  return `${unplaced.length} copy element${unplaced.length === 1 ? " has" : "s have"} no slot (${types}). Every copy element needs its own data-element slot of the matching type, in order.`;
}

/**
 * The acceptance gate for a section layout, whoever authored it — the
 * internal designer LLM and externally-authored HTML (MCP's
 * write_section_layout) go through this same door: sanitize to the wf-*
 * allowlist, then require exactly one <section data-copy="slug"> fragment.
 */
export function acceptSectionLayout(rawHtml: string, slug: string): string {
  const html = sanitizeWireframeHtml(stripCodeFences(rawHtml));
  const nodes = sectionNodes(parse(html));
  const match = nodes.find((node) => node.getAttribute("data-copy") === slug);
  if (!match || nodes.length !== 1) {
    throw new Error(`A section layout must be exactly one <section data-copy="${slug}"> fragment.`);
  }
  return match.outerHTML;
}

function sectionNodes(root: ParsedElement): ParsedElement[] {
  return root.querySelectorAll("section[data-copy]");
}

export function stripCodeFences(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
}
