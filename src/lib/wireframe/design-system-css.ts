/**
 * The greyscale wireframe design system, as a string so both the app
 * (injected <style> in the root layout) and the HTML export share one
 * source of truth. Swappable: everything is scoped under .wf-root.
 */
export const WIREFRAME_CSS = `/* ------------------------------------------------------------------ */
/* CopyDog greyscale wireframe design system                           */
/*                                                                     */
/* The wireframe is deliberately styleless: grey boxes, black type,    */
/* one weight of chrome. It renders as light "paper" in both app       */
/* themes — a wireframe is an artifact, not a UI surface.              */
/* This module is swappable: everything is scoped under .wf-root and   */
/* uses only wf-* classes.                                             */
/* ------------------------------------------------------------------ */

.wf-root {
  --wf-bg: #ffffff;
  --wf-ink: #1a1a1a;
  --wf-ink-soft: #555555;
  --wf-line: #e2e2e2;
  --wf-fill: #f2f2f2;
  --wf-fill-strong: #d9d9d9;

  background: var(--wf-bg);
  color: var(--wf-ink);
  font-family: var(--font-sans);
  line-height: 1.6;
}

/* layout ------------------------------------------------------------ */

.wf-root .wf-section {
  padding: 4.5rem 2rem;
  border-bottom: 1px solid var(--wf-line);
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

.wf-root .wf-center .wf-actions {
  justify-content: center;
}

.wf-root .wf-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  align-items: center;
}

.wf-root .wf-split-reverse > :first-child {
  order: 2;
}

.wf-root .wf-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2rem;
}

.wf-root .wf-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
}

.wf-root .wf-grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

.wf-root .wf-stack > * + * {
  margin-top: 1rem;
}

.wf-root .wf-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.75rem;
}

/* type -------------------------------------------------------------- */

.wf-root .wf-eyebrow {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--wf-ink-soft);
  margin-bottom: 0.9rem;
}

.wf-root .wf-h1 { font-size: 3rem; line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.25rem; }
.wf-root .wf-h2 { font-size: 2.125rem; line-height: 1.15; font-weight: 700; letter-spacing: -0.015em; margin-bottom: 1rem; }
.wf-root .wf-h3 { font-size: 1.5rem; line-height: 1.25; font-weight: 650; margin-bottom: 0.75rem; }
.wf-root .wf-h4, .wf-root .wf-h5, .wf-root .wf-h6 { font-size: 1.125rem; font-weight: 650; margin-bottom: 0.5rem; }

.wf-root .wf-p {
  color: var(--wf-ink-soft);
  max-width: 40rem;
  margin-bottom: 0.5rem;
}

.wf-root .wf-center .wf-p {
  margin-inline: auto;
}

.wf-root .wf-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
  color: var(--wf-ink-soft);
}

.wf-root .wf-list li {
  position: relative;
  padding-left: 1.6em;
  margin-bottom: 0.6em;
}

.wf-root .wf-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.42em;
  width: 0.85em;
  height: 0.85em;
  border-radius: 999px;
  background: var(--wf-fill-strong);
}

.wf-root ol.wf-list {
  counter-reset: wf-item;
}

.wf-root ol.wf-list li {
  counter-increment: wf-item;
}

.wf-root ol.wf-list li::before {
  content: counter(wf-item) ".";
  top: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  background: none;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--wf-ink-soft);
}

.wf-root .wf-quote {
  border-left: 3px solid var(--wf-fill-strong);
  padding: 0.4rem 0 0.4rem 1.2rem;
  margin: 1.25rem 0;
  font-size: 1.125rem;
  font-style: italic;
  color: var(--wf-ink-soft);
  max-width: 40rem;
}

/* controls ---------------------------------------------------------- */

.wf-root .wf-button {
  display: inline-block;
  padding: 0.7em 1.6em;
  background: var(--wf-ink);
  color: #ffffff;
  border-radius: 0.4em;
  font-weight: 550;
  font-size: 0.9375rem;
  text-decoration: none;
}

.wf-root .wf-button-secondary {
  background: transparent;
  color: var(--wf-ink);
  border: 1px solid var(--wf-ink);
}

.wf-root .wf-form {
  display: flex;
  gap: 0.75rem;
  max-width: 28rem;
  margin-top: 1.75rem;
}

.wf-root .wf-form-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 28rem;
  margin-top: 1.75rem;
}

.wf-root .wf-center .wf-form,
.wf-root .wf-center .wf-form-stack {
  margin-inline: auto;
}

.wf-root .wf-input {
  display: block;
  flex: 1;
  min-height: 2.9em;
  border: 1px solid var(--wf-fill-strong);
  border-radius: 0.4em;
  background: var(--wf-bg);
}

/* cards ------------------------------------------------------------- */

.wf-root .wf-card {
  padding: 1.75rem;
  border: 1px solid var(--wf-line);
  border-radius: 0.6rem;
  background: var(--wf-bg);
}

.wf-root .wf-card .wf-media {
  margin-top: 0;
  margin-bottom: 1.25rem;
}

.wf-root .wf-card .wf-h3,
.wf-root .wf-card .wf-h4 {
  margin-bottom: 0.4rem;
}

/* placeholders ------------------------------------------------------ */

.wf-root .wf-media {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--wf-fill);
  border: 1px solid var(--wf-line);
  border-radius: 0.5rem;
  overflow: hidden;
  margin-top: 2rem;
}

.wf-root .wf-media::before,
.wf-root .wf-media::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent calc(50% - 0.5px), var(--wf-fill-strong), transparent calc(50% + 0.5px));
}

.wf-root .wf-media::after {
  transform: scaleY(-1);
}

.wf-root .wf-section-tint .wf-media,
.wf-root .wf-section-tint .wf-card {
  background: var(--wf-bg);
}

.wf-root .wf-avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: var(--wf-fill-strong);
}

.wf-root .wf-avatar-row {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-top: 1.5rem;
}

.wf-root .wf-center .wf-avatar-row {
  justify-content: center;
}

.wf-root .wf-pill {
  display: inline-block;
  width: 4.5rem;
  height: 0.7rem;
  border-radius: 999px;
  background: var(--wf-fill-strong);
}

.wf-root .wf-logo-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2.5rem;
  margin-top: 2rem;
  opacity: 0.75;
}

.wf-root .wf-logo-box {
  width: 6rem;
  height: 1.4rem;
  border-radius: 0.25rem;
  background: var(--wf-fill-strong);
}

.wf-root .wf-stat .wf-h2,
.wf-root .wf-stat .wf-h3 {
  font-size: 2.75rem;
  line-height: 1;
  margin-bottom: 0.35rem;
}

.wf-root .wf-faq-item {
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--wf-line);
}

.wf-root .wf-faq-item > :first-child {
  margin-bottom: 0.35rem;
}

.wf-root .wf-empty {
  display: block;
  min-height: 0.9em;
  border-radius: 0.3em;
  background: var(--wf-fill);
}

/* chrome ------------------------------------------------------------ */

.wf-root .wf-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 2rem;
  border-bottom: 1px solid var(--wf-line);
}

.wf-root .wf-logo {
  width: 6.5rem;
  height: 1.1rem;
  border-radius: 0.25rem;
  background: var(--wf-ink);
  opacity: 0.85;
}

.wf-root .wf-nav-items {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.wf-root .wf-footer {
  padding: 2.5rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
}

/* responsive -------------------------------------------------------- */

@media (max-width: 720px) {
  .wf-root .wf-split,
  .wf-root .wf-grid-2,
  .wf-root .wf-grid-3 {
    grid-template-columns: 1fr;
  }
  .wf-root .wf-grid-4 {
    grid-template-columns: repeat(2, 1fr);
  }
  .wf-root .wf-split-reverse > :first-child {
    order: 0;
  }
  .wf-root .wf-form {
    flex-direction: column;
  }
  .wf-root .wf-h1 { font-size: 2.25rem; }
  .wf-root .wf-section { padding: 3rem 1.25rem; }
}
`;
