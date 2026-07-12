"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ListItemNode, ListNode, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, $isListNode } from "@lexical/list";
import { HEADING, UNORDERED_LIST, registerMarkdownShortcuts } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";

import type { Block, BlockType, HeadingLevel } from "@/lib/copy/blocks";
import { BLOCK_TYPE_LABELS, headingLevels } from "@/lib/copy/blocks";
import { serializeBlocks } from "@/lib/copy/markdown";

import { $extractBlocks, $populateFromBlocks } from "./lexical-blocks";
import { $createButtonNode, $isButtonNode, ButtonNode } from "./nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode, EyebrowNode } from "./nodes/eyebrow-node";

export interface SectionEditorProps {
  initialBlocks: Block[];
  /** Fires with the section's canonical markdown after every edit. */
  onMarkdownChange: (markdown: string) => void;
  placeholder?: string;
  /** Focus the end of the content on mount (used after auto-splits). */
  autoFocus?: boolean;
}

export function SectionEditor({ initialBlocks, onMarkdownChange, placeholder, autoFocus }: SectionEditorProps) {
  const initialConfig = {
    namespace: "copydog-section",
    theme: {
      heading: { h1: "editor-h1", h2: "editor-h2", h3: "editor-h3", h4: "editor-h4", h5: "editor-h5", h6: "editor-h6" },
      paragraph: "editor-p",
      list: { ul: "editor-ul", listitem: "editor-li" },
      text: { bold: "font-semibold", italic: "italic", code: "editor-code" },
    },
    nodes: [HeadingNode, ListNode, ListItemNode, EyebrowNode, ButtonNode],
    editorState: () => $populateFromBlocks(initialBlocks),
    onError: (error: Error) => {
      throw error;
    },
  };

  // seeded with the initial content so mounting doesn't trigger a save
  const lastMarkdown = useRef<string | null>(serializeBlocks(initialBlocks));

  const handleChange = useCallback(
    (editorState: EditorState) => {
      const markdown = serializeBlocks(editorState.read($extractBlocks));
      if (markdown !== lastMarkdown.current) {
        lastMarkdown.current = markdown;
        onMarkdownChange(markdown);
      }
    },
    [onMarkdownChange],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="copy-editor relative">
        <BlockTypeBar />
        <RichTextPlugin
          contentEditable={<ContentEditable className="outline-none" aria-label="Section copy" />}
          placeholder={
            <p className="pointer-events-none absolute left-0 top-10 text-ink-tertiary">
              {placeholder ?? "Write your copy — # for a heading, - for a list…"}
            </p>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutsPlugin />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        {autoFocus && <AutoFocusPlugin />}
      </div>
    </LexicalComposer>
  );
}

function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.focus(undefined, { defaultSelection: "rootEnd" });
  }, [editor]);
  return null;
}

function MarkdownShortcutsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerMarkdownShortcuts(editor, [HEADING, UNORDERED_LIST]), [editor]);
  return null;
}

/**
 * The "Turn into" control — a quiet select that names the block under the
 * caret and converts it in place.
 */
function BlockTypeBar() {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<BlockType>("p");

  useEffect(() => {
    const readBlockType = () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const element = selection.anchor.getNode().getTopLevelElement();
      if (!element) return;
      if ($isHeadingNode(element)) setBlockType(element.getTag() as HeadingLevel);
      else if ($isEyebrowNode(element)) setBlockType("eyebrow");
      else if ($isButtonNode(element)) setBlockType("button");
      else if ($isListNode(element)) setBlockType("bullets");
      else setBlockType("p");
      return;
    };
    const unregisterCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        readBlockType();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(readBlockType);
    });
    return () => {
      unregisterCommand();
      unregisterListener();
    };
  }, [editor]);

  const applyBlockType = useCallback(
    (type: BlockType) => {
      setBlockTypeInEditor(editor, type);
      setBlockType(type);
    },
    [editor],
  );

  return (
    <div className="mb-2 flex items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 [.copy-editor:focus-within_&]:opacity-100">
      <select
        value={blockType}
        onChange={(event) => applyBlockType(event.target.value as BlockType)}
        onMouseDown={(event) => event.stopPropagation()}
        className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-ink-secondary focus:outline-2 focus:outline-accent"
        aria-label="Block type"
      >
        {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((type) => (
          <option key={type} value={type}>
            {BLOCK_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    </div>
  );
}

function setBlockTypeInEditor(editor: LexicalEditor, type: BlockType) {
  if (type === "bullets") {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    return;
  }
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    const element = selection.anchor.getNode().getTopLevelElement();
    if ($isListNode(element)) {
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
}
