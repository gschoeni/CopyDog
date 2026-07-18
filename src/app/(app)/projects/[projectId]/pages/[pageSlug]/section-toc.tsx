"use client";

import { useEffect, useState } from "react";

import { ChevronLeftIcon } from "@/components/ui/icons";

import type { SectionView } from "./page-editor";

/**
 * The section map: numbered titles down the left of the copy editor.
 * One glance shows the page's structured skeleton; one click jumps to a
 * section. Loose copy is intentionally not on the map (nor in the
 * wireframe); unlinked sections show a hollow number.
 *
 * Width: by default it adapts to the copy pane (a CSS container) — full
 * titled list on roomy panes, numbers-only rail when space is tight so
 * the editor keeps the width. The list icon (compact) and the chevron
 * (full) toggle it manually; a toggle overrides the auto behavior and
 * persists.
 */
type TocVariant = "auto" | "full" | "compact";

const VARIANT_CLASSES: Record<TocVariant, {
  wrapper: string;
  iconHeader: string;
  textHeader: string;
  button: string;
  title: string;
}> = {
  auto: {
    wrapper: "w-11 pl-2 @5xl:w-52 @5xl:pl-5 @5xl:pr-1",
    iconHeader: "flex @5xl:hidden",
    textHeader: "hidden @5xl:flex",
    button: "justify-center p-1 @5xl:justify-start @5xl:px-2 @5xl:py-1",
    title: "hidden @5xl:inline",
  },
  full: {
    wrapper: "w-52 pl-5 pr-1",
    iconHeader: "hidden",
    textHeader: "flex",
    button: "justify-start px-2 py-1",
    title: "inline",
  },
  compact: {
    wrapper: "w-11 pl-2",
    iconHeader: "flex",
    textHeader: "hidden",
    button: "justify-center p-1",
    title: "hidden",
  },
};

const STORAGE_KEY = "copydog:toc";

export function SectionToc({
  sections,
  onNavigate,
}: {
  sections: SectionView[];
  onNavigate: (slug: string) => void;
}) {
  // null = auto (pane width decides); a toggle pins it open or closed
  const [expanded, setExpanded] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) queueMicrotask(() => setExpanded(stored === "1"));
  }, []);

  const toggle = (next: boolean) => {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    setExpanded(next);
  };

  if (sections.length === 0) return null;

  const classes = VARIANT_CLASSES[expanded === null ? "auto" : expanded ? "full" : "compact"];

  return (
    <div className={`hidden shrink-0 pt-[4.5rem] md:block ${classes.wrapper}`}>
      <nav aria-label="Sections" className="sticky top-[7.5rem] max-h-[calc(100dvh-8.5rem)] overflow-y-auto pb-8">
        <div className={`mb-2 justify-center ${classes.iconHeader}`}>
          <button
            type="button"
            onClick={() => toggle(true)}
            aria-label="Expand contents"
            aria-expanded={false}
            title="Expand contents"
            className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <TocIcon />
          </button>
        </div>
        <header className={`mb-2.5 items-center justify-between pl-2 pr-0.5 ${classes.textHeader}`}>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">On this page</h2>
          <button
            type="button"
            onClick={() => toggle(false)}
            aria-label="Collapse contents"
            aria-expanded
            title="Collapse contents"
            className="flex size-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
        </header>
        <ol className="space-y-0.5">
          {sections.map((section, index) => (
            <li key={section.slug}>
              <button
                type="button"
                onClick={() => onNavigate(section.slug)}
                title={section.linked ? section.title : `${section.title} (unlinked)`}
                aria-label={`Go to section ${index + 1}: ${section.title}`}
                className={`group flex w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-surface-hover ${classes.button}`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums transition-colors group-hover:text-accent ${
                    section.linked ? "text-ink-tertiary" : "text-ink-tertiary/60 ring-1 ring-inset ring-border"
                  }`}
                >
                  {index + 1}
                </span>
                <span
                  className={`truncate text-xs transition-colors group-hover:text-ink ${classes.title} ${
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
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" strokeLinecap="round" />
      <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeLinecap="round" />
    </svg>
  );
}
