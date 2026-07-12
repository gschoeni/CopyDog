import { z } from "zod";

/**
 * `pages/{page}/doc.json` — the structure of a page's copy document:
 * section order, which copy version is canonically active, and how sections
 * bind to wireframe slots. The markdown itself lives in the section version
 * files; this file is structure only.
 */

export const docSectionSchema = z.object({
  /** stable id, also the directory name under sections/ */
  slug: z.string().min(1),
  /** human label shown in the editor ("Hero", "Features") */
  title: z.string().min(1),
  /** version slug (file basename without .md) that is canonically active */
  activeVersion: z.string().min(1),
  /** id of the wireframe slot this section fills; null until linked */
  wireframeSlot: z.string().nullable(),
});

export const docFileSchema = z.object({
  version: z.literal(1),
  sections: z.array(docSectionSchema),
});

export type DocSection = z.infer<typeof docSectionSchema>;
export type DocFile = z.infer<typeof docFileSchema>;

export function emptyDoc(): DocFile {
  return { version: 1, sections: [] };
}

export function parseDocFile(content: string): DocFile {
  return docFileSchema.parse(JSON.parse(content));
}

export function serializeDocFile(doc: DocFile): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
