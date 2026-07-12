import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list";
import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from "lexical";

import type { Block, HeadingLevel } from "@/lib/copy/blocks";
import { headingLevels } from "@/lib/copy/blocks";
import { parseInline, serializeInline, type TextRun } from "@/lib/copy/inline";

import { $createButtonNode, $isButtonNode } from "./nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode } from "./nodes/eyebrow-node";

/**
 * Block[] ⇄ Lexical document. Both functions must run inside
 * editor.update()/read() — they operate on the active editor state.
 * The editor is a *view*: these conversions keep markdown canonical.
 */

export function $populateFromBlocks(blocks: Block[]): void {
  const root = $getRoot();
  root.clear();

  for (const block of blocks) {
    switch (block.type) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const heading = $createHeadingNode(block.type);
        appendInline(heading, block.text);
        root.append(heading);
        break;
      }
      case "eyebrow": {
        const eyebrow = $createEyebrowNode();
        appendInline(eyebrow, block.text);
        root.append(eyebrow);
        break;
      }
      case "button": {
        const button = $createButtonNode(block.url);
        appendInline(button, block.label);
        root.append(button);
        break;
      }
      case "bullets": {
        const list = $createListNode("bullet");
        for (const item of block.items) {
          const listItem = $createListItemNode();
          appendInline(listItem, item);
          list.append(listItem);
        }
        root.append(list);
        break;
      }
      case "p": {
        const paragraph = $createParagraphNode();
        appendInline(paragraph, block.text);
        root.append(paragraph);
        break;
      }
    }
  }

  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

export function $extractBlocks(): Block[] {
  const blocks: Block[] = [];

  for (const node of $getRoot().getChildren()) {
    if ($isHeadingNode(node)) {
      const tag = node.getTag() as HeadingLevel;
      if (headingLevels.includes(tag)) {
        blocks.push({ type: tag, text: inlineOf(node) });
        continue;
      }
    }
    if ($isEyebrowNode(node)) {
      const text = inlineOf(node);
      if (text) blocks.push({ type: "eyebrow", text });
      continue;
    }
    if ($isButtonNode(node)) {
      const label = inlineOf(node);
      if (label) blocks.push({ type: "button", label, url: node.getURL() });
      continue;
    }
    if ($isListNode(node)) {
      const items = node
        .getChildren()
        .filter($isListItemNode)
        .map((item) => inlineOf(item))
        .filter(Boolean);
      if (items.length) blocks.push({ type: "bullets", items });
      continue;
    }
    if ($isParagraphNode(node)) {
      const text = inlineOf(node);
      if (text) blocks.push({ type: "p", text });
      continue;
    }
  }

  return blocks;
}

function appendInline(element: ElementNode, inlineMarkdown: string): void {
  for (const run of parseInline(inlineMarkdown)) {
    const text = $createTextNode(run.text);
    if (run.bold) text.toggleFormat("bold");
    if (run.italic) text.toggleFormat("italic");
    if (run.code) text.toggleFormat("code");
    element.append(text);
  }
}

function inlineOf(element: ElementNode): string {
  return serializeInline(normalizeRuns(collectRuns(element)));
}

function collectRuns(element: ElementNode): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of element.getChildren()) {
    if ($isTextNode(child)) {
      runs.push(runOf(child));
    } else if ($isElementNode(child)) {
      runs.push(...collectRuns(child));
    }
  }
  return runs;
}

function runOf(node: TextNode): TextRun {
  const run: TextRun = { text: node.getTextContent() };
  if (node.hasFormat("bold")) run.bold = true;
  if (node.hasFormat("italic")) run.italic = true;
  if (node.hasFormat("code")) run.code = true;
  return run;
}

/** Merges adjacent runs with identical marks so serialization is minimal. */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && !!prev.bold === !!run.bold && !!prev.italic === !!run.italic && !!prev.code === !!run.code) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Type guard helper the block menu uses to name the current block. */
export function $topLevelBlockOf(node: LexicalNode): LexicalNode {
  return node.getTopLevelElementOrThrow();
}
