/**
 * The greyscale wireframe design system, as a string so both the app
 * (injected <style> in the root layout) and the HTML export share one
 * source of truth. Swappable: everything is scoped under .wf-root.
 */
export const WIREFRAME_CSS = `/* ------------------------------------------------------------------ */
/* CopyDog greyscale wireframe design system                           */
/*                                                                     */
/* The wireframe is deliberately styleless: one ink, a few greys, one  */
/* weight of chrome. It renders as light "paper" in both app themes —  */
/* a wireframe is an artifact, not a UI surface.                       */
/*                                                                     */
/* .wf-root is a container, so every breakpoint and fluid size below   */
/* answers to the width the wireframe actually has — a 700px pane in   */
/* split view lays out like a 700px site, not a squeezed desktop one.  */
/* This module is swappable: everything is scoped under .wf-root and   */
/* uses only wf-* classes.                                             */
/* ------------------------------------------------------------------ */

.wf-root {
  --wf-bg: #ffffff;
  --wf-ink: #161616;
  --wf-ink-soft: #5b5b5b;
  --wf-ink-faint: #8f8f8f;
  --wf-line: #e8e8e8;
  --wf-line-strong: #d4d4d4;
  --wf-fill: #f4f4f4;
  --wf-fill-strong: #dedede;
  --wf-radius: 0.75rem;
  --wf-radius-sm: 0.5rem;
  --wf-measure: 38rem;
  --wf-gutter: clamp(1.5rem, 6cqi, 4rem);

  container: wf / inline-size;
  background: var(--wf-bg);
  color: var(--wf-ink);
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.wf-root *,
.wf-root *::before,
.wf-root *::after {
  box-sizing: border-box;
}

/* layout ------------------------------------------------------------ */

.wf-root .wf-section {
  padding: clamp(3.5rem, 8cqi, 6rem) var(--wf-gutter);
}

.wf-root .wf-section:not(.wf-section-tint) + .wf-section:not(.wf-section-tint) {
  border-top: 1px solid var(--wf-line);
}

.wf-root .wf-section-tint {
  background: var(--wf-fill);
}

.wf-root .wf-container {
  max-width: 64rem;
  margin: 0 auto;
}

.wf-root .wf-center {
  text-align: center;
}

.wf-root .wf-center .wf-actions,
.wf-root .wf-center .wf-avatar-row {
  justify-content: center;
}

.wf-root .wf-center .wf-p,
.wf-root .wf-center .wf-quote,
.wf-root .wf-center .wf-list,
.wf-root .wf-center .wf-form,
.wf-root .wf-center .wf-form-stack {
  margin-inline: auto;
}

.wf-root .wf-center .wf-list li {
  padding-left: 0;
}

.wf-root .wf-center .wf-list li::before {
  display: none;
}

.wf-root .wf-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: clamp(2rem, 6cqi, 5rem);
  align-items: center;
}

.wf-root .wf-split-reverse > :first-child {
  order: 2;
}

.wf-root .wf-grid-2,
.wf-root .wf-grid-3,
.wf-root .wf-grid-4 {
  display: grid;
  gap: 1.5rem;
}

.wf-root .wf-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.wf-root .wf-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.wf-root .wf-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.25rem; }

.wf-root .wf-stack > * + * {
  margin-top: 1rem;
}

.wf-root .wf-stack > .wf-grid-2,
.wf-root .wf-stack > .wf-grid-3,
.wf-root .wf-stack > .wf-grid-4,
.wf-root .wf-stack > .wf-split,
.wf-root .wf-stack > .wf-media {
  margin-top: 3rem;
}

.wf-root .wf-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-top: 2rem;
}

/* type -------------------------------------------------------------- */

.wf-root .wf-eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--wf-ink-faint);
  margin: 0 0 1rem;
}

.wf-root .wf-h1,
.wf-root .wf-h2,
.wf-root .wf-h3,
.wf-root .wf-h4,
.wf-root .wf-h5,
.wf-root .wf-h6 {
  margin: 0;
  color: var(--wf-ink);
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.wf-root .wf-h1 {
  font-size: clamp(2.25rem, 6.5cqi, 4rem);
  line-height: 1.02;
  font-weight: 700;
  letter-spacing: -0.032em;
  margin-bottom: 1.5rem;
  max-width: 20ch;
}

.wf-root .wf-h2 {
  font-size: clamp(1.75rem, 4.2cqi, 2.625rem);
  line-height: 1.1;
  font-weight: 650;
  letter-spacing: -0.024em;
  margin-bottom: 1.25rem;
  max-width: 26ch;
}

.wf-root .wf-h3 {
  font-size: 1.375rem;
  line-height: 1.25;
  font-weight: 600;
  letter-spacing: -0.014em;
  margin-bottom: 0.75rem;
}

.wf-root .wf-h4,
.wf-root .wf-h5,
.wf-root .wf-h6 {
  font-size: 1.0625rem;
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: -0.008em;
  margin-bottom: 0.5rem;
}

.wf-root .wf-center .wf-h1,
.wf-root .wf-center .wf-h2 {
  margin-inline: auto;
}

.wf-root .wf-p {
  font-size: 1.0625rem;
  line-height: 1.6;
  color: var(--wf-ink-soft);
  max-width: var(--wf-measure);
  margin: 0 0 1rem;
}

.wf-root .wf-p:last-child {
  margin-bottom: 0;
}

/* the line under a headline reads as a lead, not body */
.wf-root .wf-h1 + .wf-p {
  font-size: clamp(1.125rem, 1.9cqi, 1.3125rem);
  line-height: 1.5;
  max-width: 34rem;
}

.wf-root .wf-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
  color: var(--wf-ink-soft);
  max-width: var(--wf-measure);
}

.wf-root .wf-list li {
  position: relative;
  padding-left: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.55;
}

.wf-root .wf-list li::before {
  content: "";
  position: absolute;
  left: 0.15em;
  top: 0.62em;
  width: 0.4em;
  height: 0.4em;
  border-radius: 999px;
  background: var(--wf-ink-faint);
}

.wf-root ol.wf-list {
  counter-reset: wf-item;
}

.wf-root ol.wf-list li {
  counter-increment: wf-item;
  padding-left: 2em;
}

.wf-root ol.wf-list li::before {
  content: counter(wf-item, decimal-leading-zero);
  left: 0;
  top: 0.12em;
  width: auto;
  height: auto;
  border-radius: 0;
  background: none;
  font-size: 0.75em;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--wf-ink-faint);
}

.wf-root .wf-quote {
  position: relative;
  margin: 0 0 1.5rem;
  padding: 0;
  border: 0;
  font-size: clamp(1.25rem, 2.4cqi, 1.625rem);
  line-height: 1.4;
  font-weight: 500;
  letter-spacing: -0.014em;
  color: var(--wf-ink);
  max-width: 40rem;
  text-wrap: balance;
}

.wf-root .wf-quote::before {
  content: "\\201C";
  display: block;
  font-size: 2.25em;
  line-height: 0.6;
  height: 0.5em;
  margin-bottom: 0.35em;
  color: var(--wf-fill-strong);
}

/* controls ---------------------------------------------------------- */

.wf-root .wf-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.8em 1.5em;
  background: var(--wf-ink);
  color: var(--wf-bg);
  border-radius: 0.65em;
  font-weight: 550;
  font-size: 0.9375rem;
  line-height: 1.2;
  letter-spacing: -0.005em;
  text-decoration: none;
  white-space: nowrap;
}

.wf-root .wf-button-secondary {
  background: transparent;
  color: var(--wf-ink);
  box-shadow: inset 0 0 0 1px var(--wf-line-strong);
}

.wf-root .wf-form,
.wf-root .wf-form-stack {
  display: flex;
  gap: 0.625rem;
  max-width: 28rem;
  margin-top: 2rem;
}

.wf-root .wf-form-stack {
  flex-direction: column;
}

.wf-root .wf-input {
  position: relative;
  display: block;
  flex: 1;
  min-height: 2.9rem;
  border: 1px solid var(--wf-line-strong);
  border-radius: 0.65rem;
  background: var(--wf-bg);
}

.wf-root .wf-input::before {
  content: "";
  position: absolute;
  left: 1rem;
  top: 50%;
  width: 45%;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--wf-fill);
  transform: translateY(-50%);
}

/* cards ------------------------------------------------------------- */

.wf-root .wf-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 1.75rem;
  border: 1px solid var(--wf-line);
  border-radius: var(--wf-radius);
  background: var(--wf-bg);
}

.wf-root .wf-card > * + * {
  margin-top: 0.5rem;
}

.wf-root .wf-card .wf-media {
  margin: 0 0 1.25rem;
  aspect-ratio: 16 / 10;
}

.wf-root .wf-card .wf-h3,
.wf-root .wf-card .wf-h4 {
  margin-bottom: 0.25rem;
}

.wf-root .wf-card .wf-p {
  font-size: 0.9375rem;
  margin-bottom: 0;
}

.wf-root .wf-card .wf-actions {
  margin-top: auto;
  padding-top: 1.25rem;
}

.wf-root .wf-card .wf-list {
  font-size: 0.9375rem;
}

/* placeholders ------------------------------------------------------ */

.wf-root .wf-media {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--wf-fill);
  border-radius: var(--wf-radius);
  overflow: hidden;
  margin-top: 3rem;
}

.wf-root .wf-media-wide { aspect-ratio: 21 / 9; }
.wf-root .wf-media-square { aspect-ratio: 1; }
.wf-root .wf-media-portrait { aspect-ratio: 4 / 5; }

.wf-root .wf-media::before,
.wf-root .wf-media::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent calc(50% - 0.5px), var(--wf-line-strong), transparent calc(50% + 0.5px));
}

.wf-root .wf-media::after {
  transform: scaleY(-1);
}

.wf-root .wf-split > .wf-media {
  margin-top: 0;
}

.wf-root .wf-section-tint .wf-media,
.wf-root .wf-section-tint .wf-card,
.wf-root .wf-section-tint .wf-input {
  background: var(--wf-bg);
}

.wf-root .wf-section-tint .wf-card {
  border-color: transparent;
}

.wf-root .wf-avatar {
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  background: var(--wf-fill-strong);
}

.wf-root .wf-avatar-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-top: 1.5rem;
}

.wf-root .wf-pill {
  display: inline-block;
  width: 5.5rem;
  height: 0.5625rem;
  border-radius: 999px;
  background: var(--wf-fill-strong);
}

.wf-root .wf-pill + .wf-pill {
  width: 3.5rem;
  opacity: 0.6;
}

.wf-root .wf-logo-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 1.5rem 3rem;
  margin-top: 2rem;
}

.wf-root .wf-logo-box {
  width: 5.5rem;
  height: 1.375rem;
  border-radius: 0.3rem;
  background: var(--wf-fill-strong);
}

.wf-root .wf-stat {
  min-width: 0;
}

.wf-root .wf-stat .wf-h2,
.wf-root .wf-stat .wf-h3 {
  font-size: clamp(2.25rem, 5cqi, 3.25rem);
  line-height: 1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  margin-bottom: 0.5rem;
}

.wf-root .wf-stat .wf-p {
  font-size: 0.9375rem;
}

.wf-root .wf-faq-item {
  position: relative;
  padding: 1.375rem 3rem 1.375rem 0;
  border-bottom: 1px solid var(--wf-line);
}

.wf-root .wf-faq-item:first-child {
  border-top: 1px solid var(--wf-line);
}

.wf-root .wf-faq-item::after {
  content: "+";
  position: absolute;
  right: 0.25rem;
  top: 1.25rem;
  font-size: 1.375rem;
  line-height: 1;
  font-weight: 300;
  color: var(--wf-ink-faint);
}

.wf-root .wf-faq-item > * {
  margin-bottom: 0;
}

.wf-root .wf-faq-item > * + * {
  margin-top: 0.5rem;
}

.wf-root .wf-faq-item .wf-p {
  font-size: 0.9375rem;
}

/* an unfilled slot: a bar shaped like the copy that would go there */

.wf-root .wf-empty {
  display: block;
  width: 55%;
  min-height: 0.65em;
  border-radius: 0.3em;
  background: var(--wf-fill);
  margin-bottom: 1.25rem;
}

.wf-root .wf-center .wf-empty {
  margin-inline: auto;
}

.wf-root .wf-h1.wf-empty,
.wf-root .wf-h2.wf-empty {
  width: 70%;
  min-height: 0.9em;
}

.wf-root .wf-p.wf-empty,
.wf-root .wf-list.wf-empty,
.wf-root .wf-quote.wf-empty {
  width: 85%;
  min-height: 2.6em;
}

.wf-root .wf-eyebrow.wf-empty {
  width: 6rem;
  min-height: 0.75rem;
}

.wf-root .wf-button.wf-empty {
  display: inline-block;
  width: 8rem;
  min-height: 2.75rem;
  margin: 0;
  background: var(--wf-fill-strong);
}

.wf-root .wf-section-tint .wf-empty {
  background: var(--wf-fill-strong);
}

/* chrome ------------------------------------------------------------ */

.wf-root .wf-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.125rem var(--wf-gutter);
  border-bottom: 1px solid var(--wf-line);
}

.wf-root .wf-logo {
  flex: none;
  width: 6rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  background: var(--wf-ink);
}

.wf-root .wf-nav-items {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  font-size: 0.9375rem;
  color: var(--wf-ink-soft);
}

.wf-root .wf-nav-items .wf-p,
.wf-root .wf-nav-items .wf-list {
  margin: 0;
  font-size: inherit;
}

.wf-root .wf-nav-items .wf-list {
  display: flex;
  gap: 1.5rem;
}

.wf-root .wf-nav-items .wf-list li {
  padding: 0;
  margin: 0;
}

.wf-root .wf-nav-items .wf-list li::before {
  display: none;
}

.wf-root .wf-nav-items .wf-button {
  padding: 0.6em 1.1em;
  font-size: 0.875rem;
}

.wf-root .wf-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
  padding: 2.5rem var(--wf-gutter);
  border-top: 1px solid var(--wf-line);
  font-size: 0.875rem;
  color: var(--wf-ink-faint);
}

.wf-root .wf-footer .wf-p {
  font-size: inherit;
  color: inherit;
  margin: 0;
}

/* responsive — to the wireframe's own width ------------------------- */

@container wf (max-width: 56rem) {
  .wf-root .wf-grid-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container wf (max-width: 42rem) {
  .wf-root .wf-split,
  .wf-root .wf-grid-2,
  .wf-root .wf-grid-3 {
    grid-template-columns: minmax(0, 1fr);
  }
  .wf-root .wf-split {
    gap: 2rem;
  }
  .wf-root .wf-split-reverse > :first-child {
    order: 0;
  }
  .wf-root .wf-form {
    flex-direction: column;
  }
  .wf-root .wf-navbar,
  .wf-root .wf-footer {
    flex-wrap: wrap;
    gap: 1rem;
  }
  .wf-root .wf-card {
    padding: 1.5rem;
  }
}

@container wf (max-width: 30rem) {
  .wf-root .wf-grid-4 {
    grid-template-columns: minmax(0, 1fr);
  }
}
`;
