import type { Element } from "./elements";
import { parseInline } from "./inline";

/**
 * Copy → HTML, used for wireframe slot injection and export.
 * All text is escaped; inline markdown becomes <strong>/<em>/<code>.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Anchor destinations: web/mail/relative/fragment only — never scripts. */
export function safeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return trimmed;
  }
  return "#";
}

/** Inline markdown → HTML string (escaped). */
export function renderInline(inlineMarkdown: string): string {
  return parseInline(inlineMarkdown)
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.link !== undefined) html = `<a href="${escapeHtml(safeHref(run.link))}">${html}</a>`;
      return html;
    })
    .join("");
}

/** An element rendered as a standalone design-system element (overflow/export). */
export function renderElement(element: Element): string {
  switch (element.type) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `<${element.type} class="wf-${element.type}">${renderInline(element.text)}</${element.type}>`;
    case "eyebrow":
      return `<p class="wf-eyebrow">${renderInline(element.text)}</p>`;
    case "p":
      return `<p class="wf-p">${renderInline(element.text)}</p>`;
    case "button":
      return `<a class="wf-button" href="#">${renderInline(element.label)}</a>`;
    case "bullets":
      return `<ul class="wf-list">${element.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
    case "quote":
      return `<blockquote class="wf-quote">${renderInline(element.text)}</blockquote>`;
  }
}
