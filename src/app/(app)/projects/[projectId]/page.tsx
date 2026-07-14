import { notFound, redirect } from "next/navigation";

import { requireProjectAccess } from "@/lib/content/access";
import { readSite } from "@/lib/content/store";

import { FirstPageForm } from "./first-page-form";

/**
 * No intermediate project page: this route drops you straight into the
 * editor on the project's first page. A project with no pages yet gets a
 * calm "name your first page" moment instead.
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId);
  } catch {
    notFound();
  }

  const site = await readSite(access.oxen, access.view);
  const first = site.pages[0];
  if (first) {
    redirect(`/projects/${access.project.id}/pages/${first.slug}`);
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-sm text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink-tertiary">{access.project.name}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Every site starts with a page</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          Name your first one and start writing — sections, versions, and the wireframe grow from there.
        </p>
        <div className="mt-8">
          <FirstPageForm projectId={access.project.id} />
        </div>
      </div>
    </div>
  );
}
