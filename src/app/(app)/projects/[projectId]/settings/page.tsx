import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ProjectSettings, type SettingsMember } from "./project-settings";

export const metadata = { title: "Project settings" };

/**
 * Project settings: the one place to see who's on a project, bring someone
 * new in, and (for the owner) rename or delete it. Loaded entirely through
 * RLS — a non-member's project query returns nothing, so they see a 404.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const { data: memberRows } = await supabase
    .from("project_members")
    .select("user_id, role, profile:profiles(display_name, avatar_url)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const members: SettingsMember[] = (
    (memberRows ?? []) as unknown as {
      user_id: string;
      role: "owner" | "editor";
      profile: { display_name: string; avatar_url: string | null } | null;
    }[]
  ).map((row) => ({
    userId: row.user_id,
    role: row.role,
    displayName: row.profile?.display_name ?? "Member",
    avatarUrl: row.profile?.avatar_url ?? null,
  }));

  return (
    <ProjectSettings
      projectId={project.id}
      initialName={project.name}
      isOwner={project.owner_id === user.id}
      currentUserId={user.id}
      initialMembers={members}
    />
  );
}
