import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProjectAccess } from "@/lib/content/access";
import { readDoc, readSectionVersion, readSite } from "@/lib/content/store";
import { parseSectionMarkdown } from "@/lib/copy/markdown";

import { PageEditor, type EditorSection } from "./page-editor";
import { PagesSidebar } from "./pages-sidebar";

/**
 * The copy editor. Everything shown is the signed-in user's draft view:
 * their Oxen workspace over their draft branch.
 */
export default async function PageEditorRoute({
  params,
}: {
  params: Promise<{ projectId: string; pageSlug: string }>;
}) {
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
  const sections: EditorSection[] = await Promise.all(
    doc.sections.map(async (section) => {
      const markdown = await readSectionVersion(oxen, view, pageSlug, section.slug, section.activeVersion);
      return { ...section, blocks: parseSectionMarkdown(markdown ?? "") };
    }),
  );

  return (
    <div className="flex min-h-0 flex-1">
      <PagesSidebar projectId={project.id} projectName={project.name} pages={site.pages} activeSlug={pageSlug} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="border-b border-border px-6 py-3">
          <nav className="text-xs text-ink-tertiary">
            <Link href="/projects" className="hover:text-ink">
              Projects
            </Link>
            <span className="mx-1.5">/</span>
            <Link href={`/projects/${project.id}`} className="hover:text-ink">
              {project.name}
            </Link>
            <span className="mx-1.5">/</span>
            <span className="text-ink-secondary">{page.title}</span>
          </nav>
        </div>
        <PageEditor projectId={project.id} pageSlug={pageSlug} initialSections={sections} />
      </div>
    </div>
  );
}
