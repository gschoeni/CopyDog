import { createHeadlessEditor } from "@lexical/headless";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode } from "@lexical/rich-text";
import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/copy/blocks";
import { parseSectionMarkdown, serializeBlocks } from "@/lib/copy/markdown";

import { $extractBlocks, $populateFromBlocks, normalizeRuns } from "./lexical-blocks";
import { ButtonNode } from "./nodes/button-node";
import { EyebrowNode } from "./nodes/eyebrow-node";

function makeEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [HeadingNode, ListNode, ListItemNode, EyebrowNode, ButtonNode],
    onError: (error) => {
      throw error;
    },
  });
}

async function roundTrip(blocks: Block[]): Promise<Block[]> {
  const editor = makeEditor();
  await new Promise<void>((resolve) => editor.update(() => $populateFromBlocks(blocks), { onUpdate: resolve }));
  return editor.read($extractBlocks);
}

describe("lexical ⇄ blocks", () => {
  it("round-trips every block type through the editor", async () => {
    const blocks: Block[] = [
      { type: "eyebrow", text: "NEW" },
      { type: "h1", text: "Copy that ships" },
      { type: "h3", text: "Subhead" },
      { type: "p", text: "Body with **bold**, *italic*, and `code`." },
      { type: "bullets", items: ["First point", "Second **strong** point"] },
      { type: "button", label: "Start free", url: "https://copydog.app" },
    ];

    expect(await roundTrip(blocks)).toEqual(blocks);
  });

  it("drops empty paragraphs and empty list items", async () => {
    const editor = makeEditor();
    await new Promise<void>((resolve) =>
      editor.update(() => $populateFromBlocks([{ type: "p", text: "" }, { type: "bullets", items: [] }]), {
        onUpdate: resolve,
      }),
    );
    expect(editor.read($extractBlocks)).toEqual([]);
  });

  it("editor output feeds straight into the markdown serializer", async () => {
    const blocks = await roundTrip([
      { type: "h2", text: "Pricing" },
      { type: "p", text: "One plan." },
      { type: "button", label: "Buy", url: "#" },
    ]);
    const markdown = serializeBlocks(blocks);
    expect(parseSectionMarkdown(markdown)).toEqual(blocks);
  });
});

describe("normalizeRuns", () => {
  it("merges adjacent runs with identical marks", () => {
    expect(
      normalizeRuns([
        { text: "a", bold: true },
        { text: "b", bold: true },
        { text: "c" },
        { text: "" },
        { text: "d", italic: true },
      ]),
    ).toEqual([
      { text: "ab", bold: true },
      { text: "c" },
      { text: "d", italic: true },
    ]);
  });
});
