import { createHeadlessEditor } from "@lexical/headless";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { describe, expect, it } from "vitest";

import type { Element } from "@/lib/copy/elements";
import { parseElementsMarkdown, serializeElements } from "@/lib/copy/markdown";

import { $extractElements, $populateFromElements, normalizeRuns } from "./lexical-elements";
import { ButtonNode } from "./nodes/button-node";
import { EyebrowNode } from "./nodes/eyebrow-node";

function makeEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [HeadingNode, QuoteNode, LinkNode, ListNode, ListItemNode, EyebrowNode, ButtonNode],
    onError: (error) => {
      throw error;
    },
  });
}

async function roundTrip(elements: Element[]): Promise<Element[]> {
  const editor = makeEditor();
  await new Promise<void>((resolve) => editor.update(() => $populateFromElements(elements), { onUpdate: resolve }));
  return editor.read($extractElements);
}

describe("lexical ⇄ elements", () => {
  it("round-trips every element type through the editor", async () => {
    const elements: Element[] = [
      { type: "eyebrow", text: "NEW" },
      { type: "h1", text: "Copy that ships" },
      { type: "h3", text: "Subhead" },
      { type: "p", text: "Body with **bold**, *italic*, and `code`." },
      { type: "bullets", items: ["First point", "Second **strong** point"] },
      { type: "numbered", items: ["Sign up", "Write *good* copy", "Ship it"] },
      { type: "button", label: "Start free", url: "https://copydog.app" },
      { type: "quote", text: "The best copy tool we've used." },
      { type: "p", text: "Read [the docs](https://docs.x.dev) for more." },
    ];

    expect(await roundTrip(elements)).toEqual(elements);
  });

  it("keeps empty paragraphs (blank lines are content); drops empty lists", async () => {
    const editor = makeEditor();
    await new Promise<void>((resolve) =>
      editor.update(() => $populateFromElements([{ type: "p", text: "" }, { type: "bullets", items: [] }]), {
        onUpdate: resolve,
      }),
    );
    expect(editor.read($extractElements)).toEqual([{ type: "p", text: "" }]);
  });

  it("editor output feeds straight into the markdown serializer", async () => {
    const elements = await roundTrip([
      { type: "h2", text: "Pricing" },
      { type: "p", text: "One plan." },
      { type: "button", label: "Buy", url: "#" },
    ]);
    const markdown = serializeElements(elements);
    expect(parseElementsMarkdown(markdown)).toEqual(elements);
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
