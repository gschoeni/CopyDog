import Link from "next/link";
import { notFound } from "next/navigation";

import { SITE_FILE_PATH, parseSiteFile } from "@/lib/content/site";
import { getOxenClient } from "@/lib/oxen";
import { createClient } from "@/lib/supabase/server";

/**
 * Project overview: the Postgres row is the index entry; the page list is
 * read straight from site.json on the Oxen main branch — the first full
 * index→store round trip in the app.
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

  const site = parseSiteFile(await getOxenClient().readFile(project.oxen_repo, "main", SITE_FILE_PATH));

  return (
    <div>
      <nav className="text-xs text-ink-tertiary">
        <Link href="/projects" className="hover:text-ink">
          Projects
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-secondary">{project.name}</span>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{project.name}</h1>
      <p className="mt-1 text-sm text-ink-secondary">Pages</p>

      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {site.pages.map((page) => (
          <li key={page.slug}>
            <div className="rounded-lg border border-border bg-surface p-5 shadow-soft">
              <h2 className="font-medium tracking-tight">{page.title}</h2>
              <p className="mt-1 text-xs text-ink-tertiary">/{page.slug}</p>
              <p className="mt-4 text-xs text-ink-tertiary">The copy editor arrives in Phase 2.</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
