import { parse, HTMLElement as ParsedElement } from "node-html-parser";

import type { Block, BlockType } from "@/lib/copy/blocks";
import { renderBlock, renderInline } from "@/lib/copy/html";

/**
 * Copy injection — substitutes a page's active copy into its wireframe.
 *
 * The wireframe carries `data-copy="{sectionSlug}"` on section containers
 * and `data-block="{type}"` on the elements copy flows into. Blocks match
 * slots of their own kind in document order (any heading level matches a
 * heading slot); copy with no matching slot is appended to the section's
 * `[data-overflow]` container (or the section itself); slots left without
 * copy become greyed placeholder bars (`wf-empty`).
 *
 * Pure and isomorphic: the server renders it, and the editor re-runs it on
 * every keystroke for the live preview.
 */

export interface SectionCopy {
  slug: string;
  blocks: Block[];
}

const HEADING_TYPES: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function injectCopy(wireframeHtml: string, sections: SectionCopy[]): string {
  const root = parse(wireframeHtml);
  const bySlug = new Map(sections.map((s) => [s.slug, s.blocks]));

  for (const container of root.querySelectorAll("[data-copy]")) {
    const slug = container.getAttribute("data-copy");
    const blocks = slug ? bySlug.get(slug) : undefined;
    injectSection(container, blocks ?? []);
  }

  return root.innerHTML.trim();
}

function injectSection(container: ParsedElement, blocks: Block[]): void {
  const slots = container.querySelectorAll("[data-block]");
  const filled = new Set<ParsedElement>();
  const overflow: Block[] = [];

  for (const block of blocks) {
    const slot = slots.find((s) => !filled.has(s) && slotAccepts(s.getAttribute("data-block") ?? "", block.type));
    if (!slot) {
      overflow.push(block);
      continue;
    }
    filled.add(slot);
    fillSlot(slot, block);
  }

  for (const slot of slots) {
    if (!filled.has(slot)) {
      slot.setAttribute("class", `${slot.getAttribute("class") ?? ""} wf-empty`.trim());
      slot.innerHTML = "";
    }
  }

  if (overflow.length > 0) {
    const target = container.querySelector("[data-overflow]") ?? container;
    target.innerHTML += overflow.map(renderBlock).join("");
  }
}

function slotAccepts(slotType: string, blockType: BlockType): boolean {
  if (slotType === blockType) return true;
  // any heading fits any heading slot — the wireframe sets visual hierarchy
  return HEADING_TYPES.has(slotType) && HEADING_TYPES.has(blockType);
}

function fillSlot(slot: ParsedElement, block: Block): void {
  switch (block.type) {
    case "bullets":
      slot.innerHTML = block.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
      break;
    case "button":
      slot.innerHTML = renderInline(block.label);
      break;
    default:
      slot.innerHTML = renderInline(block.text);
  }
}
