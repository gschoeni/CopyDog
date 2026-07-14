import type { Element, HeadingLevel } from "./elements";

/**
 * Section markdown ⇄ Element[] — the canonical serialization.
 *
 * The dialect is plain CommonMark plus three deterministic conventions,
 * so files stay readable in any markdown tool:
 *   - a paragraph that is exactly one link (`[Label](url)`) is a button
 *   - a paragraph preceded by an `<!--eyebrow-->` comment is an eyebrow
 *   - a `<br>` chunk is an empty paragraph (blank lines are content in a
 *     freeform editor, and markdown would otherwise collapse them)
 *
 * Round-trip safety: `parse(serialize(elements))` must equal `elements`.
 * Paragraph text that would be misread as structure (leading `#`, `- `,
 * or a bare link) is backslash-escaped on write and unescaped on read.
 */

const EYEBROW_MARKER = "<!--eyebrow-->";
const BLANK_MARKER = "<br>";
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^-\s+(.*)$/;
const NUMBERED_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const LINK_ONLY_RE = /^\[([^\]]*)\]\(([^)\s]*)\)$/;

export function parseElementsMarkdown(markdown: string): Element[] {
  const elements: Element[] = [];
  // paragraphs are separated by blank lines; normalize line endings first
  const chunks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.split("\n");

    if (chunk === BLANK_MARKER) {
      elements.push({ type: "p", text: "" });
      continue;
    }

    if (lines[0] === EYEBROW_MARKER) {
      const text = lines.slice(1).join(" ").trim();
      if (text) elements.push({ type: "eyebrow", text: unescapeText(text) });
      continue;
    }

    const heading = lines.length === 1 ? lines[0]!.match(HEADING_RE) : null;
    if (heading) {
      elements.push({ type: `h${heading[1]!.length}` as HeadingLevel, text: unescapeText(heading[2]!) });
      continue;
    }

    if (lines.every((line) => BULLET_RE.test(line))) {
      elements.push({ type: "bullets", items: lines.map((line) => unescapeText(line.match(BULLET_RE)![1]!)) });
      continue;
    }

    if (lines.every((line) => NUMBERED_RE.test(line))) {
      elements.push({ type: "numbered", items: lines.map((line) => unescapeText(line.match(NUMBERED_RE)![1]!)) });
      continue;
    }

    if (lines.every((line) => QUOTE_RE.test(line))) {
      const text = lines.map((line) => line.match(QUOTE_RE)![1]!).join(" ").trim();
      if (text) elements.push({ type: "quote", text: unescapeText(text) });
      continue;
    }

    const link = lines.length === 1 ? lines[0]!.match(LINK_ONLY_RE) : null;
    if (link) {
      elements.push({ type: "button", label: unescapeText(link[1]!), url: link[2]! });
      continue;
    }

    elements.push({ type: "p", text: unescapeText(lines.join(" ")) });
  }

  return elements;
}

export function serializeElements(elements: Element[]): string {
  const chunks = elements.map((element) => {
    switch (element.type) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return `${"#".repeat(Number(element.type[1]))} ${escapeText(element.text)}`;
      case "eyebrow":
        return `${EYEBROW_MARKER}\n${escapeText(element.text)}`;
      case "button":
        return `[${escapeText(element.label)}](${element.url || "#"})`;
      case "bullets":
        return element.items.map((item) => `- ${escapeText(item)}`).join("\n");
      case "numbered":
        return element.items.map((item, i) => `${i + 1}. ${escapeText(item)}`).join("\n");
      case "quote":
        return `> ${escapeText(element.text)}`;
      case "p":
        return element.text ? escapeParagraph(element.text) : BLANK_MARKER;
    }
  });
  return chunks.filter(Boolean).join("\n\n") + (chunks.length ? "\n" : "");
}

/** Escapes characters that would change a paragraph's *element* type on re-parse. */
function escapeParagraph(text: string): string {
  let escaped = escapeText(text);
  if (LINK_ONLY_RE.test(escaped)) escaped = `\\${escaped}`;
  return escaped;
}

function escapeText(text: string): string {
  // leading structure markers only — inline markdown (bold/italic) passes through
  return text.replace(/^(#{1,6}\s|-\s|\d+\.\s|>\s?|<!--|<br>)/, "\\$1");
}

function unescapeText(text: string): string {
  return text.replace(/^\\(\[|#{1,6}\s|-\s|\d+\.\s|>|<!--|<br>)/, "$1");
}
