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

export const pageRefSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
});

export const siteFileSchema = z.object({
  version: z.literal(1),
  pages: z.array(pageRefSchema),
});

export type PageRef = z.infer<typeof pageRefSchema>;
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
