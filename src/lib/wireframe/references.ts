import type { LlmContentPart } from "@/lib/llm/client";

/**
 * How the designer is told to treat reference material attached to a layout
 * request — a screenshot, a page from a PDF, a site's own structure.
 *
 * Two things this has to get right:
 *
 * 1. **Fidelity beats variety.** The design-system spec tells the designer to
 *    mix patterns and never repeat one twice in a row. That is good advice
 *    when it's inventing a page and actively wrong when it's reproducing one —
 *    real pages stack three split bands in a row all the time. The note says
 *    so explicitly, because otherwise the two instructions conflict and the
 *    model splits the difference.
 *
 * 2. **Imagery is structure.** A band's proportions come from where its
 *    picture sits. Drop the picture and a split hero collapses into a centred
 *    one, and the layout stops matching. Every image in the reference has to
 *    come back as the placeholder that stands for it — which is what the
 *    wf-media / wf-avatar / wf-logo-box / wf-input vocabulary is for.
 *
 * Copy is the exception to all of it: layout is reproduced, words are not.
 */
export function referenceNote(
  references: LlmContentPart[] | undefined,
  scope: "page" | "section" = "page",
): string {
  if (!references?.length) return "";

  const target =
    scope === "page"
      ? `Work down the reference band by band, in order, and map each copy section below onto the band it corresponds to.`
      : `Find the band in the reference that corresponds to this section and reproduce that band. Ignore the rest of the reference.`;

  return `

REFERENCE MATCHING — the attached reference is the design you are reproducing.

Study it before you write any HTML. ${target} For each band, work out:
- how many columns it has, and how wide they are relative to each other
- which side the imagery sits on, and which side the text sits on
- whether the content is centred or left-aligned
- how many repeated items a grid or row holds (3 cards means wf-grid-3, not wf-grid-2)
- whether the band reads as a tinted/darker band or a plain one (wf-section-tint)
- the vertical order of everything inside it

Then reproduce that structure exactly, in this design system's wf-* patterns.

Every piece of imagery in the reference must come back as a placeholder, in the
same position and at roughly the same relative size — this is what makes the
layout match rather than merely resemble:
- a photo, illustration, screenshot, chart, video still, or map → <div class="wf-media" aria-hidden="true"></div>
- a person's headshot → <span class="wf-avatar" aria-hidden="true"></span>, in a wf-avatar-row with wf-pill for the byline
- a row of customer/partner logos → wf-logo-strip with one wf-logo-box per logo you can count
- an icon above or beside a card's heading → a small wf-media inside that wf-card
- a text field or search box → <span class="wf-input" aria-hidden="true"></span> inside wf-form or wf-form-stack
A band whose picture you leave out will not match: a split hero without its
wf-media collapses into a centred one. Count the images and account for each.

If the reference has a band that is pure imagery with no copy behind it, you
still cannot invent a section for it — every section must come from the copy
below. Attach it as a wide wf-media at the top or bottom of the neighbouring
section instead, so the page still reads with the same rhythm.

This overrides the "mix patterns, never the same one twice in a row" guidance
above. If the reference stacks three split sections in a row, so do you —
variety is for pages you are inventing, not pages you are reproducing.

Two things you do NOT take from the reference:
- its words. Copy is injected into the slots later; never transcribe the
  reference's text into the HTML.
- its colour, type, and branding. The wireframe stays greyscale and uses only
  the wf-* classes listed above.`;
}
