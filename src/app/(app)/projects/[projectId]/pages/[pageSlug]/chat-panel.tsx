"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChatStreamEvent } from "@/lib/agent/events";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The in-flight turn: text streamed so far + what the agent is doing. */
interface LiveTurn {
  text: string;
  activity: string | null;
}

/**
 * The assistant drawer. The agent edits the user's draft through the same
 * autosave path as the keyboard; its turn streams in live — tokens, tool
 * activity, and a draft reload after every mutating tool — so you watch
 * the design evolve instead of waiting for the reply.
 */
export function ChatPanel({
  projectId,
  pageSlug,
  onLiveMutation,
  onMutated,
  onClose,
}: {
  projectId: string;
  pageSlug: string;
  /** a tool changed the draft mid-turn — cheap refresh (no remount) so the wireframe evolves live */
  onLiveMutation: () => void;
  /** the turn finished with changes — full reload of the draft view */
  onMutated: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [live, setLive] = useState<LiveTurn | null>(null);
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
  }, [messages, live, busy]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      setError(null);
      setMessages((current) => [...(current ?? []), { role: "user", content: text }]);
      setLive({ text: "", activity: null });
      try {
        const res = await fetch(`/projects/${projectId}/pages/${pageSlug}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? "Something went wrong — try again.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleEvent(JSON.parse(line) as ChatStreamEvent);
          }
        }
      } catch {
        setError("Something went wrong — try again.");
      } finally {
        setBusy(false);
        setLive(null);
      }

      function handleEvent(event: ChatStreamEvent) {
        switch (event.type) {
          case "delta":
            setLive((turn) => ({ text: (turn?.text ?? "") + event.text, activity: null }));
            break;
          case "status":
            setLive((turn) => ({ text: turn?.text ?? "", activity: event.label }));
            break;
          case "mutated":
            onLiveMutation();
            break;
          case "done":
            setMessages((current) => [...(current ?? []), { role: "assistant", content: event.reply }]);
            // full reload last: it may remount the editor (and this panel) —
            // by now the reply is persisted, so history survives the remount
            if (event.mutated) onMutated();
            break;
          case "error":
            setError(event.error);
            break;
        }
      }
    },
    [projectId, pageSlug, busy, onLiveMutation, onMutated],
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
        ) : messages.length === 0 && !busy ? (
          <div className="space-y-2 text-sm leading-relaxed text-ink-secondary">
            <p>
              I can design the wireframe with you — &ldquo;make the hero a split&rdquo;, &ldquo;3-up card grid for
              features&rdquo;, or describe a whole page and I&rsquo;ll build a first draft. I also rewrite copy and add
              sections.
            </p>
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
        {busy && (
          <div className="mr-6 space-y-1.5">
            {live?.text ? (
              <div className="rounded-lg rounded-bl-sm border border-border bg-surface-sunken/60 px-3 py-2 text-sm leading-relaxed text-ink-secondary">
                {live.text}
              </div>
            ) : null}
            <p className="animate-pulse px-3 text-xs text-ink-tertiary">{live?.activity ?? "Thinking…"}</p>
          </div>
        )}
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
          placeholder="Design the hero as a split…"
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
