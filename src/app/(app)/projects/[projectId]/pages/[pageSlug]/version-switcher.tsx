"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/ui/icons";
import type { SectionVersionRef } from "@/lib/content/doc";
import { createClient } from "@/lib/supabase/client";

interface TeammateVersion {
  authorId: string;
  versionSlug: string;
  label: string;
  authorName: string;
}

/**
 * The version pill on a section: shows the active version's label, switches
 * between your versions, branches a new one, and adopts teammates'
 * published versions into your draft.
 */
export function VersionSwitcher({
  projectId,
  pageSlug,
  sectionSlug,
  versions,
  activeVersion,
  onSwitch,
  onCreate,
  onAdopt,
  disabled,
}: {
  projectId: string;
  pageSlug: string;
  sectionSlug: string;
  versions: SectionVersionRef[];
  activeVersion: string;
  onSwitch: (slug: string) => void;
  onCreate: (label: string) => void;
  onAdopt: (source: { authorId: string; versionSlug: string; label: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [teammates, setTeammates] = useState<TeammateVersion[] | null>(null);
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

  const loadTeammates = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("section_versions")
      .select("author_id, version_slug, label, author:profiles(display_name)")
      .match({ project_id: projectId, page_slug: pageSlug, section_slug: sectionSlug })
      .neq("author_id", user?.id ?? "");
    setTeammates(
      ((data ?? []) as unknown as { author_id: string; version_slug: string; label: string; author: { display_name: string } | null }[]).map(
        (row) => ({
          authorId: row.author_id,
          versionSlug: row.version_slug,
          label: row.label,
          authorName: row.author?.display_name ?? "Teammate",
        }),
      ),
    );
  }, [projectId, pageSlug, sectionSlug]);

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => !wasOpen);
    if (!open) void loadTeammates();
  }, [open, loadTeammates]);

  const active = versions.find((v) => v.slug === activeVersion);
  const hasAlternates = versions.length > 1;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
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
          className="absolute right-0 top-7 z-20 w-60 rounded-lg border border-border bg-surface p-1 shadow-raised"
        >
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">
            Your versions
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

          {teammates !== null && teammates.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">
                From teammates
              </p>
              {teammates.map((tv) => (
                <button
                  key={`${tv.authorId}:${tv.versionSlug}`}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onAdopt({ authorId: tv.authorId, versionSlug: tv.versionSlug, label: `${tv.label} (${tv.authorName})` });
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                  title={`Adopt ${tv.authorName}'s “${tv.label}” into your draft`}
                >
                  <span className="truncate">
                    {tv.label} <span className="text-ink-tertiary">— {tv.authorName}</span>
                  </span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent">Adopt</span>
                </button>
              ))}
            </>
          )}

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
    <ChevronDownIcon className="size-3" />
  );
}
