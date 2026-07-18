"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";

import type { ElementType, HeadingLevel } from "@/lib/copy/elements";
import { ELEMENT_TYPE_LABELS, headingLevels } from "@/lib/copy/elements";
import type { PageLinkOption } from "@/lib/content/site";

import { $touchedElementNodes } from "../doc-structure";
import { $createButtonNode, $isButtonNode } from "../nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode } from "../nodes/eyebrow-node";
import { AddToChatIcon, ChevronDownIcon, LinkIcon } from "@/components/ui/icons";

import { $isSectionNode } from "../nodes/section-node";

/**
 * The floating toolbar above a text selection: inline marks, a link,
 * quick element types (H1–H3, quote), the full turn-into menu,
 * "Group into section", and "Add to chat" (attach the selection as
 * assistant context).
 */
type LinkSuggestion =
  | { kind: "page"; key: string; href: string; title: string; detail: string }
  | { kind: "url"; key: string; href: string; title: string; detail: string };

/** A text selection captured for the assistant: what and where. */
export interface SelectionForChat {
  sectionSlug: string | null;
  text: string;
}

export function SelectionToolbarPlugin({
  linkPages,
  onGroup,
  onAddToChat,
}: {
  linkPages: PageLinkOption[];
  onGroup: () => string | null;
  onAddToChat?: (selection: SelectionForChat) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<{
    top: number;
    left: number;
    elementType: ElementType;
    elementCount: number;
    hasLink: boolean;
  } | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [activeLinkSuggestion, setActiveLinkSuggestion] = useState(-1);

  const refresh = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setState(null);
        setLinkDraft(null);
        return;
      }
      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.rangeCount === 0) {
        setState(null);
        return;
      }
      const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
      const rootEl = editor.getRootElement();
      const wrapper = rootEl?.parentElement;
      if (!wrapper || rect.width === 0) {
        setState(null);
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();

      const touched = $touchedElementNodes(selection.getNodes());
      const hasLink = selection
        .getNodes()
        .some((node) => $isLinkNode(node) || $isLinkNode(node.getParent()));

      const anchorElement = touched[0];
      let elementType: ElementType = "p";
      if (anchorElement) {
        if ($isHeadingNode(anchorElement)) elementType = anchorElement.getTag() as HeadingLevel;
        else if ($isQuoteNode(anchorElement)) elementType = "quote";
        else if ($isEyebrowNode(anchorElement)) elementType = "eyebrow";
        else if ($isButtonNode(anchorElement)) elementType = "button";
        else if ($isListNode(anchorElement)) elementType = anchorElement.getListType() === "number" ? "numbered" : "bullets";
      }

      setState({
        top: rect.top - wrapperRect.top - 44,
        left: Math.max(0, rect.left - wrapperRect.left),
        elementType,
        elementCount: touched.length,
        hasLink,
      });
    });
  }, [editor]);

  useEffect(() => {
    const unregisterCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        refresh();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUpdate = editor.registerUpdateListener(() => refresh());
    return () => {
      unregisterCommand();
      unregisterUpdate();
    };
  }, [editor, refresh]);

  const applyElementType = useCallback(
    (type: ElementType) => {
      if (type === "bullets" || type === "numbered") {
        editor.dispatchCommand(type === "numbered" ? INSERT_ORDERED_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined);
        return;
      }
      editor.update(() => {
        const initial = $getSelection();
        if (!$isRangeSelection(initial)) return;
        const anchor = $touchedElementNodes(initial.getNodes())[0];
        if (anchor && $isListNode(anchor)) {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        }
        // re-read: removing the list rebuilt the nodes under the selection
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (headingLevels.includes(type as HeadingLevel)) {
          $setBlocksType(selection, () => $createHeadingNode(type as HeadingLevel));
        } else if (type === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
        } else if (type === "eyebrow") {
          $setBlocksType(selection, () => $createEyebrowNode());
        } else if (type === "button") {
          $setBlocksType(selection, () => $createButtonNode());
        } else {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
    },
    [editor],
  );

  const toggleLink = useCallback(() => {
    if (state?.hasLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      setLinkDraft(null);
    } else {
      setActiveLinkSuggestion(-1);
      setLinkDraft((draft) => (draft === null ? "" : null));
    }
  }, [editor, state?.hasLink]);

  const applyLink = useCallback(
    (url: string) => {
      const target = url.trim();
      if (target) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, target);
      }
      setLinkDraft(null);
      editor.focus();
    },
    [editor],
  );

  const addSelectionToChat = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      const text = selection.getTextContent().trim();
      if (!text) return;
      // the section containing the selection's anchor (a cross-section
      // selection attaches under the section it started in)
      let sectionSlug: string | null = null;
      for (let node = selection.anchor.getNode().getParent(); node; node = node.getParent()) {
        if ($isSectionNode(node)) {
          sectionSlug = node.getSlug();
          break;
        }
      }
      onAddToChat?.({ sectionSlug, text });
    });
  }, [editor, onAddToChat]);

  const linkSuggestions = useMemo(
    () => (linkDraft === null ? [] : buildLinkSuggestions(linkPages, linkDraft)),
    [linkDraft, linkPages],
  );

  const chooseLinkSuggestion = useCallback(
    (suggestion: LinkSuggestion) => {
      applyLink(suggestion.href);
    },
    [applyLink],
  );

  if (!state) return null;

  return (
    <div
      role="toolbar"
      aria-label="Selection tools"
      className="absolute z-20 rounded-lg border border-border bg-surface shadow-raised"
      style={{ top: state.top, left: state.left }}
      // keep the text selection — but let the link input take focus
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
      }}
    >
      <div className="flex items-center gap-0.5 p-1">
        <MarkButton label="Bold" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}>
          <span className="font-bold">B</span>
        </MarkButton>
        <MarkButton label="Italic" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}>
          <span className="italic">i</span>
        </MarkButton>
        <MarkButton label={state.hasLink ? "Remove link" : "Link"} active={state.hasLink || linkDraft !== null} onClick={toggleLink}>
          <LinkIcon />
        </MarkButton>
        <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        {(["h1", "h2", "h3"] as const).map((level) => (
          <MarkButton
            key={level}
            label={ELEMENT_TYPE_LABELS[level]}
            active={state.elementType === level}
            onClick={() => applyElementType(state.elementType === level ? "p" : level)}
          >
            <span className="text-[11px] font-semibold uppercase">{level}</span>
          </MarkButton>
        ))}
        <MarkButton
          label="Quote"
          active={state.elementType === "quote"}
          onClick={() => applyElementType(state.elementType === "quote" ? "p" : "quote")}
        >
          <QuoteIcon />
        </MarkButton>
        <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <TurnIntoMenu elementType={state.elementType} onApply={applyElementType} />
        {state.elementCount >= 1 && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <button
              type="button"
              onClick={onGroup}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              <GroupIcon />
              Group into section
            </button>
          </>
        )}
        {onAddToChat && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            <button
              type="button"
              onClick={addSelectionToChat}
              title="Attach this selection as assistant context"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent transition-colors hover:bg-accent-soft"
            >
              <AddToChatIcon className="size-3.5" />
              Add to chat
            </button>
          </>
        )}
      </div>

      {linkDraft !== null && (
        <div className="w-80 border-t border-border p-1.5">
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={linkSuggestions.length > 0}
            aria-controls="link-destination-suggestions"
            aria-activedescendant={
              activeLinkSuggestion >= 0 ? `link-destination-${activeLinkSuggestion}` : undefined
            }
            placeholder="Search pages or paste an http URL…"
            aria-label="Link URL"
            value={linkDraft}
            onChange={(e) => {
              setLinkDraft(e.currentTarget.value);
              setActiveLinkSuggestion(e.currentTarget.value.trim() ? 0 : -1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && linkSuggestions.length > 0) {
                e.preventDefault();
                setActiveLinkSuggestion((index) => (index + 1) % linkSuggestions.length);
                return;
              }
              if (e.key === "ArrowUp" && linkSuggestions.length > 0) {
                e.preventDefault();
                setActiveLinkSuggestion((index) =>
                  index <= 0 ? linkSuggestions.length - 1 : index - 1,
                );
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const suggestion = linkSuggestions[activeLinkSuggestion];
                if (suggestion) chooseLinkSuggestion(suggestion);
                else applyLink(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                setLinkDraft(null);
                editor.focus();
              }
            }}
            className="h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
          />
          {linkSuggestions.length > 0 && (
            <div
              id="link-destination-suggestions"
              role="listbox"
              aria-label="Link destinations"
              className="mt-1 max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-soft"
            >
              {linkSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  id={`link-destination-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeLinkSuggestion}
                  onMouseEnter={() => setActiveLinkSuggestion(index)}
                  onClick={() => chooseLinkSuggestion(suggestion)}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors ${
                    index === activeLinkSuggestion ? "bg-accent-soft" : "hover:bg-surface-hover"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">{suggestion.title}</span>
                    <span className="block truncate text-[11px] text-ink-tertiary">{suggestion.detail}</span>
                  </span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-tertiary">
                    {suggestion.kind === "page" ? "Page" : "URL"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Project-page matches plus an exact HTTP(S) destination when one is entered. */
export function buildLinkSuggestions(pages: PageLinkOption[], draft: string): LinkSuggestion[] {
  const query = draft.trim().toLocaleLowerCase();
  const pageSuggestions = pages
    .filter((page) => {
      if (!query) return true;
      return (
        page.title.toLocaleLowerCase().includes(query) ||
        page.breadcrumbs.join(" / ").toLocaleLowerCase().includes(query) ||
        page.href.toLocaleLowerCase().includes(query)
      );
    })
    .slice(0, 7)
    .map(
      (page): LinkSuggestion => ({
        kind: "page",
        key: `page:${page.slug}`,
        href: page.href,
        title: page.title,
        detail: `${page.breadcrumbs.join(" / ")} · ${page.href}`,
      }),
    );

  const httpUrl = normalizeHttpUrl(draft);
  const urlSuggestion: LinkSuggestion[] = httpUrl
    ? [{ kind: "url", key: `url:${httpUrl}`, href: httpUrl, title: httpUrl, detail: "External web address" }]
    : [];

  return httpUrl ? [...urlSuggestion, ...pageSuggestions].slice(0, 8) : pageSuggestions;
}

function normalizeHttpUrl(value: string): string | null {
  const target = value.trim();
  if (!/^https?:\/\//i.test(target)) return null;
  try {
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? target : null;
  } catch {
    return null;
  }
}

/**
 * Turn-into as a custom dropdown: a native <select> can't open under the
 * toolbar's mousedown-preventDefault (which is what preserves the text
 * selection), and taking focus would drop the selection anyway. This menu
 * never takes focus — the selection survives, the conversion applies.
 */
function TurnIntoMenu({ elementType, onApply }: { elementType: ElementType; onApply: (type: ElementType) => void }) {
  const [open, setOpen] = useState(false);

  // the toolbar unmounts whenever the selection changes, so `open` state
  // cleans itself up naturally
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Turn into"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
      >
        {ELEMENT_TYPE_LABELS[elementType]}
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Element types"
          className="absolute left-0 top-8 z-30 w-40 rounded-lg border border-border bg-surface p-1 shadow-raised"
        >
          {(Object.keys(ELEMENT_TYPE_LABELS) as ElementType[]).map((type) => (
            <button
              key={type}
              type="button"
              role="option"
              aria-selected={type === elementType}
              onClick={() => {
                setOpen(false);
                if (type !== elementType) onApply(type);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              {ELEMENT_TYPE_LABELS[type]}
              {type === elementType && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-md text-sm transition-colors hover:bg-surface-hover hover:text-ink ${
        active ? "bg-accent-soft text-accent" : "text-ink-secondary"
      }`}
    >
      {children}
    </button>
  );
}


function QuoteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
      <path d="M3 9.5c0-2.6 1.5-4.6 3.8-5.5l.5 1c-1.4.7-2.2 1.7-2.4 2.8.2-.1.5-.15.8-.15 1 0 1.8.8 1.8 1.85S6.7 11.5 5.6 11.5C4.1 11.5 3 10.7 3 9.5zm6 0c0-2.6 1.5-4.6 3.8-5.5l.5 1c-1.4.7-2.2 1.7-2.4 2.8.2-.1.5-.15.8-.15 1 0 1.8.8 1.8 1.85s-.8 2-1.9 2C10.1 11.5 9 10.7 9 9.5z" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeDasharray="3 2" />
      <path d="M5.5 8h5M8 5.5v5" strokeLinecap="round" />
    </svg>
  );
}
