"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PageRef } from "@/lib/content/site";
import { createClient } from "@/lib/supabase/client";

import { addPageAction } from "./actions";

export interface SidebarMember {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
}

export function PagesSidebar({
  projectId,
  projectName,
  pages,
  activeSlug,
  initialMembers,
  openProposals,
}: {
  projectId: string;
  projectName: string;
  pages: PageRef[];
  activeSlug: string;
  initialMembers: SidebarMember[];
  openProposals: number;
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

      <SidebarCollaboration projectId={projectId} initialMembers={initialMembers} openProposals={openProposals} />
    </aside>
  );
}

/** Proposals link + team roster + invite, tucked at the sidebar's foot. */
function SidebarCollaboration({
  projectId,
  initialMembers,
  openProposals,
}: {
  projectId: string;
  initialMembers: SidebarMember[];
  openProposals: number;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(email: string) {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_email: email.trim(),
    });
    if (rpcError) {
      setError(
        rpcError.message.includes("no CopyDog account")
          ? "No account with that email yet — ask them to sign in once first."
          : "Couldn't invite that person.",
      );
      setBusy(false);
      return;
    }
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, profile:profiles(display_name)")
      .eq("project_id", projectId);
    setMembers(
      ((data ?? []) as unknown as { user_id: string; role: "owner" | "editor"; profile: { display_name: string } | null }[]).map(
        (row) => ({ userId: row.user_id, role: row.role, displayName: row.profile?.display_name ?? "Member" }),
      ),
    );
    setBusy(false);
  }

  return (
    <div className="border-t border-border px-2 py-3">
      <Link
        href={`/projects/${projectId}/proposals`}
        className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
      >
        Proposals
        {openProposals > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            {openProposals}
          </span>
        )}
      </Link>

      <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">Team</p>
      <ul className="space-y-0.5 px-2">
        {members.map((member) => (
          <li key={member.userId} className="flex items-baseline justify-between text-xs">
            <span className="truncate text-ink-secondary">{member.displayName}</span>
            <span className="shrink-0 pl-2 text-[10px] uppercase tracking-wide text-ink-tertiary/70">{member.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 px-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("email") as HTMLInputElement;
          void invite(input.value).then(() => {
            input.value = "";
          });
        }}
      >
        <input
          name="email"
          type="email"
          placeholder="Invite by email…"
          aria-label="Invite by email"
          disabled={busy}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-tertiary focus:border-accent"
        />
      </form>
      {error && <p className="mt-1.5 px-2 text-[11px] leading-snug text-danger">{error}</p>}
    </div>
  );
}
