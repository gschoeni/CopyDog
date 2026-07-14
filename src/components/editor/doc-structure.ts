import { $isListNode } from "@lexical/list";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import type { Element } from "@/lib/copy/elements";

import { $appendElementsTo, $elementsFrom } from "./lexical-elements";
import { $createSectionNode, $isSectionNode, SectionNode } from "./nodes/section-node";

/**
 * The page as one continuous document: the root holds an ordered mix of
 * loose element nodes (the default as you write) and SectionNodes
 * (deliberate groups). These helpers build it, snapshot it back to the
 * canonical model, and keep it well-formed.
 */

export type ContentSnapshot =
  | { kind: "section"; slug: string; elements: Element[] }
  | { kind: "elements"; elements: Element[] };

export function $buildDocFromContent(content: ContentSnapshot[]): void {
  const root = $getRoot();
  root.clear();
  for (const entry of content) {
    if (entry.kind === "section") {
      const node = $createSectionNode(entry.slug);
      $appendElementsTo(node, entry.elements);
      if (node.getChildrenSize() === 0) node.append($createParagraphNode());
      root.append(node);
    } else {
      $appendElementsTo(root, entry.elements);
    }
  }
  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

/** The document in order: sections, and runs of loose elements between them. */
export function $snapshotContent(): ContentSnapshot[] {
  const content: ContentSnapshot[] = [];
  let loose: LexicalNode[] = [];

  const flushLoose = () => {
    if (loose.length === 0) return;
    const holder = { getChildren: () => loose } as unknown as ElementNode;
    const elements = $elementsFrom(holder);
    if (elements.length > 0) content.push({ kind: "elements", elements });
    loose = [];
  };

  for (const node of $getRoot().getChildren()) {
    if ($isSectionNode(node)) {
      flushLoose();
      content.push({ kind: "section", slug: node.getSlug(), elements: $elementsFrom(node) });
    } else {
      loose.push(node);
    }
  }
  flushLoose();
  return content;
}

/** Replaces one section's content (version switching, adoption). */
export function $replaceSectionElements(slug: string, elements: Element[]): boolean {
  const section = $getRoot().getChildren().find((n): n is SectionNode => $isSectionNode(n) && n.getSlug() === slug);
  if (!section) return false;
  section.clear();
  $appendElementsTo(section, elements);
  if (section.getChildrenSize() === 0) section.append($createParagraphNode());
  return true;
}

/**
 * Keeps the document well-formed: sections that lose all their children
 * dissolve, and an empty root regains a paragraph to type in. (Loose
 * elements need no upkeep — they are the natural state of copy.)
 */
export function registerSectionTransforms(editor: LexicalEditor): () => void {
  const unregisterSection = editor.registerNodeTransform(SectionNode, (section) => {
    if (section.getChildrenSize() === 0) {
      section.remove();
    }
  });

  const unregisterRoot = editor.registerUpdateListener(({ editorState }) => {
    const empty = editorState.read(() => $getRoot().getChildrenSize() === 0);
    if (!empty) return;
    editor.update(() => {
      if ($getRoot().getChildrenSize() === 0) {
        $getRoot().append($createParagraphNode());
      }
    });
  });

  return () => {
    unregisterSection();
    unregisterRoot();
  };
}

/** Inserts a fresh empty section after the given one; caret moves into it. */
export function $insertSectionAfterSlug(slug: string, makeSlug: () => string): boolean {
  const section = $getRoot()
    .getChildren()
    .find((n): n is SectionNode => $isSectionNode(n) && n.getSlug() === slug);
  if (!section) return false;
  $insertSectionAfterNode(section, makeSlug);
  return true;
}

/** Appends a fresh empty section at the document's end; caret moves into it. */
export function $appendNewSection(makeSlug: () => string): void {
  const root = $getRoot();
  const last = root.getLastChild();
  if (last) {
    $insertSectionAfterNode(last, makeSlug);
    return;
  }
  const section = $createSectionNode(makeSlug());
  const paragraph = $createParagraphNode();
  section.append(paragraph);
  root.append(section);
  paragraph.select();
}

function $insertSectionAfterNode(node: LexicalNode, makeSlug: () => string): void {
  const next = $createSectionNode(makeSlug());
  const paragraph = $createParagraphNode();
  next.append(paragraph);
  node.insertAfter(next);
  paragraph.select();
}

/**
 * Shift+Enter starts a new section below the caret's root-level node —
 * works from inside a section or from loose copy. Registered above the
 * rich-text handler, which would otherwise insert a soft line break.
 */
export function registerShiftEnterNewSection(editor: LexicalEditor, makeSlug: () => string): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (!event?.shiftKey) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const topLevel = selection.anchor.getNode().getTopLevelElement();
      if (!topLevel) return false;
      const anchor = $isSectionNode(topLevel.getParent()) ? topLevel.getParentOrThrow() : topLevel;
      event.preventDefault();
      $insertSectionAfterNode(anchor, makeSlug);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/**
 * Backspace in a section with no text left deletes the section and puts
 * the caret at the end of whatever precedes it (or the start of what
 * follows, for an empty first section).
 */
export function registerEmptySectionBackspace(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const topLevel = selection.anchor.getNode().getTopLevelElement();
      const section = topLevel?.getParent();
      if (!$isSectionNode(section)) return false;
      if (section.getTextContent().trim() !== "") return false;

      const previous = section.getPreviousSibling();
      const next = section.getNextSibling();
      if (previous && $isElementNode(previous)) {
        event?.preventDefault();
        previous.selectEnd();
        section.remove();
        return true;
      }
      if (next && $isElementNode(next)) {
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
 * Groups element nodes (loose, sectioned, or a mix — possibly spanning
 * sections) into a fresh section where the first one was. A loose
 * paragraph is left after it so writing can continue, and emptied
 * sections dissolve via the transforms. Returns the new section's slug.
 */
export function $groupElementsIntoSection(nodes: LexicalNode[], makeSlug: () => string): string | null {
  const elements = nodes.filter((n) => {
    const parent = n.getParent();
    return $isSectionNode(parent) || $isRootNode(parent);
  });
  if (elements.length === 0) return null;

  const first = elements[0]!;
  const firstParent = first.getParentOrThrow();
  const section = $createSectionNode(makeSlug());
  if ($isSectionNode(firstParent)) {
    firstParent.insertAfter(section);
  } else {
    first.insertBefore(section);
  }
  for (const node of elements) section.append(node);

  // keep a place to write below the new section
  const continuation = $createParagraphNode();
  section.insertAfter(continuation);
  continuation.select();

  return section.getSlug();
}

/** The root-level element nodes (loose or section children) touched by a set of nodes. */
export function $touchedElementNodes(nodes: LexicalNode[]): LexicalNode[] {
  const seen = new Set<string>();
  const result: LexicalNode[] = [];
  for (const node of nodes) {
    let current: LexicalNode | null = node;
    while (current) {
      const parent: LexicalNode | null = current.getParent();
      if ($isSectionNode(parent) || $isRootNode(parent)) break;
      current = parent;
    }
    if (current && !$isSectionNode(current) && !seen.has(current.getKey())) {
      seen.add(current.getKey());
      result.push(current);
    }
  }
  return result;
}

/** True when a node can host element content (used by drop targets). */
export function $isElementContainer(node: LexicalNode): node is ElementNode {
  return $isElementNode(node) && ($isSectionNode(node) || $isListNode(node));
}
