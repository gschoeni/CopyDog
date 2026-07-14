import { parse, HTMLElement as ParsedElement, NodeType } from "node-html-parser";

/**
 * Allowlist sanitizer for wireframe HTML. Wireframes come from LLMs and
 * imported sites, so nothing reaches the DOM that isn't structural: no
 * scripts, no styles, no handlers, no external references.
 */

const ALLOWED_TAGS = new Set([
  "section", "div", "header", "footer", "nav", "main", "aside", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "span", "ul", "ol", "li",
  "blockquote", "strong", "em", "code",
]);

const ALLOWED_ATTRS = new Set(["class", "data-copy", "data-element", "data-overflow", "aria-hidden"]);

export function sanitizeWireframeHtml(html: string): string {
  const root = parse(html, { comment: false });
  sanitizeChildren(root);
  return root.innerHTML.trim();
}

function sanitizeChildren(node: ParsedElement): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === NodeType.TEXT_NODE) continue;
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
    // classes are design-system-only: wf-* (keeps arbitrary CSS out)
    const classes = (child.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((c) => /^wf-[a-z0-9-]+$/.test(c));
    if (classes.length) child.setAttribute("class", classes.join(" "));
    else child.removeAttribute("class");

    // links render as buttons/anchors but never navigate anywhere real
    if (tag === "a") child.setAttribute("href", "#");

    sanitizeChildren(child);
  }
}
