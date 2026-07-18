import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getOxenClient } from "@/lib/oxen";
import type { OxenClient } from "@/lib/oxen/client";
import { createClient } from "@/lib/supabase/server";

import { ensureDraftView, type DraftView } from "./store";

export interface ProjectAccess {
  user: { id: string; email: string | null };
  project: { id: string; name: string; slug: string; oxenRepo: string };
  oxen: OxenClient;
  view: DraftView;
}

/**
 * The content store (Oxen) is unreachable or missing this project's repo —
 * an infrastructure problem, NOT a "page not found". Callers must let this
 * propagate to the error boundary instead of collapsing it into a 404,
 * which sends whoever's debugging down the wrong path entirely.
 */
export class ContentStoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ContentStoreUnavailableError";
  }
}

/**
 * The one gate every content action goes through: authenticates the user,
 * loads the project through RLS (membership check), and ensures their
 * draft branch + workspace exist. Throws on any failure — callers treat
 * that as 404/401.
 */
export async function requireProjectAccess(projectId: string): Promise<ProjectAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug, oxen_repo")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("project not found or not a member");

  const oxen = getOxenClient();
  // membership is confirmed by now — anything failing below is the store,
  // not the user: server down, or pointed at the wrong data directory
  let view: DraftView;
  try {
    view = await ensureDraftView(oxen, project.oxen_repo, user.id);
  } catch (err) {
    throw new ContentStoreUnavailableError(
      `Oxen content store failed for repo "${project.oxen_repo}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return {
    user: { id: user.id, email: user.email ?? null },
    project: { id: project.id, name: project.name, slug: project.slug, oxenRepo: project.oxen_repo },
    oxen,
    view,
  };
}

/**
 * The same gate for callers that authenticated outside the cookie session —
 * today that's the MCP endpoint, where an API key already resolved to a
 * user id. Because the service-role client bypasses RLS, the membership
 * check the projects policy would have done implicitly happens explicitly
 * here. This is the ONLY place service-role project access is legitimized;
 * MCP tools receive the result and never query around it.
 */
export async function requireProjectAccessAs(
  admin: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const { data: membership } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) throw new Error("project not found or not a member");

  const { data: project } = await admin
    .from("projects")
    .select("id, name, slug, oxen_repo")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("project not found or not a member");

  const { data: authUser } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();
  if (!authUser) throw new Error("unknown user");
  const { data: emailRow } = await admin.auth.admin.getUserById(userId);

  const oxen = getOxenClient();
  let view: DraftView;
  try {
    view = await ensureDraftView(oxen, project.oxen_repo, userId);
  } catch (err) {
    throw new ContentStoreUnavailableError(
      `Oxen content store failed for repo "${project.oxen_repo}": ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return {
    user: { id: userId, email: emailRow?.user?.email ?? null },
    project: { id: project.id, name: project.name, slug: project.slug, oxenRepo: project.oxen_repo },
    oxen,
    view,
  };
}
