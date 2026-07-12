"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PageRef } from "@/lib/content/site";

import { addPageAction } from "./actions";

export function PagesSidebar({
  projectId,
  projectName,
  pages,
  activeSlug,
}: {
  projectId: string;
  projectName: string;
  pages: PageRef[];
  activeSlug: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function addPage(title: string) {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const { slug } = await addPageAction({ projectId, title: title.trim() });
      setAdding(false);
      // no refresh needed: the pushed route server-renders fresh site.json
      router.push(`/projects/${projectId}/pages/${slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-sunken/50 md:flex">
      <div className="px-4 pb-2 pt-5">
        <p className="truncate text-xs font-semibold uppercase tracking-[0.15em] text-ink-tertiary">{projectName}</p>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {pages.map((page) => (
          <Link
            key={page.slug}
            href={`/projects/${projectId}/pages/${page.slug}`}
            aria-current={page.slug === activeSlug ? "page" : undefined}
            className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
              page.slug === activeSlug
                ? "bg-surface font-medium text-ink shadow-soft"
                : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
            }`}
          >
            {page.title}
          </Link>
        ))}
        {adding ? (
          <input
            autoFocus
            placeholder="Page name"
            disabled={busy}
            aria-label="New page name"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addPage(e.currentTarget.value);
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim()) void addPage(e.currentTarget.value);
              else setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            + New page
          </button>
        )}
      </nav>
    </aside>
  );
}
