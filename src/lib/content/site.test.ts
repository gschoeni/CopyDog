import { describe, expect, it } from "vitest";

import {
  findPage,
  flattenPages,
  insertPageNode,
  movePageNode,
  pagePath,
  parseSiteFile,
  serializeSiteFile,
  type PageRef,
} from "./site";

/** home / about(team, history(early-days)) / pricing */
function tree(): PageRef[] {
  return [
    { slug: "home", title: "Home" },
    {
      slug: "about",
      title: "About",
      children: [
        { slug: "team", title: "Team" },
        { slug: "history", title: "History", children: [{ slug: "early-days", title: "Early days" }] },
      ],
    },
    { slug: "pricing", title: "Pricing" },
  ];
}

describe("site tree", () => {
  it("v1 flat sitemaps parse unchanged", () => {
    const site = parseSiteFile(`{"version":1,"pages":[{"slug":"home","title":"Home"}]}`);
    expect(site.pages).toEqual([{ slug: "home", title: "Home" }]);
  });

  it("nested sitemaps round-trip through serialization", () => {
    const site = { version: 1 as const, pages: tree() };
    expect(parseSiteFile(serializeSiteFile(site))).toEqual(site);
  });

  it("flattens in reading order with depths", () => {
    expect(flattenPages(tree()).map(({ page, depth }) => `${depth}:${page.slug}`)).toEqual([
      "0:home",
      "0:about",
      "1:team",
      "1:history",
      "2:early-days",
      "0:pricing",
    ]);
  });

  it("finds pages at any depth", () => {
    expect(findPage(tree(), "early-days")?.title).toBe("Early days");
    expect(findPage(tree(), "missing")).toBeUndefined();
  });

  it("traces the root→page path for breadcrumbs", () => {
    expect(pagePath(tree(), "early-days")?.map((p) => p.slug)).toEqual(["about", "history", "early-days"]);
    expect(pagePath(tree(), "home")?.map((p) => p.slug)).toEqual(["home"]);
    expect(pagePath(tree(), "missing")).toBeNull();
  });

  it("reorders within the same parent (before a later sibling)", () => {
    const pages = tree();
    expect(movePageNode(pages, "pricing", null, "home")).toBe(true);
    expect(pages.map((p) => p.slug)).toEqual(["pricing", "home", "about"]);
  });

  it("nests a page (appended) and carries its subtree along", () => {
    const pages = tree();
    expect(movePageNode(pages, "history", null, "pricing")).toBe(true);
    expect(pages.map((p) => p.slug)).toEqual(["home", "about", "history", "pricing"]);
    expect(findPage(pages, "early-days")).toBeDefined(); // subtree intact
    expect(findPage(pages, "about")?.children?.map((p) => p.slug)).toEqual(["team"]);
  });

  it("moves a top-level page into a parent", () => {
    const pages = tree();
    expect(movePageNode(pages, "pricing", "about", "history")).toBe(true);
    expect(findPage(pages, "about")?.children?.map((p) => p.slug)).toEqual(["team", "pricing", "history"]);
  });

  it("unnests back to the top level", () => {
    const pages = tree();
    expect(movePageNode(pages, "team", null, null)).toBe(true);
    expect(pages.map((p) => p.slug)).toEqual(["home", "about", "pricing", "team"]);
  });

  it("refuses to drop a page into its own subtree", () => {
    const pages = tree();
    expect(movePageNode(pages, "about", "history", null)).toBe(false);
    expect(movePageNode(pages, "about", "about", null)).toBe(false);
    expect(pages).toEqual(tree()); // untouched
  });

  it("refuses unknown slugs", () => {
    const pages = tree();
    expect(movePageNode(pages, "missing", null, null)).toBe(false);
    expect(movePageNode(pages, "home", "missing", null)).toBe(false);
  });

  it("drops an emptied children array so the file stays clean", () => {
    const pages: PageRef[] = [{ slug: "a", title: "A", children: [{ slug: "b", title: "B" }] }];
    movePageNode(pages, "b", null, null);
    expect(pages[0]).toEqual({ slug: "a", title: "A" });
  });

  it("inserts new pages at top level or under a parent", () => {
    const pages = tree();
    expect(insertPageNode(pages, { slug: "faq", title: "FAQ" }, "team")).toBe(true);
    expect(findPage(pages, "team")?.children?.map((p) => p.slug)).toEqual(["faq"]);
    expect(insertPageNode(pages, { slug: "blog", title: "Blog" }, null)).toBe(true);
    expect(pages.at(-1)?.slug).toBe("blog");
    expect(insertPageNode(pages, { slug: "x", title: "X" }, "missing")).toBe(false);
  });
});
