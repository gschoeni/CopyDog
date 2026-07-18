"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireProjectAccess } from "@/lib/content/access";
import { closeProposal, mergeProposal } from "@/lib/content/collab";
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
  const access = await requireProjectAccess(projectId);

  const result = await mergeProposal(await createClient(), access, proposalId);
  if (!result.ok) return result;

  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}

export async function closeProposalAction(input: z.infer<typeof proposalRef>): Promise<{ ok: boolean }> {
  const { projectId, proposalId } = proposalRef.parse(input);
  const access = await requireProjectAccess(projectId);

  await closeProposal(await createClient(), access, proposalId);

  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}
