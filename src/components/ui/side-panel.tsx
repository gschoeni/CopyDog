"use client";

import { useRef, type ReactNode } from "react";

import { PanelRightIcon } from "./icons";
import { ResizeHandle, usePanelSize } from "./resize-handle";

/**
 * A collapsible workbench side panel: pinned to the viewport below the page
 * chrome (app header h-14 + toolbar h-12 = 6.5rem), scrolling internally, so
 * any number of panels can sit beside the copy/wireframe panes and stay fully
 * on screen however long the document gets.
 *
 * Panels never disappear — they slim to a 44px icon rail (like the pages
 * sidebar), so reopening is always one click on the same edge. While slimmed
 * the children stay mounted (hidden), preserving state such as an in-flight
 * assistant stream. Content manages its own layout inside a column flexbox
 * (use min-h-0 flex-1 for the scrolling region).
 *
 * Expanded panels are resizable by their left edge; the width persists
 * per panel label.
 */
export function SidePanel({
  label,
  title,
  badge,
  icon,
  active = false,
  collapsed,
  onToggle,
  actions,
  children,
}: {
  /** accessible name of the panel (aria-label) and of its toggle buttons */
  label: string;
  title: ReactNode;
  /** small decorative affordance next to the title */
  badge?: ReactNode;
  /** the panel's identity glyph, shown on the rail when slimmed */
  icon: ReactNode;
  /** something is happening inside — the rail icon gets a pulse dot */
  active?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  /** optional compact controls placed before the collapse button */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const { size, commit, reset } = usePanelSize({
    storageKey: `copydog:w:panel:${label.toLowerCase().replace(/\s+/g, "-")}`,
    defaultSize: 384,
    min: 300,
    max: 640,
  });

  return (
    <aside
      ref={asideRef}
      aria-label={label}
      style={collapsed ? undefined : { width: size }}
      // sticky is a containing block — the absolute resize handle anchors to it
      className={`sticky top-[6.5rem] flex h-[calc(100dvh-6.5rem)] shrink-0 flex-col self-start overflow-hidden border-l border-border bg-surface transition-[width] duration-200 ease-out ${
        collapsed ? "w-11" : ""
      }`}
    >
      {!collapsed && (
        <ResizeHandle
          label={`Resize ${label.toLowerCase()}`}
          value={size}
          min={300}
          max={640}
          invertKeyboard
          sizeAt={(clientX) => (asideRef.current?.getBoundingClientRect().right ?? clientX) - clientX}
          onPreview={(width) => {
            const el = asideRef.current;
            if (!el) return;
            el.style.transitionProperty = "none";
            el.style.width = `${width}px`;
          }}
          onCommit={(width) => {
            if (asideRef.current) asideRef.current.style.transitionProperty = "";
            commit(width);
          }}
          onReset={reset}
          className="absolute inset-y-0 left-0 z-30 w-2.5"
        />
      )}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Open ${label.toLowerCase()}`}
            aria-expanded={false}
            title={label}
            className="relative flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            {icon}
            {active && (
              <span
                aria-hidden
                className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-accent"
              />
            )}
          </button>
        </div>
      ) : (
        <header className="flex items-center justify-between border-b border-border py-2.5 pl-4 pr-2">
          <div className="flex items-baseline gap-1.5">
            <h2 className="whitespace-nowrap text-sm font-semibold tracking-tight">{title}</h2>
            {badge != null && (
              <span aria-hidden className="text-xs text-ink-tertiary">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onToggle}
              aria-label={`Collapse ${label.toLowerCase()}`}
              aria-expanded
              title={`Collapse ${label.toLowerCase()}`}
              className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <PanelRightIcon />
            </button>
          </div>
        </header>
      )}
      {/* hidden, not unmounted: panel state (a streaming turn, scroll
          position, a half-typed message) survives slimming */}
      <div className={collapsed ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
    </aside>
  );
}
