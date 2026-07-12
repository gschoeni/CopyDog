import "server-only";

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
  const view = await ensureDraftView(oxen, project.oxen_repo, user.id);

  return {
    user: { id: user.id, email: user.email ?? null },
    project: { id: project.id, name: project.name, slug: project.slug, oxenRepo: project.oxen_repo },
    oxen,
    view,
  };
}
