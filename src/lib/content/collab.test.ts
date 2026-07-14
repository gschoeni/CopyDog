import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import type { DocFile } from "./doc";

import {
  adoptVersion,
  applyBranchToMain,
  compareRevisions,
  ensureDraftView,
  hasUnpublishedChanges,
  publishDraft,
  replaceDoc,
  syncPageFromMain,
  writeDoc,
  writeElementsRun,
  writeSectionVersion,
  type DraftView,
} from "./store";

const AUTHOR = { name: "alice", email: "alice@copydog.app" };
const REPO = "collab-x1";

const heroSection = (versions: string[]): DocFile["content"][number] => ({
  kind: "section",
  slug: "hero",
  title: "Hero",
  activeVersion: versions[0]!,
  versions: versions.map((slug) => ({ slug, label: slug })),
  linked: true,
});

describe("collaboration flows (publish / adopt / merge / sync)", () => {
  let stub: OxenStub;
  let oxen: OxenClient;
  let alice: DraftView;
  let bob: DraftView;

  beforeEach(async () => {
    stub = new OxenStub();
    oxen = new OxenClient({
      token: "t",
      namespace: "ns",
      baseUrl: "https://stub.oxen.local",
      fetchImpl: stub.fetch,
    });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    alice = await ensureDraftView(oxen, REPO, "alice");
    bob = await ensureDraftView(oxen, REPO, "bob");
  });

  it("unpublished-changes flag flips with edits and publishes", async () => {
    expect(await hasUnpublishedChanges(oxen, alice)).toBe(false);
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Draft\n");
    expect(await hasUnpublishedChanges(oxen, alice)).toBe(true);
    await publishDraft(oxen, alice, { message: "publish", author: AUTHOR });
    expect(await hasUnpublishedChanges(oxen, alice)).toBe(false);
  });

  it("bob adopts alice's published version as a file copy", async () => {
    await writeSectionVersion(oxen, alice, "home", "hero", "punchy", "# Alice's take\n");
    await publishDraft(oxen, alice, { message: "hero punchy", author: AUTHOR });

    const markdown = await adoptVersion(oxen, bob, {
      fromBranch: alice.branch,
      pageSlug: "home",
      sectionSlug: "hero",
      versionSlug: "punchy",
      asVersionSlug: "alice-punchy",
    });
    expect(markdown).toBe("# Alice's take\n");

    // it's bob's own copy now, in his workspace only
    expect(await hasUnpublishedChanges(oxen, bob)).toBe(true);
    expect(stub.fileAt(REPO, bob.branch, "pages/home/sections/hero/alice-punchy.md")).toBeUndefined();
  });

  it("compareRevisions reports content differences between branches", async () => {
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# New hero\n");
    await publishDraft(oxen, alice, { message: "hero", author: AUTHOR });

    const { changed } = await compareRevisions(oxen, REPO, alice.branch, "main");
    expect([...changed.keys()]).toEqual(["pages/home/sections/hero/original.md"]);
    expect(changed.get("pages/home/sections/hero/original.md")).toEqual({
      source: "# New hero\n",
      target: null,
    });
  });

  it("applyBranchToMain squash-applies the proposal and syncs another user", async () => {
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Approved copy\n");
    await publishDraft(oxen, alice, { message: "hero", author: AUTHOR });

    const mergedCommit = await applyBranchToMain(oxen, REPO, alice.branch, {
      message: "Merge proposal: hero copy",
      author: AUTHOR,
    });
    expect(stub.branchHead(REPO, "main")).toBe(mergedCommit);
    expect(stub.fileAt(REPO, "main", "pages/home/sections/hero/original.md")).toBe("# Approved copy\n");

    // bob pulls main into his draft page
    await syncPageFromMain(oxen, bob, "home");
    const bobView = await oxen.readWorkspaceFile(REPO, bob.workspaceId, "pages/home/sections/hero/original.md");
    expect(bobView).toBe("# Approved copy\n");
  });

  it("applyBranchToMain refuses an empty merge", async () => {
    await expect(
      applyBranchToMain(oxen, REPO, alice.branch, { message: "empty", author: AUTHOR }),
    ).rejects.toThrow("nothing to merge");
  });

  it("publish prunes committed files no doc references, but never staged ones", async () => {
    // commit a referenced section + a loose run
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Hero\n");
    await writeElementsRun(oxen, alice, "home", "run-0", "Loose line.\n");
    await writeDoc(oxen, alice, "home", {
      version: 2,
      content: [heroSection(["original"]), { kind: "elements", slug: "run-0" }],
    });
    await publishDraft(oxen, alice, { message: "v1", author: AUTHOR });
    expect(stub.fileAt(REPO, alice.branch, "pages/home/elements/run-0.md")).toBe("Loose line.\n");

    // the run and section leave the doc; a brand-new (staged) write appears
    await writeDoc(oxen, alice, "home", { version: 2, content: [] });
    await writeSectionVersion(oxen, alice, "home", "fresh", "original", "# Just written\n");
    await publishDraft(oxen, alice, { message: "v2", author: AUTHOR });

    // committed orphans died; the staged-but-unreferenced write survived
    expect(stub.fileAt(REPO, alice.branch, "pages/home/elements/run-0.md")).toBeUndefined();
    expect(stub.fileAt(REPO, alice.branch, "pages/home/sections/hero/original.md")).toBeUndefined();
    expect(stub.fileAt(REPO, alice.branch, "pages/home/sections/fresh/original.md")).toBe("# Just written\n");
  });

  it("merging a proposal propagates file deletions to main", async () => {
    // main knows the hero section
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Hero\n");
    await writeDoc(oxen, alice, "home", { version: 2, content: [heroSection(["original"])] });
    await publishDraft(oxen, alice, { message: "add hero", author: AUTHOR });
    await applyBranchToMain(oxen, REPO, alice.branch, { message: "merge hero", author: AUTHOR });
    expect(stub.fileAt(REPO, "main", "pages/home/sections/hero/original.md")).toBe("# Hero\n");

    // alice deletes the section and publishes (prune removes the file)
    await writeDoc(oxen, alice, "home", { version: 2, content: [] });
    await publishDraft(oxen, alice, { message: "drop hero", author: AUTHOR });
    await applyBranchToMain(oxen, REPO, alice.branch, { message: "merge drop", author: AUTHOR });
    expect(stub.fileAt(REPO, "main", "pages/home/sections/hero/original.md")).toBeUndefined();
  });

  it("replaceDoc prunes content files the new structure dropped", async () => {
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Old\n");
    await writeElementsRun(oxen, alice, "home", "run-0", "Old loose.\n");
    await writeDoc(oxen, alice, "home", {
      version: 2,
      content: [heroSection(["original"]), { kind: "elements", slug: "run-0" }],
    });

    await writeSectionVersion(oxen, alice, "home", "imported", "original", "# New\n");
    await replaceDoc(oxen, alice, "home", {
      version: 2,
      content: [
        { kind: "section", slug: "imported", title: "New", activeVersion: "original", versions: [{ slug: "original", label: "Original" }], linked: true },
      ],
    });

    await expect(oxen.readWorkspaceFile(REPO, alice.workspaceId, "pages/home/sections/hero/original.md")).rejects.toThrow();
    await expect(oxen.readWorkspaceFile(REPO, alice.workspaceId, "pages/home/elements/run-0.md")).rejects.toThrow();
    expect(await oxen.readWorkspaceFile(REPO, alice.workspaceId, "pages/home/sections/imported/original.md")).toBe("# New\n");
  });

  it("syncPageFromMain drops draft-only content main doesn't know", async () => {
    // main gets a hero page
    await writeSectionVersion(oxen, alice, "home", "hero", "original", "# Approved\n");
    await writeDoc(oxen, alice, "home", { version: 2, content: [heroSection(["original"])] });
    await publishDraft(oxen, alice, { message: "hero", author: AUTHOR });
    await applyBranchToMain(oxen, REPO, alice.branch, { message: "merge", author: AUTHOR });

    // bob drafts an extra section main never saw, then resets the page
    await writeSectionVersion(oxen, bob, "home", "experiment", "original", "# Scrapped\n");
    await writeDoc(oxen, bob, "home", {
      version: 2,
      content: [
        heroSection(["original"]),
        { kind: "section", slug: "experiment", title: "X", activeVersion: "original", versions: [{ slug: "original", label: "Original" }], linked: true },
      ],
    });
    await syncPageFromMain(oxen, bob, "home");

    expect(await oxen.readWorkspaceFile(REPO, bob.workspaceId, "pages/home/sections/hero/original.md")).toBe("# Approved\n");
    await expect(oxen.readWorkspaceFile(REPO, bob.workspaceId, "pages/home/sections/experiment/original.md")).rejects.toThrow();
  });
});
