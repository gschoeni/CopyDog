import { parse, HTMLElement as ParsedElement } from "node-html-parser";

import type { Element } from "@/lib/copy/elements";

import { listWireframeSections } from "./edit";
import { unplacedElements } from "./inject";

/**
 * A wireframe, described in the design system's own words — "split, media
 * left", "3-column grid of 3 cards", "tinted CTA band". Raw HTML is what the
 * designer edits; the outline is what the agent *reads*, and what a section
 * designer sees of its neighbours. It is complete where the HTML gets
 * truncated, and cheap where the HTML is expensive.
 */

export interface OutlineSection {
  slug: string;
  title?: string;
  /** The section's copy, when known — reports slots it has no place for. */
  elements?: Element[];
}

/**
 * One line per section, numbered in page order. `highlight` marks the
 * section a designer is about to work on, so it can see where that band sits
 * among its neighbours.
 */
export function outlineWireframe(
  html: string,
  sections: OutlineSection[] = [],
  options: { highlight?: string } = {},
): string {
  const byslug = new Map(sections.map((s) => [s.slug, s]));
  return listWireframeSections(html)
    .map((section, index) => {
      const known = byslug.get(section.slug);
      const title = known?.title && known.title !== section.slug ? ` (${known.title})` : "";
      const unplaced = known?.elements ? unplacedElements(section.html, known.elements) : [];
      const gap = unplaced.length
        ? `; NO SLOT for ${unplaced.length} element${unplaced.length === 1 ? "" : "s"} (${unplaced.map((e) => e.type).join(", ")}) — they render as overflow`
        : "";
      const mark = options.highlight === section.slug ? "  ← the section being designed" : "";
      return `${index + 1}. ${section.slug}${title} — ${describeSectionLayout(section.html)}${gap}${mark}`;
    })
    .join("\n");
}

/** "split, media left; tinted; slots: eyebrow, h2, p, button" */
export function describeSectionLayout(sectionHtml: string): string {
  const root = parse(sectionHtml);
  const section = root.querySelector("[data-copy]") ?? root;
  const has = (selector: string) => section.querySelector(selector) !== null;
  const count = (selector: string) => section.querySelectorAll(selector).length;
  const parts: string[] = [];

  if (section.classNames?.includes("wf-navbar") || has(".wf-navbar")) parts.push("navigation bar");
  else if (section.classNames?.includes("wf-footer") || has(".wf-footer")) parts.push("footer");
  else if (has(".wf-split-reverse")) parts.push("split, media left");
  else if (has(".wf-split")) parts.push("split, media right");
  else if (has(".wf-stat")) parts.push(`stats row of ${count(".wf-stat")}`);
  else if (has(".wf-faq-item")) parts.push(`FAQ list, ${count(".wf-faq-item")} rows`);
  else if (has(".wf-card")) parts.push(`${gridColumns(section)}-column grid of ${count(".wf-card")} cards`);
  else if (has(".wf-logo-strip")) parts.push(`logo strip of ${count(".wf-logo-box")}`);
  else if (has(".wf-avatar-row") || has("[data-element='quote']")) parts.push("testimonial");
  else if (has(".wf-form, .wf-form-stack")) parts.push("email capture form");
  else if (has("[data-element='h1']") && has(".wf-center")) parts.push("centered hero");
  else if (has(".wf-center")) parts.push("centered band");
  else parts.push("single column");

  if (!has(".wf-split") && has(".wf-media") && !has(".wf-card .wf-media")) parts.push("media below");
  if (hasClass(section, "wf-section-tint")) parts.push("tinted");

  const slots = section.querySelectorAll("[data-element]").map((slot) => slot.getAttribute("data-element") ?? "?");
  parts.push(slots.length ? `slots: ${slots.join(", ")}` : "NO copy slots");
  return parts.join("; ");
}

function gridColumns(section: ParsedElement): number {
  for (const n of [4, 3, 2]) if (section.querySelector(`.wf-grid-${n}`)) return n;
  return 1;
}

function hasClass(node: ParsedElement, className: string): boolean {
  return (node.getAttribute("class") ?? "").split(/\s+/).includes(className);
}
