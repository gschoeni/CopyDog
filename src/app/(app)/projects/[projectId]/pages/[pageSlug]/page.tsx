import { notFound } from "next/navigation";

import { requireProjectAccess } from "@/lib/content/access";
import { readDoc, readSectionVersion, readSite, readWireframe } from "@/lib/content/store";
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
  const [wireframe, sections] = await Promise.all([
    readWireframe(oxen, view, pageSlug),
    Promise.all(
      doc.sections.map(async (section): Promise<EditorSection> => {
        const markdown = await readSectionVersion(oxen, view, pageSlug, section.slug, section.activeVersion);
        return { ...section, blocks: parseSectionMarkdown(markdown ?? "") };
      }),
    ),
  ]);

  return (
    <div className="flex min-h-0 flex-1">
      <PagesSidebar projectId={project.id} projectName={project.name} pages={site.pages} activeSlug={pageSlug} />
      <PageEditor
        // fingerprint key: router.refresh() after an import remounts the
        // editor with the new server content instead of stale client state
        key={fingerprint(JSON.stringify(sections) + (wireframe ?? ""))}
        projectId={project.id}
        projectName={project.name}
        pageSlug={pageSlug}
        pageTitle={page.title}
        initialSections={sections}
        initialWireframe={wireframe}
      />
    </div>
  );
}

function fingerprint(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
