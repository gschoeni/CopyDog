"use client";

import { useEffect, useRef, useState } from "react";

import type { SectionVersionRef } from "@/lib/content/doc";

/**
 * The version pill on a section: shows the active version's label and opens
 * a menu to switch versions or branch a new one from the current copy.
 */
export function VersionSwitcher({
  versions,
  activeVersion,
  onSwitch,
  onCreate,
  disabled,
}: {
  versions: SectionVersionRef[];
  activeVersion: string;
  onSwitch: (slug: string) => void;
  onCreate: (label: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const active = versions.find((v) => v.slug === activeVersion);
  const hasAlternates = versions.length > 1;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
          hasAlternates
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-border text-ink-tertiary hover:border-border-strong hover:text-ink-secondary"
        }`}
      >
        {active?.label ?? activeVersion}
        {hasAlternates && <span className="opacity-70">· {versions.length}</span>}
        <ChevronDown />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 w-56 rounded-lg border border-border bg-surface p-1 shadow-raised"
        >
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">
            Versions
          </p>
          {versions.map((version) => (
            <button
              key={version.slug}
              type="button"
              role="menuitemradio"
              aria-checked={version.slug === activeVersion}
              onClick={() => {
                setOpen(false);
                if (version.slug !== activeVersion) onSwitch(version.slug);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <span className="truncate">{version.label}</span>
              {version.slug === activeVersion && <span className="text-accent">✓</span>}
            </button>
          ))}
          <div className="mx-1 my-1 h-px bg-border" />
          {naming ? (
            <input
              autoFocus
              placeholder="Version name"
              aria-label="New version name"
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  onCreate(e.currentTarget.value.trim());
                  setOpen(false);
                  setNaming(false);
                }
                if (e.key === "Escape") setNaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setNaming(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <span aria-hidden>+</span> New version from current
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
