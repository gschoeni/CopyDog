import { z } from "zod";

/**
 * `pages/{page}/doc.json` — the structure of a page's copy document:
 * section order, the alternate versions of each section, which version is
 * active, and how sections bind to wireframe slots. The markdown itself
 * lives in the section version files; this file is structure only.
 *
 * In a user's draft view this file is *their* copy (workspace/branch), so
 * `activeVersion` is naturally per-user. On `main` it is the project's
 * canonical choice — promoting copy is a change to this file, which makes
 * the decision trail itself versioned.
 */

export const sectionVersionRefSchema = z.object({
  /** file basename under sections/{section}/ (without .md) */
  slug: z.string().min(1),
  /** human label shown in the version switcher ("Punchy", "Benefit-led") */
  label: z.string().min(1),
});

export const docSectionSchema = z.object({
  /** stable id, also the directory name under sections/ */
  slug: z.string().min(1),
  /** human label shown in the editor ("Hero", "Features") */
  title: z.string().min(1),
  /** version slug (file basename without .md) that is active in this view */
  activeVersion: z.string().min(1),
  /** all known versions of this section in this view */
  versions: z.array(sectionVersionRefSchema).default([]),
  /** id of the wireframe slot this section fills; null until linked */
  wireframeSlot: z.string().nullable(),
});

export const docFileSchema = z.object({
  version: z.literal(1),
  sections: z.array(docSectionSchema),
});

export type SectionVersionRef = z.infer<typeof sectionVersionRefSchema>;
export type DocSection = z.infer<typeof docSectionSchema>;
export type DocFile = z.infer<typeof docFileSchema>;

export function emptyDoc(): DocFile {
  return { version: 1, sections: [] };
}

export function parseDocFile(content: string): DocFile {
  const doc = docFileSchema.parse(JSON.parse(content));
  // older docs listed no versions — the active one is the only version
  for (const section of doc.sections) {
    if (section.versions.length === 0) {
      section.versions = [{ slug: section.activeVersion, label: "Original" }];
    }
  }
  return doc;
}

export function serializeDocFile(doc: DocFile): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
