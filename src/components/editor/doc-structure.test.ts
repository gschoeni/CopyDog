import { createHeadlessEditor } from "@lexical/headless";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import type { Element } from "@/lib/copy/elements";

import {
  $buildDocFromContent,
  $groupElementsIntoSection,
  $snapshotContent,
  $touchedElementNodes,
  registerEmptySectionBackspace,
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
  registerSectionTransforms(editor);
  return { editor, makeSlug };
}

function update(editor: LexicalEditor, fn: () => void): Promise<void> {
  return new Promise((resolve) => editor.update(fn, { onUpdate: resolve }));
}

const hero: Element[] = [
  { type: "eyebrow", text: "NEW" },
  { type: "h1", text: "Big claim" },
  { type: "p", text: "Support copy." },
];
const features: Element[] = [
  { type: "h2", text: "Features" },
  { type: "bullets", items: ["Fast", "Kind"] },
];
const loose: Element[] = [
  { type: "p", text: "Messy first thoughts." },
  { type: "h2", text: "A heading that stays loose" },
];

describe("doc structure", () => {
  it("builds a mix of loose runs and sections, and snapshots it back", async () => {
    const { editor } = makeEditor();
    await update(editor, () =>
      $buildDocFromContent([
        { kind: "elements", elements: loose },
        { kind: "section", slug: "hero", elements: hero },
        { kind: "elements", elements: [{ type: "p", text: "Between sections." }] },
        { kind: "section", slug: "features", elements: features },
      ]),
    );
    expect(editor.read($snapshotContent)).toEqual([
      { kind: "elements", elements: loose },
      { kind: "section", slug: "hero", elements: hero },
      { kind: "elements", elements: [{ type: "p", text: "Between sections." }] },
      { kind: "section", slug: "features", elements: features },
    ]);
  });

  it("loose headings do NOT create sections — copy stays loose until grouped", async () => {
    const { editor } = makeEditor();
    await update(editor, () => $buildDocFromContent([{ kind: "elements", elements: loose }]));
    // several updates later, still one loose run and zero sections
    await update(editor, () => {
      const p = $createParagraphNode();
      p.append($createTextNode("More loose copy."));
      $getRoot().append(p);
    });
    const snapshot = editor.read($snapshotContent);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.kind).toBe("elements");
  });

  it("dissolves emptied sections; loose copy needs no upkeep", async () => {
    const { editor } = makeEditor();
    await update(editor, () =>
      $buildDocFromContent([
        { kind: "elements", elements: [{ type: "p", text: "keep me" }] },
        { kind: "section", slug: "gone", elements: [{ type: "p", text: "bye" }] },
      ]),
    );
    await update(editor, () => {
      $getRoot().getChildren().filter($isSectionNode)[0]!.clear();
    });
    expect(editor.read($snapshotContent)).toEqual([
      { kind: "elements", elements: [{ type: "p", text: "keep me" }] },
    ]);
  });

  it("groups loose elements into a section and leaves a place to keep writing", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () => $buildDocFromContent([{ kind: "elements", elements: loose }]));

    let slug: string | null = null;
    await update(editor, () => {
      const nodes = $getRoot().getChildren();
      slug = $groupElementsIntoSection($touchedElementNodes(nodes), makeSlug);
    });

    expect(slug).toBe("new-1");
    const snapshot = editor.read($snapshotContent);
    expect(snapshot).toEqual([{ kind: "section", slug: "new-1", elements: loose }]);
    // the continuation paragraph is selected and ready
    editor.read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
    });
  });

  it("groups a mix of loose and sectioned elements; emptied sections dissolve", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () =>
      $buildDocFromContent([
        { kind: "elements", elements: [{ type: "p", text: "Loose lead-in." }] },
        { kind: "section", slug: "hero", elements: hero },
      ]),
    );

    await update(editor, () => {
      const rootChildren = $getRoot().getChildren();
      const looseP = rootChildren[0]!; // the loose paragraph
      const heroSection = rootChildren[1]! as SectionNode;
      const heroHeading = heroSection.getChildren()[1]!; // h1
      $groupElementsIntoSection($touchedElementNodes([looseP, heroHeading]), makeSlug);
    });

    const snapshot = editor.read($snapshotContent);
    // the loose paragraph and hero's h1 now share a new section; hero keeps the rest
    expect(snapshot).toEqual([
      {
        kind: "section",
        slug: "new-1",
        elements: [
          { type: "p", text: "Loose lead-in." },
          { type: "h1", text: "Big claim" },
        ],
      },
      {
        kind: "section",
        slug: "hero",
        elements: [
          { type: "eyebrow", text: "NEW" },
          { type: "p", text: "Support copy." },
        ],
      },
    ]);
  });

  it("grouping a section's head slice keeps document order (new section goes before)", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () => $buildDocFromContent([{ kind: "section", slug: "hero", elements: hero }]));

    await update(editor, () => {
      const heroSection = $getRoot().getChildren()[0]! as SectionNode;
      const eyebrow = heroSection.getChildren()[0]!;
      $groupElementsIntoSection($touchedElementNodes([eyebrow]), makeSlug);
    });

    expect(editor.read($snapshotContent)).toEqual([
      { kind: "section", slug: "new-1", elements: [{ type: "eyebrow", text: "NEW" }] },
      {
        kind: "section",
        slug: "hero",
        elements: [
          { type: "h1", text: "Big claim" },
          { type: "p", text: "Support copy." },
        ],
      },
    ]);
  });

  it("grouping a section's middle slice splits the tail off to keep the order", async () => {
    const { editor, makeSlug } = makeEditor();
    await update(editor, () => $buildDocFromContent([{ kind: "section", slug: "hero", elements: hero }]));

    await update(editor, () => {
      const heroSection = $getRoot().getChildren()[0]! as SectionNode;
      const h1 = heroSection.getChildren()[1]!;
      $groupElementsIntoSection($touchedElementNodes([h1]), makeSlug);
    });

    // eyebrow · h1 · p must still read in that order: hero keeps the head,
    // the grouped copy gets new-1, the trailing copy gets its own section
    expect(editor.read($snapshotContent)).toEqual([
      { kind: "section", slug: "hero", elements: [{ type: "eyebrow", text: "NEW" }] },
      { kind: "section", slug: "new-1", elements: [{ type: "h1", text: "Big claim" }] },
      { kind: "section", slug: "new-2", elements: [{ type: "p", text: "Support copy." }] },
    ]);
  });

  it("Shift+Enter starts a section below the caret — from a section or loose copy", async () => {
    const { editor, makeSlug } = makeEditor();
    registerShiftEnterNewSection(editor, makeSlug);
    await update(editor, () =>
      $buildDocFromContent([
        { kind: "elements", elements: [{ type: "p", text: "Loose." }] },
        { kind: "section", slug: "hero", elements: hero },
      ]),
    );

    // from loose copy: section lands right after the loose element
    await update(editor, () => {
      $getRoot().getFirstChild()!.selectEnd();
    });
    expect(
      editor.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: true, preventDefault: () => {} } as KeyboardEvent),
    ).toBe(true);
    let snapshot = editor.read($snapshotContent);
    expect(snapshot.map((c) => c.kind)).toEqual(["elements", "section", "section"]);
    expect((snapshot[1] as { slug: string }).slug).toBe("new-1");

    // from inside a section: lands after that section
    await update(editor, () => {
      $getRoot().getChildren().filter($isSectionNode)[1]!.selectEnd();
    });
    expect(
      editor.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: true, preventDefault: () => {} } as KeyboardEvent),
    ).toBe(true);
    snapshot = editor.read($snapshotContent);
    expect(snapshot.map((c) => (c.kind === "section" ? (c as { slug: string }).slug : "loose"))).toEqual([
      "loose",
      "new-1",
      "hero",
      "new-2",
    ]);

    // plain Enter is untouched
    expect(
      editor.dispatchCommand(KEY_ENTER_COMMAND, { shiftKey: false, preventDefault: () => {} } as KeyboardEvent),
    ).toBe(false);
  });

  it("Backspace in an emptied section deletes it and lands on what precedes it", async () => {
    const { editor, makeSlug } = makeEditor();
    registerEmptySectionBackspace(editor);
    await update(editor, () =>
      $buildDocFromContent([
        { kind: "elements", elements: [{ type: "p", text: "Loose before." }] },
        { kind: "section", slug: "empty", elements: [] },
        { kind: "section", slug: "features", elements: features },
      ]),
    );
    void makeSlug;
    await update(editor, () => {
      $getRoot().getChildren().filter($isSectionNode)[0]!.selectEnd();
    });

    expect(
      editor.dispatchCommand(KEY_BACKSPACE_COMMAND, { preventDefault: () => {} } as KeyboardEvent),
    ).toBe(true);
    const snapshot = editor.read($snapshotContent);
    expect(snapshot.map((c) => c.kind)).toEqual(["elements", "section"]);

    // a section with text is left to normal editing
    await update(editor, () => {
      $getRoot().getChildren().filter($isSectionNode)[0]!.selectEnd();
    });
    expect(
      editor.dispatchCommand(KEY_BACKSPACE_COMMAND, { preventDefault: () => {} } as KeyboardEvent),
    ).toBe(false);
  });
});
