import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one shape a project member takes in the UI — the settings roster, the
 * sidebar facepile, and anywhere else faces render. One select string and one
 * mapper, so the surfaces can't drift apart.
 */
export interface ProjectMember {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
  avatarUrl: string | null;
}

export const MEMBER_SELECT = "user_id, role, profile:profiles(display_name, avatar_url)";

interface MemberRow {
  user_id: string;
  role: "owner" | "editor";
  profile: { display_name: string; avatar_url: string | null } | null;
}

export function mapMemberRows(rows: unknown[] | null): ProjectMember[] {
  return ((rows ?? []) as MemberRow[]).map((row) => ({
    userId: row.user_id,
    role: row.role,
    displayName: row.profile?.display_name ?? "Member",
    avatarUrl: row.profile?.avatar_url ?? null,
  }));
}

/**
 * Members of a project, oldest first — the owner leads, since the owner
 * membership is created with the project. Runs under RLS: a non-member
 * gets an empty list, never an error.
 */
export async function listProjectMembers(supabase: SupabaseClient, projectId: string): Promise<ProjectMember[]> {
  const { data } = await supabase
    .from("project_members")
    .select(MEMBER_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  return mapMemberRows(data);
}
