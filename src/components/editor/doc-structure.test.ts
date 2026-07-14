import { createHeadlessEditor } from "@lexical/headless";
import { ListItemNode, ListNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { HeadingNode, QuoteNode, $createHeadingNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import type { Block } from "@/lib/copy/blocks";

import {
  $buildDocFromSections,
  $groupBlocksIntoSection,
  $snapshotSections,
  $touchedBlockNodes,
  registerSectionTransforms,
  registerShiftEnterNewSection,
} from "./doc-structure";
import { ButtonNode } from "./nodes/button-node";
import { EyebrowNode } from "./nodes/eyebrow-node";
import { SectionNode, $isSectionNode } from "./nodes/section-node";

function makeEditor(): { editor: LexicalEditor; makeSlug: () => string } {
  let n = 0;
  const makeSlug = () => `new-${++n}`;
  const editor = createHeadlessEditor({
    namespace: "doc-test",
    nodes: [HeadingNode, QuoteNode, LinkNode, ListNode, ListItemNode, EyebrowNode, ButtonNode, SectionNode],
    onError: (error) => {
      throw error;
    },
  });
  registerSectionTransforms(editor, makeSlug);
  return { editor, makeSlug };
}

function update(editor: LexicalEditor, fn: () => void): Promise<void> {
  return new Promise((resolve) => editor.update(fn, { onUpdate: resolve }));
}

const hero: Block[] = [
  { type: "eyebrow", text: "NEW" },
  { type: "h1", text: "Big claim" },
  { type: "p", text: "Support copy." },
];
const features: Block[] = [
  { type: "h2", text: "Features" },
  { type: "bullets", items: ["Fast", "Kind"] },
];

describe("doc structure", () => {
  it("builds sections and snapshots them back identically", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromSections(
        [
          { slug: "hero", blocks: hero },
          { slug: "features", blocks: features },
        ],
        makeSlug,
      ),
    );
    expect(editor.read($snapshotSections)).toEqual([
      { slug: "hero", blocks: hero, pinned: false },
      { slug: "features", blocks: features, pinned: false },
    ]);
  });

  it("auto-splits when an h2 lands after body content", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromSections([{ slug: "hero", blocks: hero }], makeSlug),
    );
    await update(editor, () => {
      const section = $getRoot().getChildren().find($isSectionNode)!;
      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("Pricing"));
      section.append(h2);
      const p = $createParagraphNode();
      p.append($createTextNode("One plan."));
      section.append(p);
    });

    const snapshot = editor.read($snapshotSections);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]!.slug).toBe("hero");
    expect(snapshot[0]!.blocks).toEqual(hero);
    expect(snapshot[1]!.blocks).toEqual([
      { type: "h2", text: "Pricing" },
      { type: "p", text: "One plan." },
    ]);
  });

  it("carries a preceding eyebrow into the split", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () => $buildDocFromSections([{ slug: "hero", blocks: hero }], makeSlug));
    await update(editor, () => {
      const section = $getRoot().getChildren().find($isSectionNode)!;
      const blocks: Block[] = [
        { type: "eyebrow", text: "PRICING" },
        { type: "h2", text: "Plans" },
      ];
      // append via helper-equivalent: eyebrow then heading
      const eyebrow = new EyebrowNode();
      eyebrow.append($createTextNode("PRICING"));
      section.append(eyebrow);
      const h2 = $createHeadingNode("h2");
      h2.append($createTextNode("Plans"));
      section.append(h2);
      void blocks;
    });

    const snapshot = editor.read($snapshotSections);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[1]!.blocks).toEqual([
      { type: "eyebrow", text: "PRICING" },
      { type: "h2", text: "Plans" },
    ]);
  });

  it("a subtitle directly under a title does not split", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromSections(
        [{ slug: "hero", blocks: [{ type: "h1", text: "Title" }, { type: "h2", text: "Subtitle" }, { type: "p", text: "Body." }] }],
        makeSlug,
      ),
    );
    expect(editor.read($snapshotSections)).toHaveLength(1);
  });

  it("dissolves emptied sections but keeps the last one alive", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromSections(
        [
          { slug: "a", blocks: [{ type: "p", text: "keep" }] },
          { slug: "b", blocks: [{ type: "p", text: "gone" }] },
        ],
        makeSlug,
      ),
    );
    await update(editor, () => {
      const sections = $getRoot().getChildren().filter($isSectionNode);
      sections[1]!.clear();
    });
    const snapshot = editor.read($snapshotSections);
    expect(snapshot.map((s) => s.slug)).toEqual(["a"]);

    // emptying the final section keeps a place to type
    await update(editor, () => {
      $getRoot().getChildren().filter($isSectionNode)[0]!.clear();
    });
    expect(editor.read($snapshotSections)).toHaveLength(1);
  });

  it("wraps stray top-level nodes into a section", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () => $buildDocFromSections([{ slug: "hero", blocks: hero }], makeSlug));
    await update(editor, () => {
      const p = $createParagraphNode();
      p.append($createTextNode("stray paragraph"));
      $getRoot().append(p);
    });
    // normalization runs in a follow-up update
    await new Promise((r) => setTimeout(r, 0));
    const snapshot = editor.read($snapshotSections);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.blocks).toContainEqual({ type: "p", text: "stray paragraph" });
  });

  it("Shift+Enter starts a new empty section below the caret's section", async () => {
    const { editor, makeSlug } = makeEditor();
    registerShiftEnterNewSection(editor, makeSlug);
    await update(editor, () =>
      $buildDocFromSections(
        [
          { slug: "hero", blocks: hero },
          { slug: "features", blocks: features },
        ],
        makeSlug,
      ),
    );
    await update(editor, () => {
      const first = $getRoot().getChildren().filter($isSectionNode)[0]!;
      first.selectEnd();
    });

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, {
      shiftKey: true,
      preventDefault: () => {},
    } as KeyboardEvent);
    expect(handled).toBe(true);

    const snapshot = editor.read($snapshotSections);
    expect(snapshot.map((s) => s.slug)).toEqual(["hero", "new-1", "features"]);
    expect(snapshot[1]!.blocks).toEqual([]);

    // the caret moved into the new section
    editor.read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      const section = ($isRangeSelection(selection) ? selection.anchor.getNode() : null)
        ?.getTopLevelElement()
        ?.getParent();
      expect($isSectionNode(section) && section.getSlug()).toBe("new-1");
    });

    // plain Enter is untouched
    const plain = editor.dispatchCommand(KEY_ENTER_COMMAND, {
      shiftKey: false,
      preventDefault: () => {},
    } as KeyboardEvent);
    expect(plain).toBe(false);
  });

  it("groups blocks across sections into a new section and cleans up", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromSections(
        [
          { slug: "hero", blocks: hero },
          { slug: "features", blocks: features },
        ],
        makeSlug,
      ),
    );

    let newSlug: string | null = null;
    await update(editor, () => {
      const sections = $getRoot().getChildren().filter($isSectionNode);
      const heroChildren = sections[0]!.getChildren();
      const featureChildren = sections[1]!.getChildren();
      // group hero's paragraph + features' heading (spanning sections)
      const picked = [heroChildren[2]!, featureChildren[0]!];
      newSlug = $groupBlocksIntoSection($touchedBlockNodes(picked), makeSlug);
    });

    expect(newSlug).toBeTruthy();
    const snapshot = editor.read($snapshotSections);
    const created = snapshot.find((s) => s.slug === newSlug);
    expect(created?.blocks).toEqual([
      { type: "p", text: "Support copy." },
      { type: "h2", text: "Features" },
    ]);
    // sources kept their remaining blocks
    expect(snapshot.find((s) => s.slug === "hero")?.blocks).toEqual([
      { type: "eyebrow", text: "NEW" },
      { type: "h1", text: "Big claim" },
    ]);
    expect(snapshot.find((s) => s.slug === "features")?.blocks).toEqual([{ type: "bullets", items: ["Fast", "Kind"] }]);
  });
});
