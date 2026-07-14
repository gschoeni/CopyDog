import type { Element } from "./elements";

export const DEFAULT_SECTION_TITLE = "Untitled section";

/** A section's display title, derived from its first heading. */
export function deriveSectionTitle(elements: Element[], fallback = DEFAULT_SECTION_TITLE): string {
  for (const element of elements) {
    if ("text" in element && element.type.startsWith("h") && element.text.trim()) {
      const plain = element.text.replace(/[*`\\]/g, "").trim();
      return plain.length <= 60 ? plain : `${plain.slice(0, 59)}…`;
    }
  }
  return fallback;
}
