import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProjectAccess } from "@/lib/content/access";
import { compareRevisions } from "@/lib/content/store";
import { diffLines, type DiffLine } from "@/lib/diff";
import { createClient } from "@/lib/supabase/server";

import { StatusBadge } from "../status-badge";
import { ProposalActions } from "./proposal-actions";

interface ProposalRow {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "merged" | "closed";
  source_branch: string;
  created_at: string;
  author: { display_name: string } | null;
}

interface FileDiff {
  path: string;
  label: string;
  kind: "copy" | "structure" | "wireframe";
  lines: DiffLine[] | null;
}

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ projectId: string; proposalId: string }>;
}) {
  const { projectId, proposalId } = await params;

  let access;
  try {
    access = await requireProjectAccess(projectId);
  } catch {
    notFound();
  }
  const { oxen, project } = access;

  const supabase = await createClient();
  const { data } = await supabase
    .from("proposals")
    .select("id, title, description, status, source_branch, created_at, author:profiles(display_name)")
    .eq("id", proposalId)
    .single();
  const proposal = data as unknown as ProposalRow | null;
  if (!proposal) notFound();

  // live diff: what merging would change on main right now
  const diffs: FileDiff[] = [];
  if (proposal.status === "open") {
    const { changed } = await compareRevisions(oxen, project.oxenRepo, proposal.source_branch, "main");
    for (const [path, { source, target }] of [...changed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      diffs.push(describeFileDiff(path, source, target));
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <nav className="text-xs text-ink-tertiary">
        <Link href={`/projects/${project.id}`} className="hover:text-ink">
          {project.name}
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/projects/${project.id}/proposals`} className="hover:text-ink">
          Proposals
        </Link>
      </nav>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{proposal.title}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {proposal.author?.display_name ?? "Someone"} proposes their draft as the team&apos;s copy
          </p>
          {proposal.description && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-secondary">{proposal.description}</p>
          )}
        </div>
        <StatusBadge status={proposal.status} />
      </div>

      {proposal.status === "open" && (
        <div className="mt-6">
          <ProposalActions projectId={project.id} proposalId={proposal.id} changeCount={diffs.length} />
        </div>
      )}

      <div className="mt-8 space-y-4">
        {proposal.status !== "open" ? (
          <p className="rounded-lg border border-border bg-surface p-5 text-sm text-ink-secondary shadow-soft">
            This proposal is {proposal.status}
            {proposal.status === "merged" ? " — its changes live on main now." : "."}
          </p>
        ) : diffs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-ink-tertiary">
            No differences against main — there&apos;s nothing to merge.
          </p>
        ) : (
          diffs.map((diff) => (
            <section key={diff.path} className="overflow-hidden rounded-lg border border-border bg-surface shadow-soft">
              <header className="border-b border-border bg-surface-sunken/60 px-4 py-2">
                <h2 className="text-xs font-semibold text-ink-secondary">{diff.label}</h2>
              </header>
              {diff.lines ? (
                <pre className="overflow-x-auto p-0 text-[13px] leading-relaxed">
                  {diff.lines.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.kind === "added"
                          ? "bg-success/10 px-4 text-success"
                          : line.kind === "removed"
                            ? "bg-danger/10 px-4 text-danger line-through decoration-danger/40"
                            : "px-4 text-ink-secondary"
                      }
                    >
                      <span className="mr-2 inline-block w-3 select-none opacity-60">
                        {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                      </span>
                      {line.text || " "}
                    </div>
                  ))}
                </pre>
              ) : (
                <p className="px-4 py-3 text-sm text-ink-tertiary">
                  {diff.kind === "wireframe" ? "Wireframe layout updated." : "Document structure updated."}
                </p>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function describeFileDiff(path: string, source: string | null, target: string | null): FileDiff {
  const copyMatch = path.match(/^pages\/([^/]+)\/sections\/([^/]+)\/([^/]+)\.md$/);
  if (copyMatch) {
    return {
      path,
      label: `${copyMatch[1]} · ${copyMatch[2]} · ${copyMatch[3]}`,
      kind: "copy",
      lines: diffLines(target ?? "", source ?? ""),
    };
  }
  const pageMatch = path.match(/^pages\/([^/]+)\/(doc\.json|wireframe\.html)$/);
  if (pageMatch) {
    const isWireframe = pageMatch[2] === "wireframe.html";
    return {
      path,
      label: `${pageMatch[1]} · ${isWireframe ? "wireframe" : "structure"}`,
      kind: isWireframe ? "wireframe" : "structure",
      lines: null,
    };
  }
  return { path, label: path, kind: "structure", lines: null };
}
