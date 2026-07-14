import { z } from "zod";

/**
 * The block model for website copy — the shared language between the
 * editor, the markdown files in Oxen, and the wireframe slots.
 *
 * `text`, `label`, and list items hold *inline markdown* (bold/italic/code),
 * so a Block[] is structure, and strings stay portable markdown.
 */

export const headingLevels = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
export type HeadingLevel = (typeof headingLevels)[number];

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(headingLevels), text: z.string() }),
  z.object({ type: z.literal("p"), text: z.string() }),
  /** short overline above a heading ("NEW", "PRICING") */
  z.object({ type: z.literal("eyebrow"), text: z.string() }),
  /** call-to-action button/link */
  z.object({ type: z.literal("button"), label: z.string(), url: z.string() }),
  z.object({ type: z.literal("bullets"), items: z.array(z.string()) }),
  /** pull quote / testimonial line */
  z.object({ type: z.literal("quote"), text: z.string() }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  p: "Paragraph",
  eyebrow: "Eyebrow",
  button: "Button",
  bullets: "Bulleted list",
  quote: "Quote",
};
