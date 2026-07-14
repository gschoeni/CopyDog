import type { Element, HeadingLevel } from "./elements";

/**
 * Section markdown ⇄ Element[] — the canonical serialization.
 *
 * The dialect is plain CommonMark plus two deterministic conventions, so
 * files stay readable in any markdown tool:
 *   - a paragraph that is exactly one link (`[Label](url)`) is a button
 *   - a paragraph preceded by an `<!--eyebrow-->` comment is an eyebrow
 *
 * Round-trip safety: `parse(serialize(blocks))` must equal `blocks`.
 * Paragraph text that would be misread as structure (leading `#`, `- `,
 * or a bare link) is backslash-escaped on write and unescaped on read.
 */

const EYEBROW_MARKER = "<!--eyebrow-->";
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^-\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const LINK_ONLY_RE = /^\[([^\]]*)\]\(([^)\s]*)\)$/;

export function parseElementsMarkdown(markdown: string): Element[] {
  const blocks: Element[] = [];
  // paragraphs are separated by blank lines; normalize line endings first
  const chunks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.split("\n");

    if (lines[0] === EYEBROW_MARKER) {
      const text = lines.slice(1).join(" ").trim();
      if (text) blocks.push({ type: "eyebrow", text: unescapeText(text) });
      continue;
    }

    const heading = lines.length === 1 ? lines[0]!.match(HEADING_RE) : null;
    if (heading) {
      blocks.push({ type: `h${heading[1]!.length}` as HeadingLevel, text: unescapeText(heading[2]!) });
      continue;
    }

    if (lines.every((line) => BULLET_RE.test(line))) {
      blocks.push({ type: "bullets", items: lines.map((line) => unescapeText(line.match(BULLET_RE)![1]!)) });
      continue;
    }

    if (lines.every((line) => QUOTE_RE.test(line))) {
      const text = lines.map((line) => line.match(QUOTE_RE)![1]!).join(" ").trim();
      if (text) blocks.push({ type: "quote", text: unescapeText(text) });
      continue;
    }

    const link = lines.length === 1 ? lines[0]!.match(LINK_ONLY_RE) : null;
    if (link) {
      blocks.push({ type: "button", label: unescapeText(link[1]!), url: link[2]! });
      continue;
    }

    blocks.push({ type: "p", text: unescapeText(lines.join(" ")) });
  }

  return blocks;
}

export function serializeElements(blocks: Element[]): string {
  const chunks = blocks.map((block) => {
    switch (block.type) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `${"#".repeat(Number(block.type[1]))} ${escapeText(block.text)}`;
      case "eyebrow":
        return `${EYEBROW_MARKER}\n${escapeText(block.text)}`;
      case "button":
        return `[${escapeText(block.label)}](${block.url || "#"})`;
      case "bullets":
        return block.items.map((item) => `- ${escapeText(item)}`).join("\n");
      case "quote":
        return `> ${escapeText(block.text)}`;
      case "p":
        return escapeParagraph(block.text);
    }
  });
  return chunks.filter(Boolean).join("\n\n") + (chunks.length ? "\n" : "");
}

/** Escapes characters that would change a paragraph's *block* type on re-parse. */
function escapeParagraph(text: string): string {
  let escaped = escapeText(text);
  if (LINK_ONLY_RE.test(escaped)) escaped = `\\${escaped}`;
  return escaped;
}

function escapeText(text: string): string {
  // leading structure markers only — inline markdown (bold/italic) passes through
  return text.replace(/^(#{1,6}\s|-\s|>\s?|<!--)/, "\\$1");
}

function unescapeText(text: string): string {
  return text.replace(/^\\(\[|#{1,6}\s|-\s|>|<!--)/, "$1");
}
