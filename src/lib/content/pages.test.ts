import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import { addPage, deletePage } from "./pages";
import { flattenPages } from "./site";
import {
  ensureDraftView,
  publishDraft,
  readSite,
  writeSectionVersion,
  writeWireframe,
  type DraftView,
} from "./store";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };
const USER_ID = "user-123";
const REPO = "acme-x1";

describe("page delete", () => {
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

  const slugs = async () => flattenPages((await readSite(oxen, view)).pages).map(({ page }) => page.slug);

  it("removes the page and its subpages from the sitemap", async () => {
    await addPage(oxen, view, "About");
    await addPage(oxen, view, "Team", "about");
    await addPage(oxen, view, "Pricing");
    expect(await slugs()).toEqual(["home", "about", "team", "pricing"]);

    const result = await deletePage(oxen, view, "about");
    expect(result).toEqual({ ok: true, removed: ["about", "team"] });
    expect(await slugs()).toEqual(["home", "pricing"]);
  });

  it("takes the page's content files with it, published or still staged", async () => {
    await addPage(oxen, view, "About");
    await writeSectionVersion(oxen, view, "about", "hero", "original", "# Hi\n");
    await writeWireframe(oxen, view, "about", "<main></main>");
    await publishDraft(oxen, view, { message: "about", author: AUTHOR });
    expect(stub.fileAt(REPO, view.branch, "pages/about/sections/hero/original.md")).toBe("# Hi\n");

    // a second section that only exists in the workspace, never committed
    await writeSectionVersion(oxen, view, "about", "cta", "original", "# Buy\n");

    expect(await deletePage(oxen, view, "about")).toMatchObject({ ok: true });
    await publishDraft(oxen, view, { message: "delete about", author: AUTHOR });

    for (const path of [
      "pages/about/doc.json",
      "pages/about/wireframe.html",
      "pages/about/sections/hero/original.md",
      "pages/about/sections/cta/original.md",
    ]) {
      expect(stub.fileAt(REPO, view.branch, path)).toBeUndefined();
    }
    // the surviving page is untouched
    expect(stub.fileAt(REPO, view.branch, "pages/home/doc.json")).toBeDefined();
  });

  it("refuses to delete the last page", async () => {
    expect(await deletePage(oxen, view, "home")).toEqual({ ok: false, error: "A site needs at least one page." });
    expect(await slugs()).toEqual(["home"]);
  });

  it("refuses when the whole tree would go with it", async () => {
    await addPage(oxen, view, "Team", "home");
    expect(await deletePage(oxen, view, "home")).toMatchObject({ ok: false });
    expect(await slugs()).toEqual(["home", "team"]);
  });

  it("reports an unknown slug instead of throwing", async () => {
    await addPage(oxen, view, "About");
    expect(await deletePage(oxen, view, "missing")).toEqual({ ok: false, error: "That page is already gone." });
  });
});
