"use client";

import type { SectionView } from "./page-editor";

/**
 * The section map: numbered titles down the left of the copy editor.
 * One glance shows the page's structured skeleton; one click jumps to a
 * section. Loose copy is intentionally not on the map (nor in the
 * wireframe); unlinked sections show a hollow number. In split mode the
 * map collapses to just the numbers.
 *
 * Structure: the outer div carries the top padding that aligns the list
 * with the copy column's first text line; the inner nav is the sticky
 * element so, once pinned, its content sits right under the app header.
 */
export function SectionToc({
  sections,
  compact,
  onNavigate,
}: {
  sections: SectionView[];
  compact: boolean;
  onNavigate: (slug: string) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <div className={`hidden shrink-0 pt-[4.5rem] md:block ${compact ? "w-11 pl-2" : "w-52 pl-5 pr-1"}`}>
      <nav aria-label="Sections" className="sticky top-[7.5rem] max-h-[calc(100dvh-8.5rem)] overflow-y-auto pb-8">
        {compact ? (
          <div className="mb-2 flex justify-center" title="On this page" aria-hidden>
            <TocIcon />
          </div>
        ) : (
          <header className="mb-2.5 flex items-baseline justify-between px-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">On this page</h2>
            <span className="text-[11px] tabular-nums text-ink-tertiary/70">{sections.length}</span>
          </header>
        )}
        <ol className="space-y-0.5">
          {sections.map((section, index) => (
            <li key={section.slug}>
              <button
                type="button"
                onClick={() => onNavigate(section.slug)}
                title={section.linked ? section.title : `${section.title} (unlinked)`}
                aria-label={`Go to section ${index + 1}: ${section.title}`}
                className={`group flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-surface-hover ${
                  compact ? "justify-center p-1" : "px-2 py-1"
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums transition-colors group-hover:text-accent ${
                    section.linked ? "text-ink-tertiary" : "text-ink-tertiary/60 ring-1 ring-inset ring-border"
                  }`}
                >
                  {index + 1}
                </span>
                {!compact && (
                  <span
                    className={`truncate text-xs transition-colors group-hover:text-ink ${
                      section.linked ? "text-ink-secondary" : "text-ink-tertiary"
                    }`}
                  >
                    {section.title}
                  </span>
                )}
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
