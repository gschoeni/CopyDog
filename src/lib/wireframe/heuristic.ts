import type { Element } from "@/lib/copy/elements";

/**
 * Rule-based wireframe generation — instant, deterministic, no LLM.
 * Picks a layout pattern per section from the shape of its copy. Used as
 * the fallback when no inference key is configured, and as the baseline
 * the LLM generator is judged against.
 */

export interface SectionForLayout {
  slug: string;
  title: string;
  elements: Element[];
}

export function generateWireframeHeuristic(sections: SectionForLayout[]): string {
  const body = sections.map((section, index) => renderSection(section, index)).join("\n");
  return `${NAVBAR}\n${body}\n${FOOTER}`;
}

const NAVBAR = `<header class="wf-navbar" aria-hidden="true">
  <div class="wf-logo"></div>
  <nav class="wf-nav-items"><span class="wf-pill"></span><span class="wf-pill"></span><span class="wf-pill"></span></nav>
  <span class="wf-button">&nbsp;&nbsp;&nbsp;</span>
</header>`;

const FOOTER = `<footer class="wf-footer" aria-hidden="true">
  <div class="wf-logo"></div>
  <nav class="wf-nav-items"><span class="wf-pill"></span><span class="wf-pill"></span></nav>
</footer>`;

function renderSection(section: SectionForLayout, index: number): string {
  const counts = countTypes(section.elements);
  const hasHero = (counts.h1 ?? 0) > 0 && index === 0;
  const hasBullets = (counts.bullets ?? 0) + (counts.numbered ?? 0) > 0;
  const isCta = (counts.button ?? 0) > 0 && section.elements.length <= 3;

  if (hasHero) return heroSection(section);
  if (hasBullets) return splitSection(section);
  if (isCta) return ctaSection(section);
  return contentSection(section);
}

/** Centered hero: eyebrow / headline / support / actions / media. */
function heroSection(section: SectionForLayout): string {
  return `<section class="wf-section" data-copy="${section.slug}">
  <div class="wf-container wf-center">
    ${slotsFor(section.elements, { media: true })}
  </div>
</section>`;
}

/** Split layout: copy on the left, media on the right. */
function splitSection(section: SectionForLayout): string {
  return `<section class="wf-section" data-copy="${section.slug}">
  <div class="wf-container wf-split">
    <div class="wf-stack" data-overflow>
      ${slotsFor(section.elements, { media: false })}
    </div>
    <div class="wf-media" aria-hidden="true"></div>
  </div>
</section>`;
}

/** Compact centered call-to-action band. */
function ctaSection(section: SectionForLayout): string {
  return `<section class="wf-section" data-copy="${section.slug}">
  <div class="wf-container wf-center">
    ${slotsFor(section.elements, { media: false })}
  </div>
</section>`;
}

function contentSection(section: SectionForLayout): string {
  return `<section class="wf-section" data-copy="${section.slug}">
  <div class="wf-container" data-overflow>
    ${slotsFor(section.elements, { media: false })}
  </div>
</section>`;
}

/** One slot per copy element, in copy order; buttons group into an actions row. */
function slotsFor(elements: Element[], options: { media: boolean }): string {
  const slots: string[] = [];
  let actionsOpen = false;

  const closeActions = () => {
    if (actionsOpen) {
      slots.push(`</div>`);
      actionsOpen = false;
    }
  };

  for (const element of elements) {
    if (element.type === "button") {
      if (!actionsOpen) {
        slots.push(`<div class="wf-actions">`);
        actionsOpen = true;
      }
      slots.push(`<a class="wf-button" data-element="button" href="#"></a>`);
      continue;
    }
    closeActions();
    switch (element.type) {
      case "eyebrow":
        slots.push(`<p class="wf-eyebrow" data-element="eyebrow"></p>`);
        break;
      case "bullets":
        slots.push(`<ul class="wf-list" data-element="bullets"></ul>`);
        break;
      case "numbered":
        slots.push(`<ol class="wf-list" data-element="numbered"></ol>`);
        break;
      case "quote":
        slots.push(`<blockquote class="wf-quote" data-element="quote"></blockquote>`);
        break;
      case "p":
        slots.push(`<p class="wf-p" data-element="p"></p>`);
        break;
      default:
        slots.push(`<${element.type} class="wf-${element.type}" data-element="${element.type}"></${element.type}>`);
    }
  }
  closeActions();

  if (options.media) slots.push(`<div class="wf-media" aria-hidden="true"></div>`);
  return slots.join("\n    ");
}

function countTypes(elements: Element[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const element of elements) counts[element.type] = (counts[element.type] ?? 0) + 1;
  return counts;
}
