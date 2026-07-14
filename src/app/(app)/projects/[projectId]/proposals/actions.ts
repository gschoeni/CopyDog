"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireProjectAccess } from "@/lib/content/access";
import { applyBranchToMain } from "@/lib/content/store";
import { createClient } from "@/lib/supabase/server";

const proposalRef = z.object({
  projectId: z.uuid(),
  proposalId: z.uuid(),
});

/**
 * Merges an open proposal: squash-applies the source branch onto main and
 * records the merge. Any editor can merge — the review is social, the
 * history is permanent.
 */
export async function mergeProposalAction(input: z.infer<typeof proposalRef>): Promise<{ ok: true } | { ok: false; error: string }> {
  const { projectId, proposalId } = proposalRef.parse(input);
  const { oxen, project, user } = await requireProjectAccess(projectId);

  const supabase = await createClient();
  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, title, status, source_branch")
    .eq("id", proposalId)
    .eq("project_id", project.id) // never act on another project's proposal
    .single<{ id: string; title: string; status: string; source_branch: string }>();
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "open") return { ok: false, error: "This proposal is already resolved." };

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();

  let mergedCommit: string;
  try {
    mergedCommit = await applyBranchToMain(oxen, project.oxenRepo, proposal.source_branch, {
      message: `Merge proposal: ${proposal.title}`,
      author: { name: profile?.display_name ?? "copydog", email: user.email ?? "unknown@copydog.app" },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "nothing to merge") {
      return { ok: false, error: "This proposal has no changes against main." };
    }
    console.error("merge failed", err);
    return { ok: false, error: "Merge failed — try again." };
  }

  await supabase
    .from("proposals")
    .update({ status: "merged", merged_commit: mergedCommit, resolved_at: new Date().toISOString() })
    .eq("id", proposalId);

  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}

export async function closeProposalAction(input: z.infer<typeof proposalRef>): Promise<{ ok: boolean }> {
  const { projectId, proposalId } = proposalRef.parse(input);
  const { project } = await requireProjectAccess(projectId);

  const supabase = await createClient();
  await supabase
    .from("proposals")
    .update({ status: "closed", resolved_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("project_id", project.id) // never act on another project's proposal
    .eq("status", "open");

  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}
