import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { StatusBadge } from "./status-badge";

export const metadata = { title: "Proposals" };

interface ProposalRow {
  id: string;
  title: string;
  status: "open" | "merged" | "closed";
  created_at: string;
  author: { display_name: string } | null;
}

export default async function ProposalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name").eq("id", projectId).single();
  if (!project) notFound();

  const { data } = await supabase
    .from("proposals")
    .select("id, title, status, created_at, author:profiles(display_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  const proposals = (data ?? []) as unknown as ProposalRow[];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-ink-tertiary">
        <Link href="/projects" className="hover:text-ink">
          Projects
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/projects/${project.id}`} className="hover:text-ink">
          {project.name}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-secondary">Proposals</span>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Proposals</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        Drafts proposed as the team&apos;s copy. Merging updates the canonical version on main.
      </p>

      <ul className="mt-8 space-y-2">
        {proposals.length === 0 && (
          <li className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-ink-tertiary">
            No proposals yet. Open one from the editor with <span className="font-medium">Propose</span>.
          </li>
        )}
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <Link
              href={`/projects/${project.id}/proposals/${proposal.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-soft transition-all hover:-translate-y-px hover:shadow-raised"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{proposal.title}</p>
                <p className="mt-0.5 text-xs text-ink-tertiary">
                  {proposal.author?.display_name ?? "Someone"} ·{" "}
                  {new Date(proposal.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
              </div>
              <StatusBadge status={proposal.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
