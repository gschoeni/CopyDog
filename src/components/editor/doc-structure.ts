import { $isListNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import type { Block } from "@/lib/copy/blocks";

import { $appendBlocksToElement, $blocksFromElement } from "./lexical-blocks";
import { $isEyebrowNode } from "./nodes/eyebrow-node";
import { $createSectionNode, $isSectionNode, SectionNode } from "./nodes/section-node";

/**
 * The page as one continuous document: the root holds SectionNodes, each
 * holding block nodes. These helpers build it, snapshot it back to the
 * canonical model, and keep it well-formed while sections split and merge
 * under the cursor.
 */

export interface SectionSnapshot {
  slug: string;
  blocks: Block[];
  /** grouped-by-hand sections are pinned: auto-splitting leaves them alone */
  pinned?: boolean;
}

export function $buildDocFromSections(sections: SectionSnapshot[], makeSlug: () => string): void {
  const root = $getRoot();
  root.clear();
  for (const section of sections) {
    const node = $createSectionNode(section.slug, section.pinned ?? false);
    $appendBlocksToElement(node, section.blocks);
    if (node.getChildrenSize() === 0) node.append($createParagraphNode());
    root.append(node);
  }
  if (root.getChildrenSize() === 0) {
    const node = $createSectionNode(makeSlug());
    node.append($createParagraphNode());
    root.append(node);
  }
}

export function $snapshotSections(): SectionSnapshot[] {
  return $getRoot()
    .getChildren()
    .filter($isSectionNode)
    .map((section) => ({
      slug: section.getSlug(),
      blocks: $blocksFromElement(section),
      pinned: section.isPinned(),
    }));
}

/** Replaces one section's content (version switching, adoption). */
export function $replaceSectionBlocks(slug: string, blocks: Block[]): boolean {
  const section = $getRoot().getChildren().find((n): n is SectionNode => $isSectionNode(n) && n.getSlug() === slug);
  if (!section) return false;
  section.clear();
  $appendBlocksToElement(section, blocks);
  if (section.getChildrenSize() === 0) section.append($createParagraphNode());
  return true;
}

/**
 * Registers the transforms that keep the document well-formed:
 *  - stray top-level nodes get wrapped into sections
 *  - an H1/H2 typed after body content splits its section (auto-sectioning)
 *  - emptied sections disappear; an empty page keeps one section
 */
export function registerSectionTransforms(editor: LexicalEditor, makeSlug: () => string): () => void {
  const unregisterRoot = editor.registerNodeTransform(SectionNode, (section) => {
    // empty sections dissolve (unless it's the last one)
    if (section.getChildrenSize() === 0) {
      const root = section.getParentOrThrow();
      if (root.getChildrenSize() > 1) {
        section.remove();
      } else {
        section.append($createParagraphNode());
      }
      return;
    }
    if (!section.isPinned()) {
      $autoSplitSection(section, makeSlug);
    }
  });

  const unregisterNormalize = editor.registerUpdateListener(({ editorState }) => {
    // wrap stray top-level nodes (paste at root, boundary deletions)
    const needsFix = editorState.read(() => $getRoot().getChildren().some((n) => !$isSectionNode(n)));
    if (!needsFix) return;
    editor.update(() => {
      const root = $getRoot();
      let previous: SectionNode | null = null;
      for (const child of [...root.getChildren()]) {
        if ($isSectionNode(child)) {
          previous = child;
          continue;
        }
        if (previous) {
          previous.append(child);
        } else {
          const section = $createSectionNode(makeSlug());
          child.insertBefore(section);
          section.append(child);
          previous = section;
        }
      }
      if (root.getChildrenSize() === 0) {
        const section = $createSectionNode(makeSlug());
        section.append($createParagraphNode());
        root.append(section);
      }
    });
  });

  return () => {
    unregisterRoot();
    unregisterNormalize();
  };
}

/**
 * The auto-sectioning rules, applied to live nodes (same rules as
 * lib/copy/sections.ts): an H1/H2 after body content starts a new section;
 * a subtitle directly under a title doesn't; H3–H6 never split; an eyebrow
 * attaches forward to the heading below it.
 */
function $autoSplitSection(section: SectionNode, makeSlug: () => string): void {
  const children = section.getChildren();
  let sawBody = false;

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isSectionHeadingNode(child)) {
      if (sawBody && i > 0) {
        // split here: heading (and a preceding eyebrow) start a new section
        const start = i > 0 && $isEyebrowNode(children[i - 1]) ? i - 1 : i;
        if (start === 0) continue; // only an eyebrow above — nothing to split off
        const moved = children.slice(start);
        const next = $createSectionNode(makeSlug());
        section.insertAfter(next);
        for (const node of moved) next.append(node);
        return; // the transform re-runs on both sections and splits further if needed
      }
      continue;
    }
    if (!$isEyebrowNode(child)) sawBody = true;
  }
}

function isSectionHeadingNode(node: LexicalNode): boolean {
  return $isHeadingNode(node) && (node.getTag() === "h1" || node.getTag() === "h2");
}

/** Inserts a fresh empty section after the given one; caret moves into it. */
export function $insertSectionAfterSlug(slug: string, makeSlug: () => string): boolean {
  const section = $getRoot()
    .getChildren()
    .find((n): n is SectionNode => $isSectionNode(n) && n.getSlug() === slug);
  if (!section) return false;
  const next = $createSectionNode(makeSlug());
  const paragraph = $createParagraphNode();
  next.append(paragraph);
  section.insertAfter(next);
  paragraph.select();
  return true;
}

/**
 * Shift+Enter starts a new section below the one under the caret — the
 * keyboard twin of the rail's ⊕. Registered above the rich-text handler,
 * which would otherwise turn it into a soft line break.
 */
export function registerShiftEnterNewSection(editor: LexicalEditor, makeSlug: () => string): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (!event?.shiftKey) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const block = selection.anchor.getNode().getTopLevelElement();
      const section = block?.getParent();
      if (!block || !$isSectionNode(section)) return false;
      event.preventDefault();
      return $insertSectionAfterSlug(section.getSlug(), makeSlug);
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/**
 * Backspace in a section with no text left deletes the section and puts
 * the caret at the end of the previous one (or the start of the next, for
 * an empty first section). The last remaining section is never deleted.
 */
export function registerEmptySectionBackspace(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const block = selection.anchor.getNode().getTopLevelElement();
      const section = block?.getParent();
      if (!$isSectionNode(section)) return false;
      if (section.getTextContent().trim() !== "") return false;

      const previous = section.getPreviousSibling();
      const next = section.getNextSibling();
      if ($isSectionNode(previous)) {
        event?.preventDefault();
        previous.selectEnd();
        section.remove();
        return true;
      }
      if ($isSectionNode(next)) {
        event?.preventDefault();
        next.selectStart();
        section.remove();
        return true;
      }
      return false;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/**
 * Groups a set of block nodes (possibly spanning sections) into a fresh
 * section inserted where the first block was. Emptied sections are cleaned
 * up by the transforms. Returns the new section's slug.
 */
export function $groupBlocksIntoSection(blockNodes: LexicalNode[], makeSlug: () => string): string | null {
  const blocks = blockNodes.filter((n) => $isSectionNode(n.getParent()));
  if (blocks.length === 0) return null;

  const first = blocks[0]!;
  const homeSection = first.getParentOrThrow();
  // pinned: this grouping is deliberate — auto-splitting must not undo it
  const newSection = $createSectionNode(makeSlug(), true);
  homeSection.insertAfter(newSection);
  for (const node of blocks) newSection.append(node);
  return newSection.getSlug();
}

/** The block-level ancestors (children of sections) touched by a set of nodes. */
export function $touchedBlockNodes(nodes: LexicalNode[]): LexicalNode[] {
  const seen = new Set<string>();
  const result: LexicalNode[] = [];
  for (const node of nodes) {
    let current: LexicalNode | null = node;
    while (current && !$isSectionNode(current.getParent())) {
      current = current.getParent();
    }
    if (current && !seen.has(current.getKey())) {
      seen.add(current.getKey());
      result.push(current);
    }
  }
  return result;
}

/** True when a node can host block content (used by drop targets). */
export function $isBlockContainer(node: LexicalNode): node is ElementNode {
  return $isElementNode(node) && ($isSectionNode(node) || $isListNode(node));
}
