import "server-only";

import type { OxenClient } from "@/lib/oxen/client";
import { slugify } from "@/lib/slug";

import { findPage, flattenPages, insertPageNode, removePageNode } from "./site";
import { deletePageFiles, readSite, writeDoc, writeSite, type DraftView } from "./store";

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
  // one slug algorithm across the app (NFKD-normalized), shared with projects
  const base = slugify(title);
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

/**
 * Refusals carry a sentence the UI can show verbatim, so the guard lives here
 * (with the sitemap) rather than being re-stated by every caller.
 */
export type DeletePageResult = { ok: true; removed: string[] } | { ok: false; error: string };

/**
 * Deletes a page and everything nested under it from the user's draft: the
 * sitemap entry plus each page's content files. Staged like every other edit,
 * so it isn't real for teammates until publish. Shared by the delete-page
 * server action and any future MCP tool.
 */
export async function deletePage(oxen: OxenClient, view: DraftView, slug: string): Promise<DeletePageResult> {
  const site = await readSite(oxen, view);
  const target = findPage(site.pages, slug);
  if (!target) return { ok: false, error: "That page is already gone." };

  const removed = flattenPages([target]).map(({ page }) => page.slug);
  // a site with no pages has no route to land on — the last page stays
  if (removed.length === flattenPages(site.pages).length) {
    return { ok: false, error: "A site needs at least one page." };
  }

  // sitemap first: it decides what exists, so a half-finished cleanup leaves
  // stray blobs on the branch rather than a page whose content is missing
  removePageNode(site.pages, slug);
  await writeSite(oxen, view, site);
  try {
    await deletePageFiles(oxen, view, removed);
  } catch (err) {
    console.warn(`page ${slug} left the sitemap but some of its files remain`, err);
  }

  return { ok: true, removed };
}
