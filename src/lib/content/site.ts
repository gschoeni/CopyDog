import { z } from "zod";

/**
 * Canonical content file formats stored in a project's Oxen repo.
 * These are versioned artifacts — change them additively and bump `version`.
 *
 * Repo layout:
 *   site.json                          — sitemap (this file)
 *   pages/{page}/doc.json              — ordered content (element runs + sections)
 *   pages/{page}/wireframe.html        — greyscale layout with copy slots
 *   pages/{page}/elements/{run}.md     — loose copy runs
 *   pages/{page}/sections/{section}/{version}.md — section version files
 */

/**
 * The sitemap is a tree: pages nest as subpages to any depth. Nesting is
 * purely structural (navigation and ordering) — page content always lives
 * flat at pages/{slug}/, and slugs stay unique across the whole site.
 * `children` is additive, so v1 flat sitemaps parse unchanged.
 */
export interface PageRef {
  slug: string;
  title: string;
  children?: PageRef[];
}

export const pageRefSchema: z.ZodType<PageRef> = z.lazy(() =>
  z.object({
    slug: z.string().min(1),
    title: z.string().min(1),
    children: z.array(pageRefSchema).optional(),
  }),
);

export const siteFileSchema = z.object({
  version: z.literal(1),
  pages: z.array(pageRefSchema),
});

export type SiteFile = z.infer<typeof siteFileSchema>;

export const SITE_FILE_PATH = "site.json";

export function emptySite(): SiteFile {
  return { version: 1, pages: [{ slug: "home", title: "Home" }] };
}

export function parseSiteFile(content: string): SiteFile {
  return siteFileSchema.parse(JSON.parse(content));
}

export function serializeSiteFile(site: SiteFile): string {
  return JSON.stringify(site, null, 2) + "\n";
}

/** Every page in reading order (pre-order), with its nesting depth. */
export function flattenPages(pages: PageRef[], depth = 0): { page: PageRef; depth: number }[] {
  return pages.flatMap((page) => [{ page, depth }, ...flattenPages(page.children ?? [], depth + 1)]);
}

export function findPage(pages: PageRef[], slug: string): PageRef | undefined {
  return flattenPages(pages).find(({ page }) => page.slug === slug)?.page;
}

/** Detaches the slug's node (subtree included) from the tree; returns it. */
function detachPage(pages: PageRef[], slug: string): PageRef | null {
  const index = pages.findIndex((page) => page.slug === slug);
  if (index !== -1) return pages.splice(index, 1)[0]!;
  for (const page of pages) {
    const found = page.children && detachPage(page.children, slug);
    if (found) {
      if (page.children!.length === 0) delete page.children;
      return found;
    }
  }
  return null;
}

/**
 * Moves a page (with its subtree) to a new position, mutating the tree:
 * under `parentSlug` (null = top level), before the `beforeSlug` sibling
 * (null = append). Returns false — leaving the tree untouched — when the
 * move is impossible: unknown slugs, or a page dropped into its own subtree.
 */
export function movePageNode(
  pages: PageRef[],
  slug: string,
  parentSlug: string | null,
  beforeSlug: string | null,
): boolean {
  if (slug === parentSlug || slug === beforeSlug) return false;
  const moving = findPage(pages, slug);
  if (!moving) return false;
  // a page can't become its own descendant
  if (parentSlug !== null && (moving.children ?? []).length > 0 && findPage(moving.children!, parentSlug)) return false;
  if (parentSlug !== null && !findPage(pages, parentSlug)) return false;

  const detached = detachPage(pages, slug)!;
  const siblings = parentSlug === null ? pages : (findPage(pages, parentSlug)!.children ??= []);
  const at = beforeSlug === null ? siblings.length : siblings.findIndex((page) => page.slug === beforeSlug);
  siblings.splice(at === -1 ? siblings.length : at, 0, detached);
  return true;
}

/** Inserts a new page under `parentSlug` (null = top level, appended). */
export function insertPageNode(pages: PageRef[], node: PageRef, parentSlug: string | null): boolean {
  if (parentSlug === null) {
    pages.push(node);
    return true;
  }
  const parent = findPage(pages, parentSlug);
  if (!parent) return false;
  (parent.children ??= []).push(node);
  return true;
}

export function pageDocPath(pageSlug: string): string {
  return `pages/${pageSlug}/doc.json`;
}

export function pageWireframePath(pageSlug: string): string {
  return `pages/${pageSlug}/wireframe.html`;
}

export function sectionVersionPath(pageSlug: string, sectionSlug: string, versionSlug: string): string {
  return `pages/${pageSlug}/sections/${sectionSlug}/${versionSlug}.md`;
}

export function elementsRunPath(pageSlug: string, runSlug: string): string {
  return `pages/${pageSlug}/elements/${runSlug}.md`;
}
