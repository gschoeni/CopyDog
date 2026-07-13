"use client";

import type { EditorSection } from "./page-editor";

/**
 * The section map: numbered titles down the left of the copy editor.
 * One glance shows the page's shape; one click jumps to a section.
 * In split mode it collapses to just the numbers.
 */
export function SectionToc({
  sections,
  compact,
  onNavigate,
}: {
  sections: EditorSection[];
  compact: boolean;
  onNavigate: (slug: string) => void;
}) {
  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Sections"
      className={`sticky top-16 hidden max-h-[calc(100dvh-5rem)] shrink-0 self-start overflow-y-auto pb-8 pt-10 md:block ${
        compact ? "w-11 pl-2" : "w-52 pl-5 pr-1"
      }`}
    >
      <ol className="space-y-0.5">
        {sections.map((section, index) => (
          <li key={section.slug}>
            <button
              type="button"
              onClick={() => onNavigate(section.slug)}
              title={section.title}
              aria-label={`Go to section ${index + 1}: ${section.title}`}
              className={`group flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-surface-hover ${
                compact ? "justify-center p-1" : "px-2 py-1"
              }`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums text-ink-tertiary transition-colors group-hover:text-accent">
                {index + 1}
              </span>
              {!compact && (
                <span className="truncate text-xs text-ink-secondary transition-colors group-hover:text-ink">
                  {section.title}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
