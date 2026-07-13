import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import {
  ensureDraftView,
  publishDraft,
  readDoc,
  readSectionVersion,
  readSite,
  writeDoc,
  writeSectionVersion,
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
    expect(doc.sections).toEqual([]);
  });

  it("returns null for a section version that does not exist", async () => {
    expect(await readSectionVersion(oxen, view, "home", "hero", "original")).toBeNull();
  });

  it("stages section writes without touching the draft branch until publish", async () => {
    const headBefore = stub.branchHead(REPO, view.branch);

    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Hello\n");
    await writeDoc(oxen, view, "home", {
      version: 1,
      sections: [
        {
          slug: "hero",
          title: "Hero",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          wireframeSlot: null,
          pinned: false,
        },
      ],
    });

    // staged content is visible in the draft view…
    expect(await readSectionVersion(oxen, view, "home", "hero", "original")).toBe("# Hello\n");
    expect((await readDoc(oxen, view, "home")).sections).toHaveLength(1);
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
});
