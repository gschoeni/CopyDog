"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ListItemNode, ListNode } from "@lexical/list";
import { HEADING, UNORDERED_LIST, registerMarkdownShortcuts } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type EditorState,
  type LexicalEditor,
} from "lexical";

import type { Block } from "@/lib/copy/blocks";

import {
  $buildDocFromSections,
  $groupBlocksIntoSection,
  $replaceSectionBlocks,
  $snapshotSections,
  $touchedBlockNodes,
  registerSectionTransforms,
  type SectionSnapshot,
} from "./doc-structure";
import { ButtonNode } from "./nodes/button-node";
import { EyebrowNode } from "./nodes/eyebrow-node";
import { $createSectionNode, $isSectionNode, SectionNode } from "./nodes/section-node";
import { SelectionToolbarPlugin } from "./plugins/selection-toolbar";

/**
 * The page as one continuous document. Selection spans sections; sections
 * are containers inside a single Lexical editor. Chrome (headers, rail,
 * toolbar) floats in overlays aligned to the live DOM.
 */

export interface DocEditorHandle {
  /** Replace one section's blocks (version switch / adoption). */
  replaceSectionBlocks: (slug: string, blocks: Block[]) => void;
  /** Group the current selection into a new section; returns its slug. */
  groupSelection: () => string | null;
  /** Remove a section and its content from the document. */
  removeSection: (slug: string) => void;
}

export interface SectionRect {
  slug: string;
  top: number;
  height: number;
}

export interface DocEditorProps {
  initialSections: SectionSnapshot[];
  makeSlug: () => string;
  onSnapshotChange: (sections: SectionSnapshot[]) => void;
  /** Renders each section's header chrome into the reserved headroom. */
  renderSectionHeader: (slug: string) => ReactNode;
  autoFocus?: boolean;
}

export const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  { initialSections, makeSlug, onSnapshotChange, renderSectionHeader, autoFocus },
  ref,
) {
  const initialConfig = {
    namespace: "copydog-doc",
    theme: {
      heading: { h1: "editor-h1", h2: "editor-h2", h3: "editor-h3", h4: "editor-h4", h5: "editor-h5", h6: "editor-h6" },
      paragraph: "editor-p",
      list: { ul: "editor-ul", listitem: "editor-li" },
      text: { bold: "font-semibold", italic: "italic", code: "editor-code" },
    },
    nodes: [HeadingNode, ListNode, ListItemNode, EyebrowNode, ButtonNode, SectionNode],
    editorState: () => $buildDocFromSections(initialSections, makeSlug),
    onError: (error: Error) => {
      throw error;
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <DocEditorInner
        handleRef={ref}
        makeSlug={makeSlug}
        onSnapshotChange={onSnapshotChange}
        renderSectionHeader={renderSectionHeader}
        autoFocus={autoFocus}
      />
    </LexicalComposer>
  );
});

function DocEditorInner({
  handleRef,
  makeSlug,
  onSnapshotChange,
  renderSectionHeader,
  autoFocus,
}: {
  handleRef: React.Ref<DocEditorHandle>;
  makeSlug: () => string;
  onSnapshotChange: (sections: SectionSnapshot[]) => void;
  renderSectionHeader: (slug: string) => ReactNode;
  autoFocus?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [sectionRects, setSectionRects] = useState<SectionRect[]>([]);
  const [sectionDropLine, setSectionDropLine] = useState<number | null>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);

  // reveal a section's chrome while the pointer is over it (or the gap
  // above it, where the chrome strip floats)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const CHROME_ZONE = 40;
    const onMove = (event: MouseEvent) => {
      const y = event.clientY - wrapper.getBoundingClientRect().top;
      let found: string | null = null;
      for (const rect of sectionRects) {
        if (y >= rect.top - CHROME_ZONE && y < rect.top + rect.height) {
          found = rect.slug;
          break;
        }
      }
      setHoveredSlug((prev) => (prev === found ? prev : found));
    };
    const onLeave = () => setHoveredSlug(null);
    wrapper.addEventListener("mousemove", onMove);
    wrapper.addEventListener("mouseleave", onLeave);
    return () => {
      wrapper.removeEventListener("mousemove", onMove);
      wrapper.removeEventListener("mouseleave", onLeave);
    };
  }, [sectionRects]);

  useEffect(() => registerSectionTransforms(editor, makeSlug), [editor, makeSlug]);
  useEffect(() => registerMarkdownShortcuts(editor, [HEADING, UNORDERED_LIST]), [editor]);

  useEffect(() => {
    if (autoFocus) editor.focus(undefined, { defaultSelection: "rootEnd" });
  }, [editor, autoFocus]);

  // emit the mount-time snapshot: a fresh page's fallback section needs
  // metadata (and its seed save) before the user ever types
  const emittedInitial = useRef(false);
  useEffect(() => {
    if (emittedInitial.current) return;
    emittedInitial.current = true;
    onSnapshotChange(editor.getEditorState().read($snapshotSections));
  }, [editor, onSnapshotChange]);

  useImperativeHandle(
    handleRef,
    () => ({
      replaceSectionBlocks: (slug, blocks) => {
        editor.update(() => {
          $replaceSectionBlocks(slug, blocks);
        });
      },
      groupSelection: () => {
        let slug: string | null = null;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          slug = $groupBlocksIntoSection($touchedBlockNodes(selection.getNodes()), makeSlug);
        });
        return slug;
      },
      removeSection: (slug) => {
        editor.update(() => {
          const section = $getRoot()
            .getChildren()
            .find((n) => $isSectionNode(n) && n.getSlug() === slug);
          section?.remove();
        });
      },
    }),
    [editor, makeSlug],
  );

  /** Measure section boxes so headers align to the live document. */
  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rects: SectionRect[] = [];
    for (const el of wrapper.querySelectorAll<HTMLElement>("[data-section-slug]")) {
      rects.push({ slug: el.dataset.sectionSlug!, top: el.offsetTop, height: el.offsetHeight });
    }
    setSectionRects((prev) =>
      prev.length === rects.length &&
      prev.every((r, i) => r.slug === rects[i]!.slug && r.top === rects[i]!.top && r.height === rects[i]!.height)
        ? prev
        : rects,
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      onSnapshotChange(editorState.read($snapshotSections));
      // header positions depend on content height
      requestAnimationFrame(measure);
    },
    [onSnapshotChange, measure],
  );

  return (
    <div ref={wrapperRef} className="doc-editor copy-editor relative">
      <RichTextPlugin
        contentEditable={<ContentEditable className="outline-none" aria-label="Page copy" />}
        placeholder={
          <p className="pointer-events-none absolute left-14 top-[2.6rem] text-ink-tertiary">
            Start writing — headings become sections as you go…
          </p>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <SelectionToolbarPlugin
        onGroup={() => {
          let slug: string | null = null;
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            slug = $groupBlocksIntoSection($touchedBlockNodes(selection.getNodes()), makeSlug);
          });
          return slug;
        }}
      />

      {/* section chrome: invisible until hovered, floating in the gap above
          each section — nothing reserves space, nothing can overlap copy */}
      <div aria-hidden={false} className="pointer-events-none absolute inset-0">
        {sectionRects.map((rect) => {
          const active = hoveredSlug === rect.slug;
          return (
            <div key={rect.slug}>
              {/* extent rule: shows what belongs to the section */}
              <div
                aria-hidden
                className={`absolute w-0.5 rounded-full bg-accent/35 transition-opacity duration-150 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
                style={{ top: rect.top + 4, height: Math.max(rect.height - 8, 12), left: 44 }}
              />
              <div
                // always hit-testable; visibility is CSS-only (compositor-
                // synchronous) so clicks can never race a React commit
                className={`pointer-events-auto absolute left-9 right-0 flex items-center transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
                style={{ top: rect.top - 34 }}
                data-section-header={rect.slug}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-border/70 bg-bg/90 py-0.5 pl-1 pr-2 shadow-soft backdrop-blur-sm">
                  <SectionGrip
                    slug={rect.slug}
                    editor={editor}
                    sectionRects={sectionRects}
                    wrapperRef={wrapperRef}
                    onDropLine={setSectionDropLine}
                  />
                  <button
                    type="button"
                    aria-label="Add section below"
                    title="Add a section below"
                    onClick={() => insertSectionAfter(editor, rect.slug, makeSlug)}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">{renderSectionHeader(rect.slug)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sectionDropLine !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded bg-accent"
          style={{ top: sectionDropLine - 1 }}
          data-section-drop-indicator
        />
      )}
    </div>
  );
}

/**
 * Drag a whole section by its header grip: pointer-based, drops between
 * sections (or at the end).
 */
function SectionGrip({
  slug,
  editor,
  sectionRects,
  wrapperRef,
  onDropLine,
}: {
  slug: string;
  editor: LexicalEditor;
  sectionRects: SectionRect[];
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  onDropLine: (top: number | null) => void;
}) {
  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const gapFor = (clientY: number): { beforeSlug: string | null; top: number } | null => {
      const wrapperTop = wrapper.getBoundingClientRect().top;
      const y = clientY - wrapperTop;
      let best: { beforeSlug: string | null; top: number } | null = null;
      let bestDistance = Infinity;
      for (const rect of sectionRects) {
        const d = Math.abs(y - rect.top);
        if (d < bestDistance) {
          bestDistance = d;
          best = { beforeSlug: rect.slug, top: rect.top };
        }
      }
      const last = sectionRects[sectionRects.length - 1];
      if (last) {
        const end = last.top + last.height;
        if (Math.abs(y - end) < bestDistance) {
          best = { beforeSlug: null, top: end };
        }
      }
      return best;
    };

    const onMove = (e: PointerEvent) => onDropLine(gapFor(e.clientY)?.top ?? null);
    const finish = (e: PointerEvent | KeyboardEvent, commit: boolean) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey);
      onDropLine(null);
      if (!commit || !("clientY" in e)) return;
      const gap = gapFor(e.clientY);
      if (!gap || gap.beforeSlug === slug) return;
      moveSectionBySlug(editor, slug, gap.beforeSlug);
    };
    const onUp = (e: PointerEvent) => finish(e, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(e, false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKey);
  };

  return (
    <button
      type="button"
      aria-label="Drag to reorder section"
      title="Drag to reorder section"
      onPointerDown={startDrag}
      className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
        <circle cx="5.5" cy="3.5" r="1.2" />
        <circle cx="10.5" cy="3.5" r="1.2" />
        <circle cx="5.5" cy="8" r="1.2" />
        <circle cx="10.5" cy="8" r="1.2" />
        <circle cx="5.5" cy="12.5" r="1.2" />
        <circle cx="10.5" cy="12.5" r="1.2" />
      </svg>
    </button>
  );
}

/** Inserts a fresh empty section below the given one and focuses it. */
function insertSectionAfter(editor: LexicalEditor, slug: string, makeSlug: () => string): void {
  editor.update(() => {
    const section = $getRoot()
      .getChildren()
      .find((n) => $isSectionNode(n) && n.getSlug() === slug);
    if (!section) return;
    const next = $createSectionNode(makeSlug());
    const paragraph = $createParagraphNode();
    next.append(paragraph);
    section.insertAfter(next);
    paragraph.select();
  });
  editor.focus();
}

/** Finds the SectionNode key for a slug (used by drag/drop of sections). */
export function findSectionKey(editor: LexicalEditor, slug: string): string | null {
  return editor.read(() => {
    for (const node of editor.getEditorState()._nodeMap.values()) {
      if ($isSectionNode(node) && node.getSlug() === slug) return node.getKey();
    }
    return null;
  });
}

export function moveSectionBySlug(editor: LexicalEditor, slug: string, beforeSlug: string | null): void {
  editor.update(() => {
    const nodes = [...editor.getEditorState()._nodeMap.values()].filter($isSectionNode);
    const moving = nodes.find((n) => n.getSlug() === slug);
    if (!moving) return;
    const latest = $getNodeByKey(moving.getKey());
    if (!latest || !$isSectionNode(latest)) return;
    if (beforeSlug === null) {
      const parent = latest.getParentOrThrow();
      const last = parent.getLastChild();
      if (last && last !== latest) last.insertAfter(latest);
      return;
    }
    const target = nodes.find((n) => n.getSlug() === beforeSlug);
    if (!target || target === moving) return;
    const targetLatest = $getNodeByKey(target.getKey());
    if (targetLatest) targetLatest.insertBefore(latest);
  });
}
