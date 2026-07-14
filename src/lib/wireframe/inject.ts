import { parse, HTMLElement as ParsedElement } from "node-html-parser";

import type { Element, ElementType } from "@/lib/copy/elements";
import { renderElement, renderInline } from "@/lib/copy/html";

/**
 * Copy injection — substitutes a page's active copy into its wireframe.
 *
 * The wireframe carries `data-copy="{sectionSlug}"` on section containers
 * and `data-element="{type}"` on the elements copy flows into. Elements match
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
  elements: Element[];
}

const HEADING_TYPES: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LIST_TYPES: ReadonlySet<string> = new Set(["bullets", "numbered"]);

export function injectCopy(wireframeHtml: string, sections: SectionCopy[]): string {
  const root = parse(wireframeHtml);
  // blank lines are editor layout, not copy — they never reach the wireframe
  const bySlug = new Map(sections.map((s) => [s.slug, s.elements.filter((el) => !(el.type === "p" && !el.text))]));

  for (const container of root.querySelectorAll("[data-copy]")) {
    const slug = container.getAttribute("data-copy");
    const elements = slug ? bySlug.get(slug) : undefined;
    injectSection(container, elements ?? []);
  }

  return root.innerHTML.trim();
}

function injectSection(container: ParsedElement, elements: Element[]): void {
  const slots = container.querySelectorAll("[data-element]");
  const filled = new Set<ParsedElement>();
  const overflow: Element[] = [];

  for (const element of elements) {
    const slot = slots.find((s) => !filled.has(s) && slotAccepts(s.getAttribute("data-element") ?? "", element.type));
    if (!slot) {
      overflow.push(element);
      continue;
    }
    filled.add(slot);
    fillSlot(slot, element);
  }

  for (const slot of slots) {
    if (!filled.has(slot)) {
      slot.setAttribute("class", `${slot.getAttribute("class") ?? ""} wf-empty`.trim());
      slot.innerHTML = "";
    }
  }

  if (overflow.length > 0) {
    const target = container.querySelector("[data-overflow]") ?? container;
    target.innerHTML += overflow.map(renderElement).join("");
  }
}

function slotAccepts(slotType: string, elementType: ElementType): boolean {
  if (slotType === elementType) return true;
  // any heading fits any heading slot — the wireframe sets visual hierarchy
  if (HEADING_TYPES.has(slotType) && HEADING_TYPES.has(elementType)) return true;
  // either list shape fits a list slot
  return LIST_TYPES.has(slotType) && LIST_TYPES.has(elementType);
}

function fillSlot(slot: ParsedElement, element: Element): void {
  switch (element.type) {
    case "bullets":
    case "numbered":
      slot.innerHTML = element.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
      break;
    case "button":
      slot.innerHTML = renderInline(element.label);
      break;
    default:
      slot.innerHTML = renderInline(element.text);
  }
}
