"use client";

import type { SectionView } from "./page-editor";

/**
 * The section map: numbered titles down the left of the copy editor.
 * One glance shows the page's structured skeleton; one click jumps to a
 * section. Loose copy is intentionally not on the map (nor in the
 * wireframe); unlinked sections show a hollow number.
 *
 * Width adapts to the copy pane (a CSS container), not the viewport: on
 * roomy panes the full titled list shows; when space is tight — split
 * mode, assistant open, small windows — it collapses to just the numbers
 * so the editor keeps the width. The editor is the star.
 *
 * Structure: the outer div carries the top padding that aligns the list
 * with the copy column's first text line; the inner nav is the sticky
 * element so, once pinned, its content sits right under the app header.
 */
export function SectionToc({
  sections,
  onNavigate,
}: {
  sections: SectionView[];
  onNavigate: (slug: string) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <div className="hidden w-11 shrink-0 pl-2 pt-[4.5rem] md:block @5xl:w-52 @5xl:pl-5 @5xl:pr-1">
      <nav aria-label="Sections" className="sticky top-[7.5rem] max-h-[calc(100dvh-8.5rem)] overflow-y-auto pb-8">
        <div className="mb-2 flex justify-center @5xl:hidden" title="On this page" aria-hidden>
          <TocIcon />
        </div>
        <header className="mb-2.5 hidden items-baseline justify-between px-2 @5xl:flex">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">On this page</h2>
          <span className="text-[11px] tabular-nums text-ink-tertiary/70">{sections.length}</span>
        </header>
        <ol className="space-y-0.5">
          {sections.map((section, index) => (
            <li key={section.slug}>
              <button
                type="button"
                onClick={() => onNavigate(section.slug)}
                title={section.linked ? section.title : `${section.title} (unlinked)`}
                aria-label={`Go to section ${index + 1}: ${section.title}`}
                className="group flex w-full items-center justify-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-surface-hover @5xl:justify-start @5xl:px-2 @5xl:py-1"
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums transition-colors group-hover:text-accent ${
                    section.linked ? "text-ink-tertiary" : "text-ink-tertiary/60 ring-1 ring-inset ring-border"
                  }`}
                >
                  {index + 1}
                </span>
                <span
                  className={`hidden truncate text-xs transition-colors group-hover:text-ink @5xl:inline ${
                    section.linked ? "text-ink-secondary" : "text-ink-tertiary"
                  }`}
                >
                  {section.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

function TocIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 text-ink-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" strokeLinecap="round" />
      <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeLinecap="round" />
    </svg>
  );
}
