import { parse, HTMLElement as ParsedElement, NodeType, type Node as ParsedNode } from "node-html-parser";

import type { Block } from "@/lib/copy/blocks";

/**
 * Deterministic HTML → copy extraction. No LLM required: works from the
 * page's semantic structure. The LLM path (llm-extract) produces nicer
 * sectioning when a key is configured; this is the always-available floor
 * and the fallback.
 */

export interface ExtractedSection {
  title: string;
  blocks: Block[];
}

const MAX_SECTIONS = 12;
const MAX_BLOCKS_PER_SECTION = 40;
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
    const blocks = extractBlocks(container).slice(0, MAX_BLOCKS_PER_SECTION);
    if (blocks.length === 0) continue;
    const heading = blocks.find((b) => "text" in b && b.type.startsWith("h"));
    const title = heading && "text" in heading ? clip(heading.text, 40) : `Section ${sections.length + 1}`;
    sections.push({ title, blocks });
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
    if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "ul" || tag === "ol" || (tag === "a" && looksLikeCta(child))) {
      out.push(child);
    } else {
      flattenCopyElements(child, out);
    }
  }
  return out;
}

function extractBlocks(container: ParsedElement): Block[] {
  const blocks: Block[] = [];
  for (const el of flattenCopyElements(container)) {
    const tag = el.rawTagName!.toLowerCase();
    const text = inlineMarkdownOf(el);
    if (!text.trim() && tag !== "ul" && tag !== "ol") continue;

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: tag as Block["type"] & `h${number}`, text: text.trim() } as Block);
    } else if (tag === "ul" || tag === "ol") {
      const items = el
        .querySelectorAll("li")
        .map((li) => inlineMarkdownOf(li).trim())
        .filter(Boolean);
      if (items.length) blocks.push({ type: "bullets", items });
    } else if (tag === "a") {
      blocks.push({ type: "button", label: text.trim(), url: el.getAttribute("href") ?? "#" });
    } else if (isEyebrowLike(el, text)) {
      blocks.push({ type: "eyebrow", text: text.trim() });
    } else {
      blocks.push({ type: "p", text: text.trim() });
    }
  }
  return blocks;
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

/** Element text with <strong>/<em>/<code> re-encoded as inline markdown. */
function inlineMarkdownOf(node: ParsedNode): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return escapeInline(node.rawText.replace(/\s+/g, " "));
  }
  if (!(node instanceof ParsedElement)) return "";
  const tag = node.rawTagName?.toLowerCase() ?? "";
  if (SKIP_TAGS.has(tag)) return "";
  const inner = node.childNodes.map(inlineMarkdownOf).join("");
  if (!inner.trim()) return inner;
  if (tag === "strong" || tag === "b") return `**${inner.trim()}**`;
  if (tag === "em" || tag === "i") return `*${inner.trim()}*`;
  if (tag === "code") return `\`${inner.trim()}\``;
  if (tag === "br") return " ";
  return inner;
}

function escapeInline(text: string): string {
  return text.replace(/([*`\\])/g, "\\$1");
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
