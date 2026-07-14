import { notFound } from "next/navigation";

import { requireProjectAccess } from "@/lib/content/access";
import {
  hasUnpublishedChanges,
  readDoc,
  readSectionVersion,
  readSite,
  readWireframe,
} from "@/lib/content/store";
import { parseSectionMarkdown } from "@/lib/copy/markdown";

import { createClient } from "@/lib/supabase/server";

import { PageEditor, type EditorSection } from "./page-editor";
import { PagesSidebar, type SidebarMember } from "./pages-sidebar";

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

  const supabase = await createClient();
  const doc = await readDoc(oxen, view, pageSlug);
  const [wireframe, dirty, { data: memberRows }, { count: openProposals }, sections] = await Promise.all([
    readWireframe(oxen, view, pageSlug),
    hasUnpublishedChanges(oxen, view),
    supabase.from("project_members").select("user_id, role, profile:profiles(display_name)").eq("project_id", projectId),
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "open"),
    Promise.all(
      doc.sections.map(async (section): Promise<EditorSection> => {
        const markdown = await readSectionVersion(oxen, view, pageSlug, section.slug, section.activeVersion);
        return { ...section, blocks: parseSectionMarkdown(markdown ?? "") };
      }),
    ),
  ]);

  const members: SidebarMember[] = (
    (memberRows ?? []) as unknown as { user_id: string; role: "owner" | "editor"; profile: { display_name: string } | null }[]
  ).map((row) => ({ userId: row.user_id, role: row.role, displayName: row.profile?.display_name ?? "Member" }));

  return (
    <div className="flex min-h-0 flex-1">
      <PagesSidebar
        projectId={project.id}
        projectName={project.name}
        pages={site.pages}
        activeSlug={pageSlug}
        initialMembers={members}
        openProposals={openProposals ?? 0}
      />
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
        initialDirty={dirty}
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
