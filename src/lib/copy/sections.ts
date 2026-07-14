import type { Element } from "./elements";

/** A section's display title, derived from its first heading. */
export function deriveSectionTitle(elements: Element[], fallback = "Untitled section"): string {
  for (const element of elements) {
    if ("text" in element && element.type.startsWith("h") && element.text.trim()) {
      const plain = element.text.replace(/[*`\\]/g, "").trim();
      return plain.length <= 60 ? plain : `${plain.slice(0, 59)}…`;
    }
  }
  return fallback;
}

export const DEFAULT_SECTION_TITLE = "Untitled section";
