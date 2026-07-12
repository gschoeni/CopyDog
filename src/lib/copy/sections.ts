import type { Block } from "./blocks";

/**
 * Automatic sectioning — the "just start writing" rules.
 *
 * A document flows like one page; sections split themselves:
 * - an H1 or H2 that appears after body content starts a new section
 *   (H3–H6 are subheadings and never split)
 * - a heading directly under another heading is a subtitle, not a split
 * - an eyebrow attaches forward: it moves with the heading that follows it
 */

/** Splits a block stream into section-sized groups (never returns []). */
export function splitIntoSections(blocks: Block[]): Block[][] {
  const groups: Block[][] = [];
  let current: Block[] = [];
  let sawBody = false;

  for (const block of blocks) {
    const isSectionHeading = block.type === "h1" || block.type === "h2";

    if (isSectionHeading && sawBody && current.length > 0) {
      // an eyebrow right before the heading belongs to the new section
      const carried: Block[] = [];
      if (current[current.length - 1]?.type === "eyebrow") {
        carried.push(current.pop()!);
      }
      if (current.length > 0) groups.push(current);
      current = carried;
      sawBody = false;
    }

    current.push(block);
    if (block.type !== "h1" && block.type !== "h2" && block.type !== "eyebrow") {
      sawBody = true;
    }
  }

  groups.push(current);
  return groups;
}

/** A section's display title, derived from its first heading. */
export function deriveSectionTitle(blocks: Block[], fallback = "Untitled section"): string {
  for (const block of blocks) {
    if ("text" in block && block.type.startsWith("h") && block.text.trim()) {
      const plain = block.text.replace(/[*`\\]/g, "").trim();
      return plain.length <= 60 ? plain : `${plain.slice(0, 59)}…`;
    }
  }
  return fallback;
}

export const DEFAULT_SECTION_TITLE = "Untitled section";
