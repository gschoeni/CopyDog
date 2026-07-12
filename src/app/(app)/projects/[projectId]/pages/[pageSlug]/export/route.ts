import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";

import { requireProjectAccess } from "@/lib/content/access";
import { readDoc, readSectionVersion, readSite, readWireframe } from "@/lib/content/store";
import { parseSectionMarkdown } from "@/lib/copy/markdown";
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
  } catch {
    notFound();
  }
  const { oxen, view, project } = access;

  const site = await readSite(oxen, view);
  const page = site.pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  const doc = await readDoc(oxen, view, pageSlug);
  const sections = await Promise.all(
    doc.sections.map(async (section) => ({
      slug: section.slug,
      title: section.title,
      blocks: parseSectionMarkdown(
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
