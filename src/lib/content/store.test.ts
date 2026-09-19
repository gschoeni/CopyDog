import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import {
  ensureDraftView,
  hasPreviousWireframe,
  hasUnpublishedChanges,
  publishDraft,
  readDoc,
  readSectionVersion,
  readSite,
  readWireframe,
  undoWireframe,
  writeDoc,
  writeSectionVersion,
  writeWireframe,
  type DraftView,
} from "./store";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const USER_ID = "user-123";
const REPO = "acme-x1";

describe("content store", () => {
  let stub: OxenStub;
  let oxen: OxenClient;
  let view: DraftView;

  beforeEach(async () => {
    stub = new OxenStub();
    oxen = new OxenClient({
      token: "t",
      namespace: "ns",
      baseUrl: "https://stub.oxen.local",
      fetchImpl: stub.fetch,
    });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    view = await ensureDraftView(oxen, REPO, USER_ID);
  });

  it("ensureDraftView is idempotent and reads through to main content", async () => {
    const again = await ensureDraftView(oxen, REPO, USER_ID);
    expect(again).toEqual(view);

    const site = await readSite(oxen, view);
    expect(site.pages[0]).toEqual({ slug: "home", title: "Home" });

    const doc = await readDoc(oxen, view, "home");
    expect(doc.content).toEqual([]);
  });

  it("returns null for a section version that does not exist", async () => {
    expect(await readSectionVersion(oxen, view, "home", "hero", "original")).toBeNull();
  });

  it("stages section writes without touching the draft branch until publish", async () => {
    const headBefore = stub.branchHead(REPO, view.branch);

    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Hello\n");
    await writeDoc(oxen, view, "home", {
      version: 2,
      content: [
        {
          kind: "section",
          slug: "hero",
          title: "Hero",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          linked: true,
        },
      ],
    });

    // staged content is visible in the draft view…
    expect(await readSectionVersion(oxen, view, "home", "hero", "original")).toBe("# Hello\n");
    expect((await readDoc(oxen, view, "home")).content).toHaveLength(1);
    // …but no commit happened
    expect(stub.branchHead(REPO, view.branch)).toBe(headBefore);

    await publishDraft(oxen, view, { message: "hero drafts", author: AUTHOR });
    expect(stub.branchHead(REPO, view.branch)).not.toBe(headBefore);
    expect(stub.fileAt(REPO, view.branch, "pages/home/sections/hero/original.md")).toBe("# Hello\n");
    // main untouched
    expect(stub.fileAt(REPO, "main", "pages/home/sections/hero/original.md")).toBeUndefined();
  });

  it("keeps draft views of different users isolated", async () => {
    const other = await ensureDraftView(oxen, REPO, "user-456");
    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Mine\n");

    expect(await readSectionVersion(oxen, other, "home", "hero", "original")).toBeNull();
  });

  describe("wireframe undo", () => {
    const first = `<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1></section>`;
    const second = `<section class="wf-section" data-copy="hero"><div class="wf-split"><h1 class="wf-h1" data-element="h1"></h1></div></section>`;

    it("the first layout has nothing to undo to; the next write keeps the one it replaced", async () => {
      await writeWireframe(oxen, view, "home", first);
      expect(await hasPreviousWireframe(oxen, view, "home")).toBe(false);
      expect(await undoWireframe(oxen, view, "home")).toBeNull();

      await writeWireframe(oxen, view, "home", second);
      expect(await hasPreviousWireframe(oxen, view, "home")).toBe(true);
    });

    it("undo swaps back, and undoing again redoes", async () => {
      await writeWireframe(oxen, view, "home", first);
      await writeWireframe(oxen, view, "home", second);

      expect(await undoWireframe(oxen, view, "home")).toBe(first);
      expect(await readWireframe(oxen, view, "home")).toBe(first);
      expect(await undoWireframe(oxen, view, "home")).toBe(second);
      expect(await readWireframe(oxen, view, "home")).toBe(second);
    });

    it("the undo step is scratch: it never publishes and never counts as an unpublished change", async () => {
      await writeWireframe(oxen, view, "home", first);
      await publishDraft(oxen, view, { message: "first layout", author: AUTHOR });
      expect(await hasUnpublishedChanges(oxen, view)).toBe(false);

      await writeWireframe(oxen, view, "home", second);
      await publishDraft(oxen, view, { message: "second layout", author: AUTHOR });
      expect(await hasUnpublishedChanges(oxen, view)).toBe(false);

      const files = await oxen.listDir(REPO, view.branch, "pages/home");
      expect(files.entries.map((entry) => entry.filename)).not.toContain("wireframe.prev.html");
      // publishing is the line: what came before it is history, not an undo step
      expect(await hasPreviousWireframe(oxen, view, "home")).toBe(false);
      expect(await undoWireframe(oxen, view, "home")).toBeNull();
      expect(await readWireframe(oxen, view, "home")).toBe(second);
    });
  });
});
