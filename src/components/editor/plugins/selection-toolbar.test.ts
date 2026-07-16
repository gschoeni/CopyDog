import { describe, expect, it } from "vitest";

import type { PageLinkOption } from "@/lib/content/site";

import { buildLinkSuggestions } from "./selection-toolbar";

const pages: PageLinkOption[] = [
  { slug: "about", title: "About", breadcrumbs: ["About"], href: "/about" },
  { slug: "team", title: "Team", breadcrumbs: ["About", "Team"], href: "/team" },
  { slug: "pricing", title: "Pricing", breadcrumbs: ["Pricing"], href: "/pricing" },
];

describe("link autocomplete", () => {
  it("finds nested pages by title, breadcrumb, or relative path", () => {
    expect(buildLinkSuggestions(pages, "team")).toEqual([
      {
        kind: "page",
        key: "page:team",
        href: "/team",
        title: "Team",
        detail: "About / Team · /team",
      },
    ]);
    expect(buildLinkSuggestions(pages, "/about").map((suggestion) => suggestion.href)).toEqual(["/about"]);
  });

  it("offers a valid HTTP(S) URL as the first completion", () => {
    expect(buildLinkSuggestions(pages, "https://copydog.app/docs")[0]).toEqual({
      kind: "url",
      key: "url:https://copydog.app/docs",
      href: "https://copydog.app/docs",
      title: "https://copydog.app/docs",
      detail: "External web address",
    });
    expect(buildLinkSuggestions(pages, "https://")).toEqual([]);
  });

  it("shows project pages before the writer starts filtering", () => {
    expect(buildLinkSuggestions(pages, "").map((suggestion) => suggestion.href)).toEqual([
      "/about",
      "/team",
      "/pricing",
    ]);
  });
});
