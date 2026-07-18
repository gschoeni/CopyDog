/**
 * Chat-flavored markdown → blocks, for rendering assistant replies.
 *
 * Deliberately more tolerant than the copy dialect in markdown.ts: models
 * write "tight" lists (no blank line between a paragraph and its list),
 * horizontal rules, and fenced code. Line-based: each line either starts a
 * block, continues one, or joins the open paragraph. Inline marks inside
 * blocks are handled separately by parseInline (bold/italic/code/links).
 */

export type ChatBlock =
  | { kind: "p"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(-{3,}|_{3,}|\*{3,})$/;
const FENCE_RE = /^```/;

export function parseChatMarkdown(markdown: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  const collect = (re: RegExp): string[] => {
    const items: string[] = [];
    while (i < lines.length) {
      const match = lines[i]!.trim().match(re);
      if (!match) break;
      items.push(match[1]!);
      i += 1;
    }
    return items;
  };

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (FENCE_RE.test(trimmed)) {
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i]!.trim())) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence (or end of input)
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (HR_RE.test(trimmed)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2]! });
      i += 1;
      continue;
    }

    if (BULLET_RE.test(trimmed)) {
      blocks.push({ kind: "bullets", items: collect(BULLET_RE) });
      continue;
    }

    if (NUMBERED_RE.test(trimmed)) {
      blocks.push({ kind: "numbered", items: collect(NUMBERED_RE) });
      continue;
    }

    if (QUOTE_RE.test(trimmed)) {
      blocks.push({ kind: "quote", text: collect(QUOTE_RE).join("\n") });
      continue;
    }

    // paragraph: consecutive plain lines, broken by a blank or any block start
    const paragraph: string[] = [];
    while (i < lines.length) {
      const line = lines[i]!.trim();
      if (!line || FENCE_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line) || QUOTE_RE.test(line)) {
        break;
      }
      paragraph.push(line);
      i += 1;
    }
    blocks.push({ kind: "p", text: paragraph.join("\n") });
  }

  return blocks;
}
