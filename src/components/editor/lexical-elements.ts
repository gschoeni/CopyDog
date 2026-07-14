import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from "@lexical/list";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
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

import type { Element, HeadingLevel } from "@/lib/copy/elements";
import { headingLevels } from "@/lib/copy/elements";
import { parseInline, serializeInline, type TextRun } from "@/lib/copy/inline";

import { $createButtonNode, $isButtonNode } from "./nodes/button-node";
import { $createEyebrowNode, $isEyebrowNode } from "./nodes/eyebrow-node";

/**
 * Element[] ⇄ Lexical document. Both functions must run inside
 * editor.update()/read() — they operate on the active editor state.
 * The editor is a *view*: these conversions keep markdown canonical.
 */

export function $populateFromElements(blocks: Element[]): void {
  const root = $getRoot();
  root.clear();
  $appendElementsTo(root, blocks);
  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

/** Builds Lexical nodes for blocks and appends them to any container. */
export function $appendElementsTo(element: ElementNode, blocks: Element[]): void {
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
        element.append(heading);
        break;
      }
      case "eyebrow": {
        const eyebrow = $createEyebrowNode();
        appendInline(eyebrow, block.text);
        element.append(eyebrow);
        break;
      }
      case "button": {
        const button = $createButtonNode(block.url);
        appendInline(button, block.label);
        element.append(button);
        break;
      }
      case "bullets": {
        const list = $createListNode("bullet");
        for (const item of block.items) {
          const listItem = $createListItemNode();
          appendInline(listItem, item);
          list.append(listItem);
        }
        element.append(list);
        break;
      }
      case "quote": {
        const quote = $createQuoteNode();
        appendInline(quote, block.text);
        element.append(quote);
        break;
      }
      case "p": {
        const paragraph = $createParagraphNode();
        appendInline(paragraph, block.text);
        element.append(paragraph);
        break;
      }
    }
  }
}

export function $extractElements(): Element[] {
  return $elementsFrom($getRoot());
}

/** Reads a container's children back into the canonical block model. */
export function $elementsFrom(container: ElementNode): Element[] {
  const blocks: Element[] = [];

  for (const node of container.getChildren()) {
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
    if ($isQuoteNode(node)) {
      const text = inlineOf(node);
      if (text) blocks.push({ type: "quote", text });
      continue;
    }
    if ($isParagraphNode(node)) {
      // empty paragraphs are real: blank lines are part of freeform copy
      blocks.push({ type: "p", text: inlineOf(node) });
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
    if (run.link !== undefined) {
      const link = $createLinkNode(run.link);
      link.append(text);
      element.append(link);
    } else {
      element.append(text);
    }
  }
}

function inlineOf(element: ElementNode): string {
  return serializeInline(normalizeRuns(collectRuns(element)));
}

function collectRuns(element: ElementNode, link?: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of element.getChildren()) {
    if ($isTextNode(child)) {
      const run = runOf(child);
      if (link !== undefined) run.link = link;
      runs.push(run);
    } else if ($isLinkNode(child)) {
      runs.push(...collectRuns(child, child.getURL()));
    } else if ($isElementNode(child)) {
      runs.push(...collectRuns(child, link));
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
    if (
      prev &&
      !!prev.bold === !!run.bold &&
      !!prev.italic === !!run.italic &&
      !!prev.code === !!run.code &&
      prev.link === run.link
    ) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

