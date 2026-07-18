import "server-only";

import type { OxenClient } from "@/lib/oxen/client";

import { flattenPages, insertPageNode } from "./site";
import { readSite, writeDoc, writeSite, type DraftView } from "./store";

/**
 * Adds a page (empty doc + sitemap entry) to the user's draft. Shared by the
 * add-page server action and the MCP add_page tool. Returns the new slug.
 */
export async function addPage(
  oxen: OxenClient,
  view: DraftView,
  title: string,
  parentSlug?: string | null,
): Promise<{ slug: string }> {
  const site = await readSite(oxen, view);
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page";
  // slugs are page directories — unique across the whole tree
  const taken = new Set(flattenPages(site.pages).map(({ page }) => page.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

  if (!insertPageNode(site.pages, { slug, title }, parentSlug ?? null)) {
    throw new Error(`parent page "${parentSlug}" not found`);
  }
  await writeSite(oxen, view, site);
  await writeDoc(oxen, view, slug, { version: 2, content: [] });

  return { slug };
}
