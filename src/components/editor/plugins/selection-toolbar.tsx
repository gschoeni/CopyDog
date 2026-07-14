"use client";

import { useCallback, useEffect, useState } from "react";

import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
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

import { $touchedElementNodes } from "../doc-structure";
import { $createButtonNode, $isButtonNode } from "../nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode } from "../nodes/eyebrow-node";
import { $isSectionNode } from "../nodes/section-node";

/**
 * The floating toolbar above a text selection: inline marks, a link,
 * quick block types (H1–H3, quote), the full turn-into menu, and — when
 * the selection touches more than one block — "Group into section".
 */
export function SelectionToolbarPlugin({ onGroup }: { onGroup: () => string | null }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<{
    top: number;
    left: number;
    blockType: ElementType;
    elementCount: number;
    hasLink: boolean;
  } | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

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

      const anchorBlock = touched[0];
      let blockType: ElementType = "p";
      if (anchorBlock) {
        if ($isHeadingNode(anchorBlock)) blockType = anchorBlock.getTag() as HeadingLevel;
        else if ($isQuoteNode(anchorBlock)) blockType = "quote";
        else if ($isEyebrowNode(anchorBlock)) blockType = "eyebrow";
        else if ($isButtonNode(anchorBlock)) blockType = "button";
        else if ($isListNode(anchorBlock)) blockType = "bullets";
      }

      setState({
        top: rect.top - wrapperRect.top - 44,
        left: Math.max(0, rect.left - wrapperRect.left),
        blockType,
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

  const applyBlockType = useCallback(
    (type: ElementType) => {
      if (type === "bullets") {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        return;
      }
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchor = $touchedElementNodes(selection.getNodes())[0];
        if (anchor && $isListNode(anchor)) {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        }
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
            active={state.blockType === level}
            onClick={() => applyBlockType(state.blockType === level ? "p" : level)}
          >
            <span className="text-[11px] font-semibold uppercase">{level}</span>
          </MarkButton>
        ))}
        <MarkButton
          label="Quote"
          active={state.blockType === "quote"}
          onClick={() => applyBlockType(state.blockType === "quote" ? "p" : "quote")}
        >
          <QuoteIcon />
        </MarkButton>
        <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <TurnIntoMenu blockType={state.blockType} onApply={applyBlockType} />
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
      </div>

      {linkDraft !== null && (
        <div className="border-t border-border p-1.5">
          <input
            autoFocus
            type="url"
            placeholder="https://… (Enter to apply)"
            aria-label="Link URL"
            defaultValue={linkDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                setLinkDraft(null);
                editor.focus();
              }
            }}
            className="h-7 w-64 rounded-md border border-border bg-surface px-2 text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Turn-into as a custom dropdown: a native <select> can't open under the
 * toolbar's mousedown-preventDefault (which is what preserves the text
 * selection), and taking focus would drop the selection anyway. This menu
 * never takes focus — the selection survives, the conversion applies.
 */
function TurnIntoMenu({ blockType, onApply }: { blockType: ElementType; onApply: (type: ElementType) => void }) {
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
        {ELEMENT_TYPE_LABELS[blockType]}
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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
              aria-selected={type === blockType}
              onClick={() => {
                setOpen(false);
                if (type !== blockType) onApply(type);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              {ELEMENT_TYPE_LABELS[type]}
              {type === blockType && <span className="text-accent">✓</span>}
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

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M6.5 9.5l3-3" strokeLinecap="round" />
      <path d="M7.5 4.75L9 3.25a2.65 2.65 0 013.75 3.75L11.25 8.5" strokeLinecap="round" />
      <path d="M8.5 11.25L7 12.75a2.65 2.65 0 01-3.75-3.75L4.75 7.5" strokeLinecap="round" />
    </svg>
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
