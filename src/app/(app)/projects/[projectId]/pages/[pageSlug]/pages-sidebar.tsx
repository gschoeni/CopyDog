"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { ChevronDownIcon, GripIcon, PanelLeftIcon, PlusIcon, ProposeIcon } from "@/components/ui/icons";
import { flattenPages, movePageNode, type PageRef } from "@/lib/content/site";
import { createClient } from "@/lib/supabase/client";

import { addPageAction, movePageAction } from "./actions";

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
  const [collapsed, setCollapsed] = useState(false);

  // restore after hydration commit: SSR can't see localStorage (same
  // pattern as the editor's per-project view-mode restore)
  useEffect(() => {
    const stored = localStorage.getItem(`copydog:sidebar:${projectId}`) === "1";
    queueMicrotask(() => setCollapsed(stored));
  }, [projectId]);

  const toggle = () => {
    setCollapsed((current) => {
      localStorage.setItem(`copydog:sidebar:${projectId}`, current ? "0" : "1");
      return !current;
    });
  };

  return (
    <aside
      aria-label="Project sidebar"
      className={`sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col self-start overflow-hidden border-r border-border bg-surface-sunken/50 transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-11" : "w-56"
      }`}
    >
      {collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-label="Open project sidebar"
            aria-expanded={false}
            title={projectName}
            className="flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <PanelLeftIcon />
          </button>
          <div aria-hidden className="my-1 h-px w-5 bg-border" />
          <nav aria-label="Pages" className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto">
            {flattenPages(pages).map(({ page }) => (
              <Link
                key={page.slug}
                href={`/projects/${projectId}/pages/${page.slug}`}
                aria-current={page.slug === activeSlug ? "page" : undefined}
                aria-label={page.title}
                title={page.title}
                className={`flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                  page.slug === activeSlug
                    ? "bg-surface text-ink shadow-soft"
                    : "text-ink-tertiary hover:bg-surface-hover hover:text-ink"
                }`}
              >
                {(page.title.trim()[0] ?? "?").toUpperCase()}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggle}
            aria-label="New page"
            title="New page"
            className="flex size-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <PlusIcon />
          </button>
          <div className="flex-1" />
          <Link
            href={`/projects/${projectId}/proposals`}
            aria-label={openProposals > 0 ? `Proposals (${openProposals} open)` : "Proposals"}
            title={openProposals > 0 ? `Proposals (${openProposals} open)` : "Proposals"}
            className="relative flex size-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <ProposeIcon />
            {openProposals > 0 && (
              <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />
            )}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 pb-2 pl-4 pr-2 pt-3">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.15em] text-ink-tertiary">{projectName}</p>
            <button
              type="button"
              onClick={toggle}
              aria-label="Collapse project sidebar"
              aria-expanded
              title="Collapse sidebar"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <PanelLeftIcon />
            </button>
          </div>
          <PageTree projectId={projectId} pages={pages} activeSlug={activeSlug} />
          <SidebarCollaboration projectId={projectId} initialMembers={initialMembers} openProposals={openProposals} />
        </>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* The page tree: nested pages, drag-to-reorder, add-subpage inline    */
/* ------------------------------------------------------------------ */

type DropTarget = { slug: string; kind: "before" | "after" | "into" };

/**
 * Pages as a draggable tree. Rows reveal a grip (drag) and a ⊕ (add
 * subpage) on hover; subtrees fold on the chevron. Dragging is
 * pointer-based (house rule — smooth and testable): the drop zone within
 * a row decides the move — top edge = before, bottom edge = after,
 * middle = nest inside. Moves apply optimistically, then persist.
 */
function PageTree({ projectId, pages, activeSlug }: { projectId: string; pages: PageRef[]; activeSlug: string }) {
  const router = useRouter();

  // optimistic tree while a move round-trips; cleared when props catch up
  // (React's "adjust state when props change" render-time pattern)
  const [override, setOverride] = useState<PageRef[] | null>(null);
  const [prevPages, setPrevPages] = useState(pages);
  if (prevPages !== pages) {
    setPrevPages(pages);
    setOverride(null);
  }
  const tree = override ?? pages;

  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`copydog:pages-folded:${projectId}`) ?? "[]") as string[];
      queueMicrotask(() => setFolded(new Set(stored)));
    } catch {
      // unreadable state is just "nothing folded"
    }
  }, [projectId]);
  const setFoldedPersistent = useCallback(
    (next: Set<string>) => {
      setFolded(next);
      localStorage.setItem(`copydog:pages-folded:${projectId}`, JSON.stringify([...next]));
    },
    [projectId],
  );
  const toggleFold = useCallback(
    (slug: string) => {
      const next = new Set(folded);
      if (!next.delete(slug)) next.add(slug);
      setFoldedPersistent(next);
    },
    [folded, setFoldedPersistent],
  );

  // where the "new page" input lives: null = closed, parent null = top level
  const [adding, setAdding] = useState<{ parent: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const addPage = useCallback(
    async (title: string, parent: string | null) => {
      if (!title.trim() || busy) return;
      setBusy(true);
      try {
        const { slug } = await addPageAction({ projectId, title: title.trim(), parentSlug: parent ?? undefined });
        setAdding(null);
        // no refresh needed: the pushed route server-renders fresh site.json
        router.push(`/projects/${projectId}/pages/${slug}`);
      } finally {
        setBusy(false);
      }
    },
    [projectId, busy, router],
  );

  const addSubpage = useCallback(
    (parent: string) => {
      // the input renders as a child row — make sure the subtree is open
      if (folded.has(parent)) {
        const next = new Set(folded);
        next.delete(parent);
        setFoldedPersistent(next);
      }
      setAdding({ parent });
    },
    [folded, setFoldedPersistent],
  );

  /* --- drag state --- */
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const dropRef = useRef<DropTarget | null>(null);

  const parentBySlug = useMemo(() => {
    const map = new Map<string, string | null>();
    const walk = (nodes: PageRef[], parent: string | null) => {
      for (const node of nodes) {
        map.set(node.slug, parent);
        walk(node.children ?? [], node.slug);
      }
    };
    walk(tree, null);
    return map;
  }, [tree]);

  const startDrag = useCallback(
    (slug: string) => (event: ReactPointerEvent) => {
      event.preventDefault();
      const moving = flattenPages(tree).find(({ page }) => page.slug === slug)?.page;
      if (!moving) return;
      const subtree = new Set(flattenPages([moving]).map(({ page }) => page.slug));
      setDragging(slug);

      const onMove = (e: PointerEvent) => {
        let target: DropTarget | null = null;
        for (const [rowSlug, el] of rowRefs.current) {
          if (subtree.has(rowSlug)) continue; // never drop a page into itself
          const rect = el.getBoundingClientRect();
          if (e.clientY < rect.top || e.clientY > rect.bottom) continue;
          const t = (e.clientY - rect.top) / rect.height;
          target = { slug: rowSlug, kind: t < 0.3 ? "before" : t > 0.7 ? "after" : "into" };
          break;
        }
        dropRef.current = target;
        setDrop(target);
      };

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        document.body.style.removeProperty("cursor");
        const target = dropRef.current;
        dropRef.current = null;
        setDragging(null);
        setDrop(null);
        if (!target) return;

        const parent = target.kind === "into" ? target.slug : (parentBySlug.get(target.slug) ?? null);
        let before: string | null = null;
        if (target.kind === "before") before = target.slug;
        if (target.kind === "after") {
          const siblings = parent === null ? tree : (flattenPages(tree).find(({ page }) => page.slug === parent)?.page.children ?? []);
          const at = siblings.findIndex((p) => p.slug === target.slug);
          before = siblings[at + 1]?.slug ?? null;
        }

        const next = structuredClone(tree);
        if (!movePageNode(next, slug, parent, before)) return;
        setOverride(next);
        if (target.kind === "into" && folded.has(target.slug)) {
          const openParent = new Set(folded);
          openParent.delete(target.slug);
          setFoldedPersistent(openParent);
        }
        void movePageAction({ projectId, slug, parentSlug: parent, beforeSlug: before }).then(() => router.refresh());
      };

      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
    },
    [tree, parentBySlug, folded, setFoldedPersistent, projectId, router],
  );

  const renderRows = (nodes: PageRef[]): ReactNode =>
    nodes.map((page) => {
      const children = page.children ?? [];
      const isFolded = folded.has(page.slug);
      const isDrop = drop?.slug === page.slug;
      const addingHere = adding?.parent === page.slug;
      return (
        <div key={page.slug}>
          <div
            ref={(el) => {
              if (el) rowRefs.current.set(page.slug, el);
              else rowRefs.current.delete(page.slug);
            }}
            data-page-row={page.slug}
            className={`group relative flex items-center gap-1 rounded-md pl-1 pr-0.5 transition-colors ${
              dragging === page.slug ? "opacity-40" : ""
            } ${
              isDrop && drop.kind === "into"
                ? "bg-accent-soft ring-1 ring-inset ring-accent/50"
                : page.slug === activeSlug
                  ? "bg-surface shadow-soft"
                  : "hover:bg-surface-hover/60"
            }`}
          >
            {isDrop && drop.kind !== "into" && (
              <span
                aria-hidden
                className={`pointer-events-none absolute left-1 right-1 z-10 h-0.5 rounded-full bg-accent ${
                  drop.kind === "before" ? "-top-px" : "-bottom-px"
                }`}
              />
            )}
            {/* the row's anchor tells its nature at rest: parents fold, leaves dot */}
            {children.length > 0 ? (
              <button
                type="button"
                aria-label={isFolded ? `Expand ${page.title}` : `Fold ${page.title}`}
                aria-expanded={!isFolded}
                onClick={() => toggleFold(page.slug)}
                className="flex size-4 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <ChevronDownIcon className={`size-3 transition-transform ${isFolded ? "-rotate-90" : ""}`} />
              </button>
            ) : (
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                <span className="size-[5px] rounded-full bg-ink-tertiary/40" />
              </span>
            )}
            <Link
              href={`/projects/${projectId}/pages/${page.slug}`}
              aria-current={page.slug === activeSlug ? "page" : undefined}
              draggable={false}
              className={`min-w-0 flex-1 truncate py-1.5 text-sm transition-colors ${
                page.slug === activeSlug ? "font-medium text-ink" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {page.title}
            </Link>
            <button
              type="button"
              aria-label={`Drag ${page.title}`}
              title="Drag to reorder — drop on a page to nest"
              onPointerDown={startDrag(page.slug)}
              className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-tertiary/80 opacity-0 transition-opacity hover:bg-surface-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <GripIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Add subpage inside ${page.title}`}
              title="Add subpage"
              onClick={() => addSubpage(page.slug)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary/80 opacity-0 transition-opacity hover:bg-surface-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
          {((children.length > 0 && !isFolded) || addingHere) && (
            /* subtree in a guided gutter: the hairline drops from the parent's
               anchor, so nesting reads at a glance and highlights hug their level */
            <div className="ml-[11px] space-y-px border-l border-border pl-1.5">
              {!isFolded && renderRows(children)}
              {addingHere && <AddPageInput busy={busy} onSubmit={(t) => addPage(t, page.slug)} onCancel={() => setAdding(null)} />}
            </div>
          )}
        </div>
      );
    });

  return (
    <nav aria-label="Pages" className={`min-h-0 flex-1 space-y-px overflow-y-auto px-2 ${dragging ? "select-none" : ""}`}>
      {renderRows(tree)}
      {adding?.parent === null && <AddPageInput busy={busy} onSubmit={(t) => addPage(t, null)} onCancel={() => setAdding(null)} />}
      <button
        type="button"
        onClick={() => setAdding({ parent: null })}
        className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
      >
        + New page
      </button>
    </nav>
  );
}

function AddPageInput({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      placeholder="Page name"
      disabled={busy}
      aria-label="New page name"
      className="my-0.5 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(e.currentTarget.value);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={(e) => {
        if (e.currentTarget.value.trim()) onSubmit(e.currentTarget.value);
        else onCancel();
      }}
    />
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
