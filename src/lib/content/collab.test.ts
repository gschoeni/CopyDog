import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import {
  adoptVersion,
  applyBranchToMain,
  compareRevisions,
  ensureDraftView,
  hasUnpublishedChanges,
  publishDraft,
  syncPageFromMain,
  writeSectionVersion,
  type DraftView,
} from "./store";

const AUTHOR = { name: "alice", email: "alice@copydog.app" };
const REPO = "collab-x1";

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
});
