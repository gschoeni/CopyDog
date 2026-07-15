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
  const cardHeadings = (counts.h3 ?? 0) >= 2 ? "h3" : (counts.h4 ?? 0) >= 2 ? "h4" : null;

  if (hasHero) return heroSection(section);
  if ((counts.quote ?? 0) > 0) return testimonialSection(section);
  if (cardHeadings) return cardGridSection(section, cardHeadings);
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

/** Compact centered call-to-action band on a tinted background. */
function ctaSection(section: SectionForLayout): string {
  return `<section class="wf-section wf-section-tint" data-copy="${section.slug}">
  <div class="wf-container wf-center">
    ${slotsFor(section.elements, { media: false })}
  </div>
</section>`;
}

/** Centered quote with an avatar byline placeholder. */
function testimonialSection(section: SectionForLayout): string {
  return `<section class="wf-section wf-section-tint" data-copy="${section.slug}">
  <div class="wf-container wf-center" data-overflow>
    ${slotsFor(section.elements, { media: false })}
    <div class="wf-avatar-row" aria-hidden="true"><span class="wf-avatar"></span><span class="wf-pill"></span></div>
  </div>
</section>`;
}

/**
 * Repeated h3/h4 + support copy becomes a grid of cards: everything before
 * the first card heading is the intro, each heading starts a card.
 */
function cardGridSection(section: SectionForLayout, heading: "h3" | "h4"): string {
  const firstCard = section.elements.findIndex((el) => el.type === heading);
  const intro = section.elements.slice(0, firstCard);
  const rest = section.elements.slice(firstCard);

  const cards: Element[][] = [];
  for (const element of rest) {
    if (element.type === heading || cards.length === 0) cards.push([]);
    cards[cards.length - 1]!.push(element);
  }
  const grid = cards.length === 2 ? "wf-grid-2" : cards.length >= 4 ? "wf-grid-4" : "wf-grid-3";

  const introHtml = intro.length
    ? `<div class="wf-center wf-stack" data-overflow>
      ${slotsFor(intro, { media: false })}
    </div>`
    : `<div data-overflow></div>`;

  return `<section class="wf-section" data-copy="${section.slug}">
  <div class="wf-container wf-stack">
    ${introHtml}
    <div class="${grid}">
      ${cards
        .map(
          (card) => `<div class="wf-card">
        ${slotsFor(card, { media: false })}
      </div>`,
        )
        .join("\n      ")}
    </div>
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
