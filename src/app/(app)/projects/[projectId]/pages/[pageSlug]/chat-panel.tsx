"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

import { chatAction } from "./actions";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The assistant drawer. The agent edits the user's draft through the same
 * autosave path as the keyboard — after a mutating turn we reload so the
 * editor and wireframe show its work.
 */
export function ChatPanel({
  projectId,
  pageSlug,
  onMutated,
  onClose,
}: {
  projectId: string;
  pageSlug: string;
  onMutated: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("chat_messages")
        .select("role, content")
        .match({ project_id: projectId, user_id: user?.id ?? "", page_slug: pageSlug })
        .order("created_at", { ascending: true })
        .limit(50);
      if (!cancelled) setMessages((data ?? []) as ChatMessage[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, pageSlug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setError(null);
      setMessages((current) => [...(current ?? []), { role: "user", content: text }]);
      try {
        const result = await chatAction({ projectId, pageSlug, message: text });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setMessages((current) => [...(current ?? []), { role: "assistant", content: result.reply }]);
        if (result.mutated) onMutated();
      } catch {
        setError("Something went wrong — try again.");
      } finally {
        setBusy(false);
      }
    },
    [projectId, pageSlug, busy, onMutated],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface" aria-label="Assistant">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-semibold tracking-tight">Assistant</h2>
          <span aria-hidden className="text-xs text-ink-tertiary">
            🐕
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
        >
          ✕
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages === null ? (
          <p className="text-xs text-ink-tertiary">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="space-y-2 text-sm leading-relaxed text-ink-secondary">
            <p>I can rewrite sections, brainstorm alternates, add sections, or redesign the wireframe layout.</p>
            <p className="text-xs text-ink-tertiary">
              Everything lands in your private draft as new versions — nothing is overwritten.
            </p>
          </div>
        ) : (
          messages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? "ml-6 rounded-lg rounded-br-sm bg-accent-soft px-3 py-2 text-sm text-ink"
                  : "mr-6 rounded-lg rounded-bl-sm border border-border bg-surface-sunken/60 px-3 py-2 text-sm leading-relaxed text-ink-secondary"
              }
            >
              {message.content}
            </div>
          ))
        )}
        {busy && <p className="mr-6 animate-pulse px-3 text-sm text-ink-tertiary">Working on it…</p>}
        {error && <p className="px-1 text-xs text-danger">{error}</p>}
      </div>

      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("message") as HTMLInputElement;
          const text = input.value;
          input.value = "";
          void send(text);
        }}
      >
        <input
          name="message"
          placeholder="Punch up the hero…"
          aria-label="Message the assistant"
          disabled={busy}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
        />
        <Button type="submit" size="sm" disabled={busy} className="h-9">
          Send
        </Button>
      </form>
    </aside>
  );
}
