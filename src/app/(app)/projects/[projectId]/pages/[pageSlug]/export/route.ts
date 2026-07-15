import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";

import { ContentStoreUnavailableError, requireProjectAccess } from "@/lib/content/access";
import { docSections } from "@/lib/content/doc";
import { findPage } from "@/lib/content/site";
import { readDoc, readSectionVersion, readSite, readWireframe } from "@/lib/content/store";
import { parseElementsMarkdown } from "@/lib/copy/markdown";
import { generateWireframeHeuristic } from "@/lib/wireframe/heuristic";
import { exportPageHtml } from "@/lib/wireframe/export";
import { sanitizeWireframeHtml } from "@/lib/wireframe/sanitize";

/**
 * Downloads the page as a standalone HTML document — the user's draft view
 * with their active copy. Pages without a wireframe get the rule-based
 * layout so the export always works.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageSlug: string }> },
) {
  const { projectId, pageSlug } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId);
  } catch (err) {
    if (err instanceof ContentStoreUnavailableError) throw err; // infra, not a 404
    notFound();
  }
  const { oxen, view, project } = access;

  const site = await readSite(oxen, view);
  const page = findPage(site.pages, pageSlug);
  if (!page) notFound();

  const doc = await readDoc(oxen, view, pageSlug);
  const sections = await Promise.all(
    docSections(doc)
      .filter((section) => section.linked)
      .map(async (section) => ({
      slug: section.slug,
      title: section.title,
      elements: parseElementsMarkdown(
        (await readSectionVersion(oxen, view, pageSlug, section.slug, section.activeVersion)) ?? "",
      ),
    })),
  );

  const wireframeHtml =
    (await readWireframe(oxen, view, pageSlug)) ?? sanitizeWireframeHtml(generateWireframeHeuristic(sections));

  const html = exportPageHtml({ title: `${project.name} — ${page.title}`, wireframeHtml, sections });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${project.slug}-${pageSlug}.html"`,
    },
  });
}
