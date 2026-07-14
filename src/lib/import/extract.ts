import { parse, HTMLElement as ParsedElement, NodeType, type Node as ParsedNode } from "node-html-parser";

import type { Element } from "@/lib/copy/elements";

/**
 * Deterministic HTML → copy extraction. No LLM required: works from the
 * page's semantic structure. The LLM path (llm-extract) produces nicer
 * sectioning when a key is configured; this is the always-available floor
 * and the fallback.
 */

export interface ExtractedSection {
  title: string;
  elements: Element[];
}

const MAX_SECTIONS = 12;
const MAX_ELEMENTS_PER_SECTION = 40;
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "template", "form", "select", "option"]);
const CTA_CLASS_RE = /\b(btn|button|cta)\b/i;

export function extractSectionsFromHtml(html: string): ExtractedSection[] {
  const root = parse(html, { comment: false });
  stripSkipped(root);

  const scope = root.querySelector("main") ?? root.querySelector("body") ?? root;
  let containers = scope
    .querySelectorAll("section")
    .filter((el) => !isInside(el, "section") && hasCopy(el));

  if (containers.length < 2) {
    containers = splitByHeadings(scope);
  }

  const sections: ExtractedSection[] = [];
  for (const container of containers.slice(0, MAX_SECTIONS)) {
    const elements = extractElements(container).slice(0, MAX_ELEMENTS_PER_SECTION);
    if (elements.length === 0) continue;
    const heading = elements.find((b) => "text" in b && b.type.startsWith("h"));
    const title = heading && "text" in heading ? clip(heading.text, 40) : `Section ${sections.length + 1}`;
    sections.push({ title, elements });
  }
  return sections;
}

/** Groups the page's flow content into pseudo-sections at h1/h2 boundaries. */
function splitByHeadings(scope: ParsedElement): ParsedElement[] {
  const groups: ParsedElement[] = [];
  let current: ParsedElement | null = null;

  const flat = flattenCopyElements(scope);
  for (const el of flat) {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === "h1" || tag === "h2" || current === null) {
      current = new ParsedElement("div", {});
      groups.push(current);
    }
    current.appendChild(el.clone());
  }
  // heading-derived groups are copy by construction — just drop empties
  return groups.filter((g) => (g.textContent ?? "").trim().length > 0);
}

/** Document-order copy-bearing elements, without descending into them twice. */
function flattenCopyElements(node: ParsedElement, out: ParsedElement[] = []): ParsedElement[] {
  for (const child of node.childNodes) {
    if (!(child instanceof ParsedElement)) continue;
    const tag = child.rawTagName?.toLowerCase() ?? "";
    if (
      /^h[1-6]$/.test(tag) ||
      tag === "p" ||
      tag === "ul" ||
      tag === "ol" ||
      tag === "blockquote" ||
      (tag === "a" && looksLikeCta(child))
    ) {
      out.push(child);
    } else {
      flattenCopyElements(child, out);
    }
  }
  return out;
}

function extractElements(container: ParsedElement): Element[] {
  const elements: Element[] = [];
  for (const el of flattenCopyElements(container)) {
    const tag = el.rawTagName!.toLowerCase();
    const text = inlineMarkdownOf(el);
    if (!text.trim() && tag !== "ul" && tag !== "ol") continue;

    if (/^h[1-6]$/.test(tag)) {
      elements.push({ type: tag as Element["type"] & `h${number}`, text: text.trim() } as Element);
    } else if (tag === "ul" || tag === "ol") {
      const items = el
        .querySelectorAll("li")
        .map((li) => inlineMarkdownOf(li).trim())
        .filter(Boolean);
      if (items.length) elements.push({ type: "bullets", items });
    } else if (tag === "blockquote") {
      elements.push({ type: "quote", text: text.trim() });
    } else if (tag === "a") {
      elements.push({ type: "button", label: text.trim(), url: el.getAttribute("href") ?? "#" });
    } else if (isEyebrowLike(el, text)) {
      elements.push({ type: "eyebrow", text: text.trim() });
    } else {
      elements.push({ type: "p", text: text.trim() });
    }
  }
  return elements;
}

function looksLikeCta(el: ParsedElement): boolean {
  const text = el.textContent?.trim() ?? "";
  if (!text || text.split(/\s+/).length > 5) return false;
  const cls = el.getAttribute("class") ?? "";
  if (CTA_CLASS_RE.test(cls)) return true;
  // standalone short link not inside a paragraph reads as a CTA
  return !isInside(el, "p") && !isInside(el, "li");
}

function isEyebrowLike(el: ParsedElement, text: string): boolean {
  const cls = el.getAttribute("class") ?? "";
  if (/\b(eyebrow|overline|kicker|tagline)\b/i.test(cls)) return true;
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
}

/** Element text with <strong>/<em>/<code>/<a> re-encoded as inline markdown. */
function inlineMarkdownOf(node: ParsedNode, isRoot = true): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return escapeInline(node.rawText.replace(/\s+/g, " "));
  }
  if (!(node instanceof ParsedElement)) return "";
  const tag = node.rawTagName?.toLowerCase() ?? "";
  if (SKIP_TAGS.has(tag)) return "";
  const inner = node.childNodes.map((child) => inlineMarkdownOf(child, false)).join("");
  if (!inner.trim()) return inner;
  if (tag === "strong" || tag === "b") return `**${inner.trim()}**`;
  if (tag === "em" || tag === "i") return `*${inner.trim()}*`;
  if (tag === "code") return `\`${inner.trim()}\``;
  if (tag === "a" && !isRoot) {
    // nested anchors become inline links; a root anchor is the element itself
    // (a CTA button) and keeps its plain label
    const href = node.getAttribute("href") ?? "#";
    return `[${inner.trim().replace(/([\]\\])/g, "\\$1")}](${href})`;
  }
  if (tag === "br") return " ";
  return inner;
}

function escapeInline(text: string): string {
  // `[` included: imported prose that looks like [text](url) must not
  // round-trip into a live link
  return text.replace(/([*`[\\])/g, "\\$1");
}

function stripSkipped(root: ParsedElement): void {
  for (const tag of SKIP_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }
}

function isInside(el: ParsedElement, tag: string): boolean {
  let parent = el.parentNode;
  while (parent) {
    if (parent.rawTagName?.toLowerCase() === tag) return true;
    parent = parent.parentNode;
  }
  return false;
}

function hasCopy(el: ParsedElement): boolean {
  return (el.textContent ?? "").trim().length > 20;
}

function clip(text: string, max: number): string {
  const plain = text.replace(/[*`\\]/g, "");
  return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}
