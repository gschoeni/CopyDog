import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { NewProjectForm } from "./new-project-form";

export const metadata = { title: "Projects" };

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });
  const projects = (data ?? []) as ProjectRow[];

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {projects.length === 0
              ? "Every project is a site: copy, wireframes, and every version of both."
              : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NewProjectForm firstProject={projects.length === 0} />
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="group rounded-lg border border-border bg-surface p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-raised"
          >
            <h2 className="font-medium tracking-tight group-hover:text-accent">{project.name}</h2>
            <p className="mt-1 text-xs text-ink-tertiary">
              Created{" "}
              {new Date(project.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
