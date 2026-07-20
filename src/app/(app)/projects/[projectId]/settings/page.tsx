import { notFound, redirect } from "next/navigation";

import { listProjectMembers } from "@/lib/members";
import { createClient } from "@/lib/supabase/server";

import { ProjectSettings } from "./project-settings";

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

  const members = await listProjectMembers(supabase, projectId);

  return (
    <ProjectSettings
      projectId={project.id}
      name={project.name}
      // owner role = people-management; the creator additionally renames/deletes
      isOwner={members.some((member) => member.userId === user.id && member.role === "owner")}
      isCreator={project.owner_id === user.id}
      creatorId={project.owner_id as string}
      currentUserId={user.id}
      members={members}
    />
  );
}
