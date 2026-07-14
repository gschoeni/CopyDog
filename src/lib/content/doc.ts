import { z } from "zod";

/**
 * `pages/{page}/doc.json` — the structure of a page's copy document.
 *
 * A page is an ordered mix of **element runs** (loose copy — the default
 * as you write) and **sections** (deliberate, named groups of elements).
 * The markdown itself lives in files; this file is structure only:
 *
 *   pages/{page}/elements/{slug}.md            — a loose run's copy
 *   pages/{page}/sections/{slug}/{version}.md  — a section version's copy
 *
 * Sections carry versions and a `linked` flag: linked sections are
 * layout-ready and appear in the wireframe; unlinked ones stay grouped and
 * versioned but out of the layout. In a user's draft view this file is
 * *their* copy, so `activeVersion` is naturally per-user; on `main` it is
 * the project's canonical choice.
 */

export const sectionVersionRefSchema = z.object({
  /** file basename under sections/{section}/ (without .md) */
  slug: z.string().min(1),
  /** human label shown in the version switcher ("Punchy", "Benefit-led") */
  label: z.string().min(1),
});

export const docSectionSchema = z.object({
  kind: z.literal("section"),
  /** stable id, also the directory name under sections/ */
  slug: z.string().min(1),
  /** human label shown in the editor ("Hero", "Features") */
  title: z.string().min(1),
  /** version slug (file basename without .md) that is active in this view */
  activeVersion: z.string().min(1),
  /** all known versions of this section in this view */
  versions: z.array(sectionVersionRefSchema).default([]),
  /** linked sections are layout-ready: the wireframe renders them */
  linked: z.boolean().default(true),
});

export const docElementsSchema = z.object({
  kind: z.literal("elements"),
  /** file basename under elements/ (without .md) */
  slug: z.string().min(1),
});

export const docContentSchema = z.discriminatedUnion("kind", [docSectionSchema, docElementsSchema]);

export const docFileSchema = z.object({
  version: z.literal(2),
  content: z.array(docContentSchema),
});

export type SectionVersionRef = z.infer<typeof sectionVersionRefSchema>;
export type DocSection = z.infer<typeof docSectionSchema>;
export type DocElements = z.infer<typeof docElementsSchema>;
export type DocContent = z.infer<typeof docContentSchema>;
export type DocFile = z.infer<typeof docFileSchema>;

export function emptyDoc(): DocFile {
  return { version: 2, content: [] };
}

/** v1 docs listed sections only — they parse as all-section content. */
const legacySectionSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  activeVersion: z.string().min(1),
  versions: z.array(sectionVersionRefSchema).default([]),
});

const legacyDocSchema = z.object({
  version: z.literal(1),
  sections: z.array(legacySectionSchema.passthrough()),
});

export function parseDocFile(content: string): DocFile {
  const raw: unknown = JSON.parse(content);
  if (typeof raw === "object" && raw !== null && (raw as { version?: number }).version === 1) {
    const legacy = legacyDocSchema.parse(raw);
    return {
      version: 2,
      content: legacy.sections.map((section) => ({
        kind: "section" as const,
        slug: section.slug,
        title: section.title,
        activeVersion: section.activeVersion,
        versions: section.versions.length > 0 ? section.versions : [{ slug: section.activeVersion, label: "Original" }],
        linked: true,
      })),
    };
  }
  return docFileSchema.parse(raw);
}

export function serializeDocFile(doc: DocFile): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

export function docSections(doc: DocFile): DocSection[] {
  return doc.content.filter((c): c is DocSection => c.kind === "section");
}
