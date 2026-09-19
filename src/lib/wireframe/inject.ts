import { parse, HTMLElement as ParsedElement, NodeType } from "node-html-parser";

import type { Element, ElementType } from "@/lib/copy/elements";
import { renderElement, renderInline } from "@/lib/copy/html";

import { layoutSection } from "./heuristic";

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
 * The copy is the only source of words. Text a layout carries outside a slot
 * (an imported page's own headline, a designer's stray caption) is dropped
 * here as well as at the sanitizer, so pages stored before that rule existed
 * render clean without a regenerate. A section whose layout has no slots at
 * all can't hold its copy in any deliberate place, so it is re-laid out with
 * the rule-based generator instead of dumping every element at its end.
 *
 * Pure and isomorphic: the server renders it, and the editor re-runs it on
 * every keystroke for the live preview.
 */

export interface SectionCopy {
  slug: string;
  elements: Element[];
  /** Shown as the section's label in the app's wireframe pane. */
  title?: string;
}

const HEADING_TYPES: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LIST_TYPES: ReadonlySet<string> = new Set(["bullets", "numbered"]);

export function injectCopy(wireframeHtml: string, sections: SectionCopy[]): string {
  const root = parse(wireframeHtml);

  // legacy chrome: wireframes generated before 2026-07-18 carried an
  // invented navbar/footer. Anything without a data-copy section behind
  // it is not the user's content — strip it at render time so old pages
  // clean up without a regenerate. (A nav BUILT from copy has data-copy
  // and is untouched.)
  for (const chrome of root.querySelectorAll("header.wf-navbar, footer.wf-footer")) {
    if (!chrome.getAttribute("data-copy") && !chrome.querySelector("[data-copy]")) chrome.remove();
  }

  // blank lines are editor layout, not copy — they never reach the wireframe
  const bySlug = new Map(
    sections.map((s) => [s.slug, { ...s, elements: s.elements.filter((el) => !(el.type === "p" && !el.text)) }]),
  );

  root.querySelectorAll("[data-copy]").forEach((container, index) => {
    const slug = container.getAttribute("data-copy");
    const section = slug ? bySlug.get(slug) : undefined;
    const elements = section?.elements ?? [];

    let target = container;
    if (section && elements.length > 0 && container.querySelectorAll("[data-element]").length === 0) {
      // no slots anywhere: the layout can't place this copy, so lay it out
      const fresh = parse(layoutSection({ slug: section.slug, title: section.title ?? section.slug, elements }, index))
        .querySelector("[data-copy]");
      if (fresh) {
        container.replaceWith(fresh);
        target = fresh;
      }
    }

    if (section?.title) target.setAttribute("data-title", section.title);
    stripStrayText(target);
    injectSection(target, elements);
  });

  return root.innerHTML.trim();
}

/** Removes words that live outside copy slots — layout never carries its own text. */
function stripStrayText(node: ParsedElement): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      if (child.rawText.trim()) child.remove();
    } else if (child instanceof ParsedElement && !child.hasAttribute("data-element")) {
      stripStrayText(child);
    }
  }
}

/**
 * The copy elements a section layout has no slot for — what would render as
 * overflow. The designer gates use this to send a layout back for another
 * pass, with the exact shortfall, instead of shipping a layout that dumps
 * half the copy at the bottom of the band.
 */
export function unplacedElements(sectionHtml: string, elements: Element[]): Element[] {
  const root = parse(sectionHtml);
  const container = root.querySelector("[data-copy]") ?? root;
  return planSlots(container.querySelectorAll("[data-element]"), elements).overflow;
}

/** Elements match slots of their own kind in document order; the rest overflow. */
function planSlots(
  slots: ParsedElement[],
  elements: Element[],
): { assignments: Map<ParsedElement, Element>; overflow: Element[] } {
  const assignments = new Map<ParsedElement, Element>();
  const overflow: Element[] = [];
  for (const element of elements) {
    const slot = slots.find(
      (s) => !assignments.has(s) && slotAccepts(s.getAttribute("data-element") ?? "", element.type),
    );
    if (slot) assignments.set(slot, element);
    else overflow.push(element);
  }
  return { assignments, overflow };
}

function injectSection(container: ParsedElement, elements: Element[]): void {
  const slots = container.querySelectorAll("[data-element]");
  const { assignments, overflow } = planSlots(slots, elements);

  for (const slot of slots) {
    const element = assignments.get(slot);
    if (element) {
      fillSlot(slot, element);
    } else {
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
