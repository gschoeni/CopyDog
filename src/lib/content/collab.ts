import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CommitAuthor } from "@/lib/oxen/types";

import type { ProjectAccess } from "./access";
import { docSections } from "./doc";
import { flattenPages } from "./site";
import { applyBranchToMain, hasUnpublishedChanges, publishDraft, readDoc, readSite } from "./store";

/**
 * Publish / propose / merge — the collaboration verbs, shared by the server
 * actions (cookie session, RLS-scoped client) and the MCP tools (API key,
 * service-role client behind requireProjectAccessAs). Callers bring their
 * own Supabase client; authorization already happened at the access gate.
 */

export async function commitAuthorFor(supabase: SupabaseClient, user: ProjectAccess["user"]): Promise<CommitAuthor> {
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  return { name: profile?.display_name ?? "copydog", email: user.email ?? "unknown@copydog.app" };
}

/**
 * Publishes the user's staged edits to their draft branch (when there are
 * any) and refreshes their rows in the section_versions index so teammates
 * can discover and adopt their versions.
 */
export async function publishDraftAndIndex(
  supabase: SupabaseClient,
  access: ProjectAccess,
  message?: string,
): Promise<void> {
  const { oxen, view, user, project } = access;
  const author = await commitAuthorFor(supabase, user);

  if (await hasUnpublishedChanges(oxen, view)) {
    await publishDraft(oxen, view, { message: message?.trim() || "Publish drafts", author });
  }

  const site = await readSite(oxen, view);
  const rows: Record<string, unknown>[] = [];
  for (const { page } of flattenPages(site.pages)) {
    const doc = await readDoc(oxen, view, page.slug);
    for (const section of docSections(doc)) {
      for (const version of section.versions) {
        rows.push({
          project_id: project.id,
          author_id: user.id,
          page_slug: page.slug,
          section_slug: section.slug,
          version_slug: version.slug,
          label: version.label,
        });
      }
    }
  }
  const { error: deleteError } = await supabase
    .from("section_versions")
    .delete()
    .match({ project_id: project.id, author_id: user.id });
  if (deleteError) throw new Error(`publish index refresh failed: ${deleteError.message}`);
  if (rows.length) {
    const { error: insertError } = await supabase.from("section_versions").insert(rows);
    if (insertError) throw new Error(`publish index refresh failed: ${insertError.message}`);
  }
}

/** Publishes any pending edits, then opens a proposal from the user's draft to main. */
export async function openProposal(
  supabase: SupabaseClient,
  access: ProjectAccess,
  input: { title: string; description?: string },
): Promise<{ proposalId: string }> {
  const { oxen, view, user, project } = access;
  await publishDraftAndIndex(supabase, access);
  const main = await oxen.getBranch(project.oxenRepo, "main");

  const { data, error } = await supabase
    .from("proposals")
    .insert({
      project_id: project.id,
      author_id: user.id,
      title: input.title,
      description: input.description || null,
      source_branch: view.branch,
      base_commit: main.commit_id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    throw new Error(error?.message ?? "could not create proposal");
  }
  return { proposalId: data.id };
}

export type MergeResult = { ok: true; mergedCommit: string } | { ok: false; error: string };

/**
 * Merges an open proposal: squash-applies the source branch onto main and
 * records the merge. Any editor can merge — the review is social, the
 * history is permanent.
 */
export async function mergeProposal(
  supabase: SupabaseClient,
  access: ProjectAccess,
  proposalId: string,
): Promise<MergeResult> {
  const { oxen, project, user } = access;

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, title, status, source_branch")
    .eq("id", proposalId)
    .eq("project_id", project.id) // never act on another project's proposal
    .maybeSingle<{ id: string; title: string; status: string; source_branch: string }>();
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "open") return { ok: false, error: "This proposal is already resolved." };

  let mergedCommit: string;
  try {
    mergedCommit = await applyBranchToMain(oxen, project.oxenRepo, proposal.source_branch, {
      message: `Merge proposal: ${proposal.title}`,
      author: await commitAuthorFor(supabase, user),
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

  return { ok: true, mergedCommit };
}

export async function closeProposal(
  supabase: SupabaseClient,
  access: ProjectAccess,
  proposalId: string,
): Promise<void> {
  await supabase
    .from("proposals")
    .update({ status: "closed", resolved_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("project_id", access.project.id) // never act on another project's proposal
    .eq("status", "open");
}
