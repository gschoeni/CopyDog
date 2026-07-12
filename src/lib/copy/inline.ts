/**
 * Inline markdown ⇄ formatted text runs.
 *
 * Block text is stored as inline markdown (`**bold**`, `*italic*`,
 * `` `code` ``); the editor works in runs. Supported marks are exactly
 * bold, italic, and code — everything else passes through as plain text.
 */

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export function parseInline(markdown: string): TextRun[] {
  const runs: TextRun[] = [];
  let i = 0;
  let plain = "";

  const flush = () => {
    if (plain) {
      runs.push({ text: plain });
      plain = "";
    }
  };

  while (i < markdown.length) {
    const rest = markdown.slice(i);

    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      flush();
      runs.push({ text: code[1]!, code: true });
      i += code[0].length;
      continue;
    }

    // emphasis content may contain backslash-escaped markers (e.g. **a\*b**)
    const boldItalic = rest.match(/^\*\*\*((?:\\.|[^*\\])+)\*\*\*/);
    if (boldItalic) {
      flush();
      runs.push({ text: unescapeInline(boldItalic[1]!), bold: true, italic: true });
      i += boldItalic[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*((?:\\.|[^*\\])+)\*\*/);
    if (bold) {
      flush();
      runs.push({ text: unescapeInline(bold[1]!), bold: true });
      i += bold[0].length;
      continue;
    }

    const italic = rest.match(/^\*((?:\\.|[^*\\])+)\*/);
    if (italic) {
      flush();
      runs.push({ text: unescapeInline(italic[1]!), italic: true });
      i += italic[0].length;
      continue;
    }

    if (rest.startsWith("\\") && rest.length > 1) {
      plain += rest[1];
      i += 2;
      continue;
    }

    plain += markdown[i];
    i += 1;
  }

  flush();
  return runs;
}

export function serializeInline(runs: TextRun[]): string {
  return runs
    .map((run) => {
      let text = run.code ? run.text : escapePlain(run.text);
      if (run.code) return `\`${text}\``;
      if (run.bold && run.italic) text = `***${text}***`;
      else if (run.bold) text = `**${text}**`;
      else if (run.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

function escapePlain(text: string): string {
  return text.replace(/([*`\\])/g, "\\$1");
}

function unescapeInline(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}
