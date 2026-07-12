"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface Note {
  id: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
  author: { display_name: string } | null;
}

/**
 * Notes on a section — thoughts and feedback that are about the copy but
 * aren't copy. Straight to Postgres through RLS; content files stay clean.
 */
export function SectionNotes({
  projectId,
  pageSlug,
  sectionSlug,
}: {
  projectId: string;
  pageSlug: string;
  sectionSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const scope = useCallback(
    () =>
      createClient()
        .from("comments")
        .select("id, body, created_at, resolved_at, author:profiles(display_name)")
        .match({ project_id: projectId, page_slug: pageSlug, section_slug: sectionSlug }),
    [projectId, pageSlug, sectionSlug],
  );

  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("comments")
      .select("id", { count: "exact", head: true })
      .match({ project_id: projectId, page_slug: pageSlug, section_slug: sectionSlug })
      .is("resolved_at", null)
      .then(({ count }) => {
        if (!cancelled && count) setOpenCount(count);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pageSlug, sectionSlug]);

  const refresh = useCallback(async () => {
    const { data } = await scope().order("created_at", { ascending: true });
    const list = (data ?? []) as unknown as Note[];
    setNotes(list);
    setOpenCount(list.filter((n) => !n.resolved_at).length);
  }, [scope]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => !wasOpen);
    if (!open) void refresh();
  }, [open, refresh]);

  async function addNote(body: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("comments").insert({
      project_id: projectId,
      page_slug: pageSlug,
      section_slug: sectionSlug,
      author_id: user.id,
      body,
    });
    await refresh();
  }

  async function toggleResolved(note: Note) {
    await createClient()
      .from("comments")
      .update({ resolved_at: note.resolved_at ? null : new Date().toISOString() })
      .eq("id", note.id);
    await refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={`Notes${openCount ? ` (${openCount} open)` : ""}`}
        aria-expanded={open}
        className={`flex h-6 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
          openCount > 0
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-border text-ink-tertiary hover:border-border-strong hover:text-ink-secondary"
        }`}
      >
        <NoteIcon />
        {openCount > 0 ? openCount : "Notes"}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-20 w-80 rounded-lg border border-border bg-surface shadow-raised">
          <div className="max-h-72 overflow-y-auto p-2">
            {notes === null ? (
              <p className="px-2 py-3 text-xs text-ink-tertiary">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="px-2 py-3 text-xs text-ink-tertiary">
                No notes yet. Keep feedback and stray thoughts here — they never touch the copy.
              </p>
            ) : (
              <ul className="space-y-1">
                {notes.map((note) => (
                  <li key={note.id} className={`rounded-md px-2 py-1.5 ${note.resolved_at ? "opacity-50" : ""}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-medium">{note.author?.display_name ?? "Someone"}</p>
                      <button
                        type="button"
                        onClick={() => toggleResolved(note)}
                        className="shrink-0 text-[10px] text-ink-tertiary underline-offset-2 hover:text-ink hover:underline"
                      >
                        {note.resolved_at ? "Reopen" : "Resolve"}
                      </button>
                    </div>
                    <p className={`mt-0.5 text-sm text-ink-secondary ${note.resolved_at ? "line-through" : ""}`}>
                      {note.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form
            className="flex gap-2 border-t border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("note") as HTMLInputElement;
              const body = input.value.trim();
              if (!body) return;
              input.value = "";
              void addNote(body);
            }}
          >
            <input
              name="note"
              placeholder="Add a note…"
              aria-label="Add a note"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm outline-none placeholder:text-ink-tertiary focus:border-accent"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 3h10v7H8l-3 3v-3H3z" strokeLinejoin="round" />
    </svg>
  );
}
