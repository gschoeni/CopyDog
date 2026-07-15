/**
 * The design-system contract given to the LLM whenever it designs wireframe
 * HTML — the single description of the wf-* vocabulary and the slot rules.
 * Shared by full-page generation and section-scoped edits.
 */
export const DESIGN_SYSTEM_SPEC = `You generate greyscale wireframes in CopyDog's design system.

Output rules:
- Output ONLY an HTML fragment. No markdown fences, no <html>/<head>/<body>, no <style>, no <script>.
- Allowed tags: section div header footer nav main aside figure h1-h6 p a span ul ol li blockquote strong em code
- Allowed classes (nothing else):
  layout: wf-section wf-section-tint wf-container wf-center wf-split wf-split-reverse wf-grid-2 wf-grid-3 wf-grid-4 wf-stack wf-actions wf-card
  type: wf-eyebrow wf-h1 wf-h2 wf-h3 wf-h4 wf-h5 wf-h6 wf-p wf-list wf-quote
  controls: wf-button wf-button-secondary wf-form wf-form-stack wf-input
  placeholders: wf-media wf-avatar wf-avatar-row wf-pill wf-logo-strip wf-logo-box wf-stat wf-faq-item
  chrome: wf-navbar wf-logo wf-nav-items wf-footer

Copy slots (the contract — copy is injected later, never write copy text yourself):
- Each copy section becomes: <section class="wf-section" data-copy="SECTION_SLUG"> … </section>
- Inside a section, each copy element gets an EMPTY slot element with data-element="TYPE" where TYPE is one of:
  h1 h2 h3 h4 h5 h6 p eyebrow button bullets numbered quote. Slots must appear in a sensible visual order.
  Use exactly one slot per copy element (count them). bullets slots are <ul class="wf-list" data-element="bullets"></ul>; numbered slots are <ol class="wf-list" data-element="numbered"></ol>.
  button slots are <a class="wf-button" data-element="button" href="#"></a> grouped inside <div class="wf-actions">.
- Add one element with data-overflow per section (usually the main text column) so extra copy has a home.
- Decoration (anything that is not a copy slot) carries aria-hidden="true": wf-media, wf-avatar, wf-pill,
  wf-input, wf-logo-box, and any wrapper that exists purely to suggest imagery or UI.

Layout patterns (mix these for variety — never the same pattern twice in a row):
- Hero: wf-container wf-center with eyebrow/h1/p slots, wf-actions, then a wide wf-media.
- Split feature: wf-container wf-split (or wf-split-reverse to put media on the left) — one column
  is a wf-stack of copy slots, the other a wf-media.
- Feature grid: wf-grid-2 / wf-grid-3 / wf-grid-4 of wf-card items; each card can hold a small
  wf-media, an h3/h4 slot, and a p slot. Great for repeated h3+p copy.
- Logo strip: a wf-p or wf-eyebrow slot centered, then <div class="wf-logo-strip" aria-hidden="true">
  with 4-6 <span class="wf-logo-box"></span>.
- Testimonial: wf-center with a quote slot, then <div class="wf-avatar-row" aria-hidden="true">
  with a wf-avatar and wf-pill(s) for the byline.
- Stats: wf-grid-3 or wf-grid-4 of <div class="wf-stat"> items pairing an h2/h3 slot (the number)
  with a p slot (the label).
- FAQ: a wf-stack of <div class="wf-faq-item"> rows pairing an h4/h5 slot with a p slot.
- Pricing: wf-grid-2 / wf-grid-3 of wf-card items with h3, p, bullets and a button slot each.
- Email capture / signup: <div class="wf-form"> (inline) or wf-form-stack with 1-2
  <span class="wf-input" aria-hidden="true"></span> and the button slot.
- CTA band: a compact wf-section-tint with wf-center, an h2 slot, p slot and wf-actions.
- Use wf-section-tint on some sections to create rhythm between white and grey bands.
- Start with a wf-navbar header and end with a wf-footer, both aria-hidden="true" decoration.`;
