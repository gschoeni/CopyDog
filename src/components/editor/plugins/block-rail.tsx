"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getNodeByKey, $getRoot } from "lexical";

import { $isSectionNode } from "../nodes/section-node";

/**
 * The Notion-style left rail: hovering a block reveals ⊕ (insert below)
 * and ⠿ (drag to reorder — within or across sections). Dragging is
 * pointer-based with a drop indicator line at the nearest block gap.
 */

interface HoverTarget {
  key: string;
  top: number;
  height: number;
}

interface DropGap {
  /** insert before this block key; null = append to the section */
  beforeKey: string | null;
  sectionKey: string;
  top: number;
}

export function BlockRailPlugin({ wrapperRef }: { wrapperRef: React.RefObject<HTMLDivElement | null> }) {
  const [editor] = useLexicalComposerContext();
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [dragging, setDragging] = useState<{ key: string } | null>(null);
  const [gap, setGap] = useState<DropGap | null>(null);
  const dragState = useRef<{ key: string } | null>(null);

  /** Ordered [key, element] pairs of every block (children of sections). */
  const blockElements = useCallback((): [string, HTMLElement][] => {
    const result: [string, HTMLElement][] = [];
    editor.read(() => {
      for (const section of $getRoot().getChildren()) {
        if (!$isSectionNode(section)) continue;
        for (const child of section.getChildren()) {
          const el = editor.getElementByKey(child.getKey());
          if (el) result.push([child.getKey(), el]);
        }
      }
    });
    return result;
  }, [editor]);

  // track the hovered block
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onMove = (event: MouseEvent) => {
      if (dragState.current) return; // handled by drag tracking
      const wrapperRect = wrapper.getBoundingClientRect();
      const y = event.clientY;
      let found: HoverTarget | null = null;
      for (const [key, el] of blockElements()) {
        const rect = el.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          found = { key, top: rect.top - wrapperRect.top, height: rect.height };
          break;
        }
      }
      setHover((prev) => (prev?.key === found?.key && prev?.top === found?.top ? prev : found));
    };
    const onLeave = () => {
      if (!dragState.current) setHover(null);
    };

    wrapper.addEventListener("mousemove", onMove);
    wrapper.addEventListener("mouseleave", onLeave);
    return () => {
      wrapper.removeEventListener("mousemove", onMove);
      wrapper.removeEventListener("mouseleave", onLeave);
    };
  }, [wrapperRef, blockElements]);

  const insertBelow = useCallback(
    (key: string) => {
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (!node) return;
        const paragraph = $createParagraphNode();
        node.insertAfter(paragraph);
        paragraph.selectStart();
      });
      editor.focus();
    },
    [editor],
  );

  /** Compute the nearest insertion gap for a pointer position. */
  const gapForPointer = useCallback(
    (clientY: number): DropGap | null => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;
      const wrapperRect = wrapper.getBoundingClientRect();
      let best: DropGap | null = null;
      let bestDistance = Infinity;

      editor.read(() => {
        for (const section of $getRoot().getChildren()) {
          if (!$isSectionNode(section)) continue;
          const children = section.getChildren();
          for (let i = 0; i <= children.length; i++) {
            const beforeNode = children[i] ?? null;
            const anchorEl = editor.getElementByKey((children[i] ?? children[i - 1])!.getKey());
            if (!anchorEl) continue;
            const rect = anchorEl.getBoundingClientRect();
            const gapY = i < children.length ? rect.top : rect.bottom;
            const distance = Math.abs(clientY - gapY);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = {
                beforeKey: beforeNode ? beforeNode.getKey() : null,
                sectionKey: section.getKey(),
                top: gapY - wrapperRect.top,
              };
            }
          }
        }
      });
      return best;
    },
    [editor, wrapperRef],
  );

  const startDrag = useCallback(
    (key: string, event: React.PointerEvent) => {
      event.preventDefault();
      dragState.current = { key };
      setDragging({ key });

      const onMove = (e: PointerEvent) => setGap(gapForPointer(e.clientY));
      const finish = (e: PointerEvent | KeyboardEvent, commit: boolean) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("keydown", onKey);
        const target = commit && "clientY" in e ? gapForPointer(e.clientY) : null;
        dragState.current = null;
        setDragging(null);
        setGap(null);
        if (!target) return;
        editor.update(() => {
          const moving = $getNodeByKey(key);
          if (!moving) return;
          if (target.beforeKey === key) return;
          if (target.beforeKey) {
            const before = $getNodeByKey(target.beforeKey);
            if (before && before !== moving) before.insertBefore(moving);
          } else {
            const section = $getNodeByKey(target.sectionKey);
            if (section && $isSectionNode(section) && moving.getParent() !== null) {
              section.append(moving);
            }
          }
        });
      };
      const onUp = (e: PointerEvent) => finish(e, true);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") finish(e, false);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("keydown", onKey);
    },
    [editor, gapForPointer],
  );

  return (
    <>
      {hover && (
        <div
          className="absolute z-10 flex items-start gap-0.5"
          style={{ top: hover.top + 2, left: 0 }}
          data-block-rail
        >
          <button
            type="button"
            aria-label="Add block below"
            title="Add a block below"
            onClick={() => insertBelow(hover.key)}
            className="flex size-6 items-center justify-center rounded text-ink-tertiary opacity-70 transition-colors hover:bg-surface-hover hover:text-ink hover:opacity-100"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            aria-label="Drag to move block"
            title="Drag to move"
            onPointerDown={(e) => startDrag(hover.key, e)}
            className={`flex size-6 cursor-grab items-center justify-center rounded text-ink-tertiary opacity-70 transition-colors hover:bg-surface-hover hover:text-ink hover:opacity-100 ${
              dragging ? "cursor-grabbing" : ""
            }`}
          >
            <GripIcon />
          </button>
        </div>
      )}

      {gap && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded bg-accent"
          style={{ top: gap.top - 1 }}
          data-drop-indicator
        />
      )}
    </>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="3.5" r="1.2" />
      <circle cx="10.5" cy="3.5" r="1.2" />
      <circle cx="5.5" cy="8" r="1.2" />
      <circle cx="10.5" cy="8" r="1.2" />
      <circle cx="5.5" cy="12.5" r="1.2" />
      <circle cx="10.5" cy="12.5" r="1.2" />
    </svg>
  );
}
