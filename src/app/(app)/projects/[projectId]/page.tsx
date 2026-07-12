import Link from "next/link";
import { notFound } from "next/navigation";

import { SITE_FILE_PATH, parseSiteFile } from "@/lib/content/site";
import { getOxenClient } from "@/lib/oxen";
import { createClient } from "@/lib/supabase/server";

import { MembersCard, type Member } from "./members-card";

/**
 * Project overview: pages (from the user's draft view of site.json), team,
 * and proposals. The Postgres row is the index entry; page structure comes
 * straight from Oxen.
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug, oxen_repo")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  const [{ data: memberRows }, { count: openProposals }] = await Promise.all([
    supabase
      .from("project_members")
      .select("user_id, role, profile:profiles(display_name)")
      .eq("project_id", projectId),
    supabase
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "open"),
  ]);

  const members: Member[] = (
    (memberRows ?? []) as unknown as { user_id: string; role: "owner" | "editor"; profile: { display_name: string } | null }[]
  ).map((row) => ({ userId: row.user_id, role: row.role, displayName: row.profile?.display_name ?? "Member" }));

  const site = parseSiteFile(await getOxenClient().readFile(project.oxen_repo, "main", SITE_FILE_PATH));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <nav className="text-xs text-ink-tertiary">
        <Link href="/projects" className="hover:text-ink">
          Projects
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-secondary">{project.name}</span>
      </nav>

      <div className="mt-3 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <Link
          href={`/projects/${project.id}/proposals`}
          className="text-sm text-ink-secondary underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          Proposals{openProposals ? ` (${openProposals} open)` : ""}
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-ink-tertiary">Pages</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {site.pages.map((page) => (
              <li key={page.slug}>
                <Link
                  href={`/projects/${project.id}/pages/${page.slug}`}
                  className="group block rounded-lg border border-border bg-surface p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-raised"
                >
                  <h2 className="font-medium tracking-tight group-hover:text-accent">{page.title}</h2>
                  <p className="mt-1 text-xs text-ink-tertiary">/{page.slug}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-ink-tertiary">Collaboration</p>
          <MembersCard projectId={project.id} initialMembers={members} />
        </div>
      </div>
    </div>
  );
}
