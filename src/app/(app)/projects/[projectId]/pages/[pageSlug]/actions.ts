"use server";

import { z } from "zod";

import { docSectionSchema } from "@/lib/content/doc";
import { requireProjectAccess } from "@/lib/content/access";
import { readSite, writeDoc, writeSectionVersion } from "@/lib/content/store";
import { SITE_FILE_PATH, serializeSiteFile } from "@/lib/content/site";

/**
 * Editor autosave actions. All writes land in the calling user's Oxen
 * workspace — private, uncommitted, conflict-free by construction.
 * Postgres is untouched: document structure is content, and content
 * lives in Oxen.
 */

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

const saveSectionInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sectionSlug: slugSchema,
  versionSlug: slugSchema,
  markdown: z.string().max(100_000),
});

export async function saveSectionAction(input: z.infer<typeof saveSectionInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug, sectionSlug, versionSlug, markdown } = saveSectionInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  await writeSectionVersion(oxen, view, pageSlug, sectionSlug, versionSlug, markdown);
  return { ok: true };
}

const saveStructureInput = z.object({
  projectId: z.uuid(),
  pageSlug: slugSchema,
  sections: z.array(docSectionSchema).max(200),
});

/** Persists section order/titles/active-versions (doc.json) for a page. */
export async function saveStructureAction(input: z.infer<typeof saveStructureInput>): Promise<{ ok: boolean }> {
  const { projectId, pageSlug, sections } = saveStructureInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);
  await writeDoc(oxen, view, pageSlug, { version: 1, sections });
  return { ok: true };
}

const addPageInput = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(80),
});

export async function addPageAction(input: z.infer<typeof addPageInput>): Promise<{ slug: string }> {
  const { projectId, title } = addPageInput.parse(input);
  const { oxen, view } = await requireProjectAccess(projectId);

  const site = await readSite(oxen, view);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
  let slug = base;
  for (let n = 2; site.pages.some((p) => p.slug === slug); n++) slug = `${base}-${n}`;

  site.pages.push({ slug, title });
  await oxen.writeWorkspaceFile(view.repo, view.workspaceId, SITE_FILE_PATH, serializeSiteFile(site));
  await writeDoc(oxen, view, slug, { version: 1, sections: [] });

  return { slug };
}
