import { parse, HTMLElement as ParsedElement, NodeType } from "node-html-parser";

import { WIREFRAME_CLASSES } from "./spec";

/**
 * Allowlist sanitizer for wireframe HTML. Wireframes come from LLMs and
 * imported sites, so nothing reaches the DOM that isn't structural: no
 * scripts, no styles, no handlers, no external references — and no words.
 *
 * Words matter as much as scripts here. A wireframe is layout only; the
 * copy is injected into `data-element` slots at render time. Text that a
 * designer (or an import) bakes into the markup would sit beside the real
 * copy as a stale duplicate, so any text outside a slot is dropped. Classes
 * are held to the design-system vocabulary for the same reason: an invented
 * `wf-hero-headline` has no styles behind it and renders as unstyled text.
 */

const ALLOWED_TAGS = new Set([
  "section", "div", "header", "footer", "nav", "main", "aside", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "span", "ul", "ol", "li",
  "blockquote", "strong", "em", "code",
]);

const ALLOWED_ATTRS = new Set(["class", "data-copy", "data-element", "data-overflow", "aria-hidden"]);

export function sanitizeWireframeHtml(html: string): string {
  const root = parse(html, { comment: false });
  sanitizeChildren(root, false);
  return root.innerHTML.trim();
}

function sanitizeChildren(node: ParsedElement, insideSlot: boolean): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      // words live in copy slots only; keep whitespace so the markup stays readable
      if (!insideSlot && child.rawText.trim()) child.remove();
      continue;
    }
    if (!(child instanceof ParsedElement)) {
      child.remove();
      continue;
    }
    const tag = child.rawTagName?.toLowerCase();
    if (!tag || !ALLOWED_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    for (const name of Object.keys(child.attributes)) {
      if (!ALLOWED_ATTRS.has(name.toLowerCase())) {
        child.removeAttribute(name);
      }
    }
    // classes are design-system-only: the wf-* vocabulary the CSS actually styles
    const classes = (child.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((c) => WIREFRAME_CLASSES.has(c));
    if (classes.length) child.setAttribute("class", classes.join(" "));
    else child.removeAttribute("class");

    // links render as buttons/anchors but never navigate anywhere real
    if (tag === "a") child.setAttribute("href", "#");

    sanitizeChildren(child, insideSlot || child.hasAttribute("data-element"));
  }
}
