"use client";

import { useCallback, useEffect, useState } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListNode, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";

import type { BlockType, HeadingLevel } from "@/lib/copy/blocks";
import { BLOCK_TYPE_LABELS, headingLevels } from "@/lib/copy/blocks";

import { $touchedBlockNodes } from "../doc-structure";
import { $createButtonNode, $isButtonNode } from "../nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode } from "../nodes/eyebrow-node";
import { $isSectionNode } from "../nodes/section-node";

/**
 * The floating toolbar above a text selection: inline marks, turn-into,
 * and — when the selection touches more than one block — "Group into
 * section", the reorganization move this editor is built around.
 */
export function SelectionToolbarPlugin({ onGroup }: { onGroup: () => string | null }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<{
    top: number;
    left: number;
    blockType: BlockType;
    blockCount: number;
    spansSections: boolean;
  } | null>(null);

  const refresh = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setState(null);
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

      const blocks = $touchedBlockNodes(selection.getNodes());
      const sections = new Set(blocks.map((b) => b.getParent()).filter($isSectionNode).map((s) => s.getKey()));

      const anchorBlock = blocks[0];
      let blockType: BlockType = "p";
      if (anchorBlock) {
        if ($isHeadingNode(anchorBlock)) blockType = anchorBlock.getTag() as HeadingLevel;
        else if ($isEyebrowNode(anchorBlock)) blockType = "eyebrow";
        else if ($isButtonNode(anchorBlock)) blockType = "button";
        else if ($isListNode(anchorBlock)) blockType = "bullets";
      }

      setState({
        top: rect.top - wrapperRect.top - 44,
        left: Math.max(0, rect.left - wrapperRect.left),
        blockType,
        blockCount: blocks.length,
        spansSections: sections.size > 1,
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
    (type: BlockType) => {
      if (type === "bullets") {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        return;
      }
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchor = $touchedBlockNodes(selection.getNodes())[0];
        if (anchor && $isListNode(anchor)) {
          editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        }
        if (headingLevels.includes(type as HeadingLevel)) {
          $setBlocksType(selection, () => $createHeadingNode(type as HeadingLevel));
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

  if (!state) return null;

  return (
    <div
      role="toolbar"
      aria-label="Selection tools"
      className="absolute z-20 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-raised"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(e) => e.preventDefault() /* keep the text selection */}
    >
      <MarkButton label="Bold" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}>
        <span className="font-bold">B</span>
      </MarkButton>
      <MarkButton label="Italic" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}>
        <span className="italic">i</span>
      </MarkButton>
      <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <TurnIntoMenu blockType={state.blockType} onApply={applyBlockType} />
      {state.blockCount > 1 && (
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
  );
}

/**
 * Turn-into as a custom dropdown: a native <select> can't open under the
 * toolbar's mousedown-preventDefault (which is what preserves the text
 * selection), and taking focus would drop the selection anyway. This menu
 * never takes focus — the selection survives, the conversion applies.
 */
function TurnIntoMenu({ blockType, onApply }: { blockType: BlockType; onApply: (type: BlockType) => void }) {
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
        {BLOCK_TYPE_LABELS[blockType]}
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Block types"
          className="absolute left-0 top-8 z-30 w-40 rounded-lg border border-border bg-surface p-1 shadow-raised"
        >
          {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((type) => (
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
              {BLOCK_TYPE_LABELS[type]}
              {type === blockType && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
    >
      {children}
    </button>
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
