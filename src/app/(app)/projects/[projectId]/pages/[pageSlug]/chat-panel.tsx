"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";

import {
  contextRefLabel,
  isReferenceRef,
  MAX_CONTEXT_REFS,
  MAX_REFERENCE_REFS,
  type ChatContextRef,
  type ReferenceContextRef,
} from "@/lib/agent/context";
import type { ChatInteraction } from "@/lib/agent/interactions";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CopyIcon,
  HistoryIcon,
  PawIcon,
  PlusIcon,
  SparklesIcon,
  TextLinesIcon,
  WireframeModeIcon,
} from "@/components/ui/icons";
import { SidePanel } from "@/components/ui/side-panel";
import type { ChatStreamEvent } from "@/lib/agent/events";
import { createClient } from "@/lib/supabase/client";

import { AssistantMarkdown } from "./assistant-markdown";
import { AttachReferenceButton, ReferenceMediaIcon, attachFile, attachUrl } from "./chat-attachments";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  interaction?: ChatInteraction | null;
  context?: ChatContextRef[] | null;
}

/** Imperative surface for the editor panes ("Add to chat" attachments). */
export interface ChatPanelHandle {
  addContext: (ref: ChatContextRef) => void;
}

interface ChatThread {
  id: string;
  title: string;
}

function createConversationId() {
  return crypto.randomUUID();
}

interface LiveTurn {
  text: string;
  activity: string | null;
}

const STARTERS = [
  { label: "Improve the copy", prompt: "Review this page and improve the copy while preserving its intent." },
  { label: "Design this page", prompt: "Design a clear, polished wireframe for this page." },
  { label: "Add a section", prompt: "Add a new section that would make this page more complete." },
];

/** A dropped/pasted payload the composer knows how to attach. */
function droppedFile(transfer: DataTransfer | null): File | null {
  return transfer?.files?.[0] ?? null;
}

/** A streaming assistant that edits the user's private draft. */
export function ChatPanel({
  projectId,
  pageSlug,
  collapsed,
  onToggle,
  onLiveMutation,
  onMutated,
  ref,
}: {
  projectId: string;
  pageSlug: string;
  collapsed: boolean;
  onToggle: () => void;
  onLiveMutation: () => void;
  onMutated: () => void;
  ref?: Ref<ChatPanelHandle>;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [conversationId, setConversationId] = useState<string>(() => createConversationId());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingContext, setPendingContext] = useState<ChatContextRef[]>([]);
  const [attaching, setAttaching] = useState(0);
  const [attachProgress, setAttachProgress] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const lastSendRef = useRef<{ prompt: string; context?: ChatContextRef[] } | null>(null);
  /** The conversation the user is looking at — guards stale async loads. */
  const activeConversationRef = useRef(conversationId);
  /** Once the user acts, the history bootstrap must not switch conversations under them. */
  const userInteractedRef = useRef(false);

  // "Add to chat" from the editor panes: queue a chip on the composer.
  // Attaching doesn't switch conversations, so the history bootstrap may
  // still resume the latest thread underneath — the chips ride along.
  useImperativeHandle(ref, () => ({
    addContext: (contextRef: ChatContextRef) => {
      setShowHistory(false);
      setPendingContext((current) => {
        // references have their own, tighter cap — they don't crowd out selections
        if (current.filter((ref) => !isReferenceRef(ref)).length >= MAX_CONTEXT_REFS) return current;
        const key = JSON.stringify(contextRef);
        if (current.some((existing) => JSON.stringify(existing) === key)) return current;
        return [...current, contextRef];
      });
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }), []);

  /** Switch to a conversation and load its messages (empty for a fresh one). */
  const loadConversation = useCallback(async (id: string) => {
    activeConversationRef.current = id;
    setConversationId(id);
    setMessages(null);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content, interaction, context")
      .match({ project_id: projectId, user_id: user?.id ?? "", page_slug: pageSlug, conversation_id: id })
      .order("created_at", { ascending: true })
      .limit(100);
    if (activeConversationRef.current !== id) return;
    setMessages((data ?? []) as ChatMessage[]);
  }, [projectId, pageSlug]);

  // On first expand: list this page's conversations and resume the latest one.
  useEffect(() => {
    if (collapsed || historyLoaded) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("conversation_id, content, created_at")
        .match({ project_id: projectId, user_id: user?.id ?? "", page_slug: pageSlug, role: "user" })
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setHistoryLoaded(true);
      if (error) {
        console.error("chat history load failed", error);
        if (!userInteractedRef.current) setMessages([]);
        return;
      }
      // newest user message per conversation → thread list, newest first
      const seen = new Set<string>();
      const recent = (data ?? []).flatMap((row: { conversation_id: string; content: string }) => {
        if (seen.has(row.conversation_id)) return [];
        seen.add(row.conversation_id);
        return [{ id: row.conversation_id, title: row.content.replace(/\s+/g, " ").trim() || "New conversation" }];
      });
      // merge, don't overwrite: a thread the user just started optimistically
      // may not be in this (earlier-issued) query's rows yet
      setThreads((current) => {
        const known = new Set(recent.map((thread) => thread.id));
        return [...current.filter((thread) => !known.has(thread.id)), ...recent];
      });
      if (userInteractedRef.current) return;
      if (recent[0]) void loadConversation(recent[0].id);
      else setMessages([]);
    })();
    return () => { cancelled = true; };
  }, [projectId, pageSlug, collapsed, historyLoaded, loadConversation]);

  const selectConversation = (id: string) => {
    setShowHistory(false);
    if (id === conversationId) return;
    userInteractedRef.current = true;
    setDraft("");
    setPendingContext([]);
    setAttachError(null);
    void loadConversation(id);
  };

  const startNewConversation = () => {
    if (busy) return;
    userInteractedRef.current = true;
    const id = createConversationId();
    activeConversationRef.current = id;
    setConversationId(id);
    setMessages([]);
    setDraft("");
    setPendingContext([]);
    setError(null);
    setAttachError(null);
    setShowHistory(false);
    stickToBottomRef.current = true;
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // ---- reference material --------------------------------------------------
  // An attachment resolves server-side into whatever the model can read and
  // comes back as a small descriptor; the bytes live in the user's draft, so
  // nothing heavy ever sits in React state or in the transcript.
  const referenceCount = pendingContext.filter(isReferenceRef).length;

  const runAttach = useCallback(
    async (task: () => Promise<ReferenceContextRef>) => {
      if (referenceCount >= MAX_REFERENCE_REFS) {
        setAttachError(`Up to ${MAX_REFERENCE_REFS} references per message.`);
        return;
      }
      // the reference is stored under this conversation — once one is in
      // flight, the history bootstrap must not switch threads underneath it
      userInteractedRef.current = true;
      const conversation = activeConversationRef.current;
      setAttachError(null);
      setAttachProgress(0);
      setAttaching((count) => count + 1);
      try {
        const reference = await task();
        if (activeConversationRef.current !== conversation) return;
        setPendingContext((current) => [...current, reference]);
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : "Couldn't attach that.");
      } finally {
        setAttaching((count) => count - 1);
      }
    },
    [referenceCount],
  );

  const attachTarget = { projectId, pageSlug, conversationId };
  const handleAttachFile = (file: File) =>
    void runAttach(() => attachFile(attachTarget, file, setAttachProgress));
  const handleAttachUrl = (url: string) => void runAttach(() => attachUrl(attachTarget, url));

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickToBottomRef.current = true;
    setShowJump(false);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, []);

  useLayoutEffect(() => {
    if (stickToBottomRef.current) scrollToBottom("auto");
  }, [messages, live, busy, scrollToBottom]);

  useEffect(() => {
    if (!collapsed && !busy && !showHistory) textareaRef.current?.focus();
  }, [collapsed, busy, showHistory]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  const send = useCallback(async (text: string, context?: ChatContextRef[]) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const refs = context?.length ? context : undefined;
    lastSendRef.current = { prompt, context: refs };
    setDraft("");
    setPendingContext([]);
    setBusy(true);
    setError(null);
    setAttachError(null);
    userInteractedRef.current = true;
    setThreads((current) => current.some((thread) => thread.id === conversationId)
      ? current
      : [{ id: conversationId, title: prompt }, ...current]);
    stickToBottomRef.current = true;
    setMessages((current) => [...(current ?? []), { role: "user", content: prompt, context: refs ?? null }]);
    setLive({ text: "", activity: null });
    try {
      const res = await fetch(`/projects/${projectId}/pages/${pageSlug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, conversationId, context: refs }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
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
      setError("Something went wrong. Please try again.");
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
        case "interaction":
          setLive(null);
          break;
        case "done":
          setMessages((current) => [
            ...(current ?? []),
            { role: "assistant", content: event.reply, interaction: event.interaction },
          ]);
          if (event.mutated) onMutated();
          break;
        case "error":
          setError(event.error);
          break;
      }
    }
  }, [projectId, pageSlug, conversationId, busy, onLiveMutation, onMutated]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft, pendingContext);
    }
  };

  const copyMessage = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => current === index ? null : current), 1600);
    } catch {
      setError("Could not copy that response.");
    }
  };

  const hasConversation = (messages?.length ?? 0) > 0 || busy;
  const canSend = draft.trim().length > 0 && !busy;

  const updateDraft = (value: string) => {
    setDraft(value.slice(0, 4000));
  };

  return (
    <SidePanel
      label="Assistant"
      title="Assistant"
      badge={busy ? <span className="font-normal text-ink-tertiary">Working…</span> : "🐕"}
      icon={<SparklesIcon />}
      active={busy}
      collapsed={collapsed}
      onToggle={onToggle}
      actions={
        <>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={busy}
            aria-label="New chat"
            title="New chat"
            className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            onClick={() => setShowHistory((visible) => !visible)}
            disabled={busy || threads.length === 0}
            aria-label="Chat history"
            aria-expanded={showHistory}
            title="Chat history"
            className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <HistoryIcon />
          </button>
        </>
      }
    >
      {showHistory ? (
        <HistoryView
          threads={threads}
          activeId={conversationId}
          onBack={() => setShowHistory(false)}
          onSelect={selectConversation}
        />
      ) : (
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files") || busy) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(false);
            const file = droppedFile(event.dataTransfer);
            if (file) handleAttachFile(file);
          }}
        >
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto overscroll-contain px-4 py-5"
            onScroll={(event) => {
              const el = event.currentTarget;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              stickToBottomRef.current = nearBottom;
              setShowJump(!nearBottom && hasConversation);
            }}
          >
            {messages === null ? <LoadingConversation /> : !hasConversation ? (
              <EmptyConversation onSelect={setDraft} />
            ) : (
              <div className="space-y-6 pb-2" aria-live="polite">
                {messages.map((message, index) => (
                  <Message
                    key={`${message.role}-${index}`}
                    message={message}
                    copied={copiedIndex === index}
                    interactionPending={
                      message.role === "assistant" &&
                      message.interaction != null &&
                      !messages.slice(index + 1).some((next) => next.role === "user")
                    }
                    onChoose={(option) => void send(`I choose “${option.label}”: ${option.description}`)}
                    onCopy={() => void copyMessage(message.content, index)}
                  />
                ))}
                {busy && <LiveMessage live={live} />}
                {error && (
                  <ErrorMessage
                    message={error}
                    onRetry={lastSendRef.current ? () => {
                      const last = lastSendRef.current;
                      if (last) void send(last.prompt, last.context);
                    } : undefined}
                  />
                )}
              </div>
            )}
          </div>
          {showJump && (
            <button type="button" onClick={() => scrollToBottom()} aria-label="Jump to latest message" title="Jump to latest" className="absolute bottom-3 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface text-ink-secondary shadow-raised transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <ArrowDownIcon />
            </button>
          )}
        </div>

        <form className="border-t border-border bg-surface px-3 pb-3 pt-2.5" onSubmit={(event) => { event.preventDefault(); void send(draft, pendingContext); }}>
          <div className="rounded-xl border border-border-strong bg-bg px-3 pb-2.5 pt-3 shadow-soft transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-raised">
            {pendingContext.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached context and references">
                {pendingContext.map((contextRef, index) => (
                  <ContextChip
                    key={`${contextRefLabel(contextRef)}-${index}`}
                    contextRef={contextRef}
                    onRemove={() => setPendingContext((current) => current.filter((_, i) => i !== index))}
                  />
                ))}
              </div>
            )}
            {attachError && (
              <p role="alert" className="mb-2 text-[11px] leading-4 text-danger">
                {attachError}
              </p>
            )}
            <textarea
              ref={textareaRef}
              name="message"
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={(event) => {
                const file = droppedFile(event.clipboardData);
                if (!file) return; // plain text paste falls through to the textarea
                event.preventDefault();
                handleAttachFile(file);
              }}
              placeholder="Ask the assistant to edit this page…"
              aria-label="Message the assistant"
              disabled={busy}
              autoComplete="off"
              rows={1}
              className="block max-h-40 min-h-6 w-full resize-none overflow-y-auto bg-transparent text-sm leading-6 text-ink outline-none placeholder:text-ink-tertiary disabled:cursor-not-allowed"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <AttachReferenceButton
                  disabled={busy || referenceCount >= MAX_REFERENCE_REFS}
                  busy={attaching > 0}
                  onAttachFile={handleAttachFile}
                  onAttachUrl={handleAttachUrl}
                />
                <span className="truncate text-[11px] text-ink-tertiary">
                  {attaching > 0
                    ? attachProgress > 0 && attachProgress < 1
                      ? `Uploading… ${Math.round(attachProgress * 100)}%`
                      : "Attaching…"
                    : busy
                      ? "Assistant is working"
                      : draft.length > 3600
                        ? `${draft.length}/4000`
                        : "Enter to send · Shift + Enter for line break"}
                </span>
              </div>
              <button type="submit" disabled={!canSend} aria-label={busy ? "Assistant is working" : "Send"} title="Send message" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-[background-color,transform] hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <ArrowUpIcon />
              </button>
            </div>
          </div>
          <p className="mt-2 px-1 text-center text-[10px] leading-4 text-ink-tertiary">Changes are saved as versions in your private draft.</p>
        </form>

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-bg/85 text-center backdrop-blur-sm">
            <span className="text-sm font-medium text-ink">Drop to attach</span>
            <span className="text-xs text-ink-secondary">An image or PDF to build from</span>
          </div>
        )}
        </div>
      )}
    </SidePanel>
  );
}

/** Full-panel list of this page's conversations; the chevron returns without switching. */
function HistoryView({
  threads,
  activeId,
  onBack,
  onSelect,
}: {
  threads: ChatThread[];
  activeId: string | null;
  onBack: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => { if (event.key === "Escape") onBack(); }}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversation"
          title="Back to conversation"
          className="flex size-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronLeftIcon />
        </button>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">Recent chats</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => onSelect(thread.id)}
            aria-current={thread.id === activeId ? "page" : undefined}
            className="block w-full truncate rounded-lg px-2.5 py-2.5 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {thread.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyConversation({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="flex min-h-full flex-col justify-center py-6">
      <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <SparklesIcon className="size-5" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-ink">What should we create?</h3>
      <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
        I can write copy, restructure sections, and design the wireframe alongside you.
      </p>
      <div className="mt-5 space-y-2">
        {STARTERS.map((starter) => (
          <button
            key={starter.label}
            type="button"
            onClick={() => onSelect(starter.prompt)}
            className="group flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm text-ink-secondary transition-[background-color,border-color,color] hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {starter.label}
            <span aria-hidden className="text-ink-tertiary transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({
  message,
  copied,
  interactionPending,
  onChoose,
  onCopy,
}: {
  message: ChatMessage;
  copied: boolean;
  interactionPending: boolean;
  onChoose: (option: ChatInteraction["options"][number]) => void;
  onCopy: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {(message.context?.length ?? 0) > 0 && (
          <div className="flex max-w-[88%] flex-wrap justify-end gap-1" aria-label="Attached context and references">
            {message.context!.map((contextRef, index) => (
              <ContextChip key={`${contextRefLabel(contextRef)}-${index}`} contextRef={contextRef} />
            ))}
          </div>
        )}
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2.5 text-sm leading-6 text-ink">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group/message">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent">
          <SparklesIcon className="size-3.5" />
        </span>
        <span className="text-xs font-medium text-ink">Assistant</span>
      </div>
      <AssistantMarkdown markdown={message.content} />
      {message.interaction && <InteractionCard interaction={message.interaction} pending={interactionPending} onChoose={onChoose} />}
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied response" : "Copy response"}
        title={copied ? "Copied" : "Copy response"}
        className="mt-1.5 flex size-7 items-center justify-center rounded-md text-ink-tertiary opacity-0 transition-[opacity,background-color,color] hover:bg-surface-hover hover:text-ink group-hover/message:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function InteractionCard({
  interaction,
  pending,
  onChoose,
}: {
  interaction: ChatInteraction;
  pending: boolean;
  onChoose: (option: ChatInteraction["options"][number]) => void;
}) {
  switch (interaction.type) {
    case "choice":
      return (
        <section aria-label="Assistant choice" className="mt-4 rounded-xl border border-border bg-surface p-3 shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">Choose a direction</p>
          <h4 className="mt-1.5 text-sm font-semibold leading-5 text-ink">{interaction.question}</h4>
          <div className="mt-3 space-y-2">
            {interaction.options.map((option, index) => (
              <button
                key={option.label}
                type="button"
                disabled={!pending}
                onClick={() => onChoose(option)}
                className="group flex w-full gap-3 rounded-lg border border-border bg-bg p-3 text-left transition-[border-color,background-color,box-shadow] hover:border-accent hover:bg-accent-soft/50 hover:shadow-soft disabled:cursor-default disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-[10px] font-semibold text-ink-tertiary transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-accent-fg">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-secondary">{option.description}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-tertiary">{pending ? "Choose one to continue." : "Choice submitted."}</p>
        </section>
      );
  }
}

/**
 * One attachment as a pill: icon, name, and — for a page selection — the
 * snippet it carries. The raw text lives in the tooltip; the serialized
 * prompt never shows in the UI. References look distinct from selections
 * because they mean something different: outside material, not this page.
 */
function ContextChip({ contextRef, onRemove }: { contextRef: ChatContextRef; onRemove?: () => void }) {
  const label = contextRefLabel(contextRef);
  const reference = isReferenceRef(contextRef) ? contextRef : null;
  const snippet = contextRef.kind === "page" ? contextRef.text?.replace(/\s+/g, " ").trim() ?? null : null;
  return (
    <span
      title={reference ? reference.sourceUrl ?? reference.label : snippet ?? "Whole section"}
      className={`inline-flex h-6 max-w-56 items-center gap-1.5 rounded-md border pl-1.5 text-[11px] shadow-soft ${
        reference ? "border-accent/30 bg-accent-soft text-ink-secondary" : "border-border bg-surface text-ink-secondary"
      } ${onRemove ? "pr-1" : "pr-1.5"}`}
    >
      <span aria-hidden className={`shrink-0 ${reference ? "text-accent" : "text-ink-tertiary"}`}>
        {reference ? (
          <ReferenceMediaIcon media={reference.media} className="size-3" />
        ) : snippet === null ? (
          <WireframeModeIcon className="size-3" />
        ) : (
          <TextLinesIcon className="size-3" />
        )}
      </span>
      <span className="truncate">
        <span className="font-medium text-ink">{label}</span>
        {snippet && <span className="text-ink-tertiary"> · {snippet}</span>}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove attached context: ${label}`}
          title="Remove"
          className="flex size-4 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

function LiveMessage({ live }: { live: LiveTurn | null }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent">
          <SparklesIcon className="size-3.5 animate-pulse" />
        </span>
        <span className="text-xs font-medium text-ink">Assistant</span>
      </div>
      {live?.text && <AssistantMarkdown markdown={live.text} />}
      <ThinkingStatus live={live} />
    </div>
  );
}

/**
 * What the dog is up to while you wait. A real tool label ("Designing
 * hero…") always wins — it's information. Only the two generic states get
 * the playful treatment, and the shimmer makes a slow turn read as alive
 * rather than stuck. Screen readers hear the stable line, not the churn.
 */
function ThinkingStatus({ live }: { live: LiveTurn | null }) {
  const label = live?.activity ?? (live?.text ? "Writing" : null);
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs" role="status">
      <span className="sr-only">{live?.activity ?? "Assistant is working"}</span>
      <PawIcon className="thinking-bob size-3.5 shrink-0 text-accent" aria-hidden />
      <span aria-hidden className="thinking-shimmer font-medium">
        {label ?? <CyclingWord />}…
      </span>
      <ElapsedTime />
    </div>
  );
}

/** Idle-thinking verbs. A dog that fetches things, mostly. */
const THINKING_WORDS = [
  "Thinking",
  "Sniffing around",
  "Fetching",
  "Noodling",
  "Digging in",
  "Chewing it over",
  "Pondering",
  "Rummaging",
  "Following the scent",
  "Mulling",
  "Nosing about",
  "Scheming",
];

function CyclingWord() {
  // a random entry point so back-to-back turns don't open the same way
  const [index, setIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  useEffect(() => {
    const id = window.setInterval(() => setIndex((current) => (current + 1) % THINKING_WORDS.length), 2600);
    return () => window.clearInterval(id);
  }, []);
  return <>{THINKING_WORDS[index]}</>;
}

/** Appears once a turn is slow enough that you'd start to wonder. */
function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (seconds < 4) return null;
  return (
    <span aria-hidden className="tabular-nums text-ink-tertiary/70">
      {seconds}s
    </span>
  );
}

function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-xs leading-5 text-danger">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger">
          Try again
        </button>
      )}
    </div>
  );
}

function LoadingConversation() {
  return (
    <div className="space-y-6 py-2" aria-label="Loading conversation">
      <div className="ml-auto h-14 w-4/5 animate-pulse rounded-2xl rounded-br-md bg-accent-soft" />
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-surface-hover" />
      </div>
    </div>
  );
}
