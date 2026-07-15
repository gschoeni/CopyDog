import type { ReactNode } from "react";

/**
 * A collapsible workbench side panel: pinned to the viewport below the page
 * chrome (app header h-14 + toolbar h-12 = 6.5rem), scrolling internally, so
 * any number of panels can sit beside the copy/wireframe panes and stay fully
 * on screen however long the document gets. Content manages its own layout
 * inside a column flexbox (use min-h-0 flex-1 for the scrolling region).
 */
export function SidePanel({
  label,
  title,
  badge,
  onClose,
  children,
}: {
  /** accessible name of the panel (aria-label) and of its close button */
  label: string;
  title: ReactNode;
  /** small decorative affordance next to the title */
  badge?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="sticky top-[6.5rem] flex h-[calc(100dvh-6.5rem)] w-80 shrink-0 flex-col self-start border-l border-border bg-surface"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {badge != null && (
            <span aria-hidden className="text-xs text-ink-tertiary">
              {badge}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
          className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
        >
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}
