import type { LlmContentPart } from "@/lib/llm/client";

/**
 * How the designer is told to treat reference material attached to a layout
 * request. The distinction matters: a reference is there for composition —
 * proportion, rhythm, where the weight sits — not for its words or its brand.
 * The copy is already decided by the time layout runs, and lifting someone
 * else's wording would be plagiarism dressed as design.
 */
export function referenceNote(references: LlmContentPart[] | undefined): string {
  if (!references?.length) return "";
  return (
    "\n\nReference material is attached above. Match its *composition* — section rhythm, where weight sits, " +
    "how content is grouped, the proportion of image to text. Do not copy its words, and express everything " +
    "in this design system's wf-* patterns; the wireframe stays greyscale."
  );
}
