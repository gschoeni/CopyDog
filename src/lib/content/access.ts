import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectRole } from "@/lib/members";
import { getOxenClient } from "@/lib/oxen";
import type { OxenClient } from "@/lib/oxen/client";
import { createClient } from "@/lib/supabase/server";

import { ensureDraftView, type DraftView } from "./store";

export interface ProjectAccess {
  user: { id: string; email: string | null };
  project: { id: string; name: string; slug: string; oxenRepo: string };
  /** The caller's seat on this project. Viewers read; they never write. */
  role: ProjectRole;
  oxen: OxenClient;
  view: DraftView;
}

export interface AccessOptions {
  /** The caller intends to mutate — viewers are refused at the gate. */
  write?: boolean;
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
 * No authenticated user — the session expired or was never established. This
 * is neither a 404 nor a server fault: callers should route the user to
 * sign in again, not surface a generic error.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The caller is a member, but a read-only one (viewer role) attempting a
 * write. Not a 404 — the project exists and they can see it — and not an
 * infra fault. The UI hides write affordances from viewers, so hitting
 * this means someone went around the UI; refuse politely.
 */
export class ReadOnlyMemberError extends Error {
  constructor() {
    super("viewers have read-only access to this project");
    this.name = "ReadOnlyMemberError";
  }
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  oxen_repo: string;
}

/**
 * The shared tail of both access gates: membership is already confirmed, so
 * anything failing here is the store, not the user (server down, or pointed
 * at the wrong data directory). Provisions the caller's draft branch +
 * workspace and assembles the ProjectAccess. Kept in one place so the two
 * gates can never drift on error handling or result shape.
 */
async function openDraftAccess(
  user: ProjectAccess["user"],
  project: ProjectRow,
  role: ProjectRole,
  options: AccessOptions | undefined,
): Promise<ProjectAccess> {
  // the one write gate both access paths share: a viewer never gets a
  // writable ProjectAccess, no matter how the request authenticated
  if (options?.write && role === "viewer") throw new ReadOnlyMemberError();

  const oxen = getOxenClient();
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
    user,
    project: { id: project.id, name: project.name, slug: project.slug, oxenRepo: project.oxen_repo },
    role,
    oxen,
    view,
  };
}

/**
 * The one gate every content action goes through: authenticates the user,
 * loads the project through RLS (membership check), and ensures their
 * draft branch + workspace exist. Throws on any failure — callers treat
 * that as 404/401.
 */
export async function requireProjectAccess(projectId: string, options?: AccessOptions): Promise<ProjectAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthenticatedError();

  // membership + project + role in one round trip; RLS scopes the rows,
  // the join proves membership
  const { data: membership } = await supabase
    .from("project_members")
    .select("role, projects(id, name, slug, oxen_repo)")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle<{ role: ProjectRole; projects: ProjectRow | null }>();
  const project = membership?.projects ?? null;
  if (!project) throw new Error("project not found or not a member");

  return openDraftAccess({ id: user.id, email: user.email ?? null }, project, membership!.role, options);
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
  options?: AccessOptions,
): Promise<ProjectAccess> {
  // membership + project in one round trip — the join IS the membership gate
  // (a row exists only if this user belongs to the project). No separate
  // profiles-existence check: api_keys.user_id FKs profiles.id ON DELETE
  // CASCADE, so a resolved key already proves the profile exists.
  const { data: membership } = await admin
    .from("project_members")
    .select("role, projects(id, name, slug, oxen_repo)")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle<{ role: ProjectRole; projects: ProjectRow | null }>();
  const project = membership?.projects ?? null;
  if (!project) throw new Error("project not found or not a member");

  const { data: emailRow } = await admin.auth.admin.getUserById(userId);

  return openDraftAccess({ id: userId, email: emailRow?.user?.email ?? null }, project, membership!.role, options);
}
