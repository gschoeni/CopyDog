"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const renameInput = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1, "Give the project a name").max(80, "Keep it under 80 characters"),
});

export type RenameProjectResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Renames a project through RLS: `projects_update_owner` means a non-owner's
 * update touches zero rows, which we report rather than pretending success.
 */
export async function renameProjectAction(input: { projectId: string; name: string }): Promise<RenameProjectResult> {
  const parsed = renameInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }
  const { projectId, name } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id");
  if (error) {
    console.error("project rename failed", { projectId, error });
    return { ok: false, error: "Couldn't rename the project. Please try again." };
  }
  if (!data?.length) {
    return { ok: false, error: "Only the project's owner can rename it." };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, name };
}

const inviteInput = z.object({
  projectId: z.uuid(),
  email: z.string().trim().min(1, "Enter an email").max(320, "That doesn't look like an email"),
  // owner is deliberately not invitable — promotion is a second step on the roster
  role: z.enum(["editor", "viewer"]),
});

export type InviteMemberResult =
  | { ok: true; added: boolean } // added=false: they were already on the project
  | { ok: false; error: string };

/**
 * Invites by email through the `invite_member` SECURITY DEFINER RPC (any
 * member can invite; the invitee must have signed in once). Runs server-side
 * so a successful invite can revalidate every route that renders the roster.
 */
export async function inviteMemberAction(input: {
  projectId: string;
  email: string;
  role: "editor" | "viewer";
}): Promise<InviteMemberResult> {
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }
  const { projectId, email, role } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_member", {
    p_project_id: projectId,
    p_email: email,
    p_role: role,
  });
  if (error) {
    // CD001 is the RPC's stable no-account errcode; the message check keeps
    // this working against a database that predates the errcode migration
    if (error.code === "CD001" || error.message.includes("no CopyDog account")) {
      return { ok: false, error: "No account with that email yet — ask them to sign in once first." };
    }
    if (error.message.includes("not allowed to invite")) {
      return { ok: false, error: "Viewers can't invite people to the project." };
    }
    console.error("invite failed", { projectId, error });
    return { ok: false, error: "Couldn't invite that person." };
  }

  const added = data === true;
  if (added) revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true, added };
}

const removeInput = z.object({ projectId: z.uuid(), userId: z.uuid() });

export type RemoveMemberResult = { ok: true; left: boolean } | { ok: false; error: string };

/**
 * Removes a membership through RLS (owner removes anyone, a member removes
 * themself). A delete that touches zero rows means "not allowed" and is
 * reported rather than pretending success.
 */
export async function removeMemberAction(input: { projectId: string; userId: string }): Promise<RemoveMemberResult> {
  const { projectId, userId } = removeInput.parse(input);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in and try again." };
  const left = userId === user.id;

  // the creator anchors the project (rename/delete hang off owner_id):
  // their membership is not removable, not even by themselves
  const { data: project } = await supabase.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  if (project?.owner_id === userId) {
    return { ok: false, error: left ? "You created this project — delete it instead of leaving." : "The project's creator can't be removed." };
  }

  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    console.error("member removal failed", { projectId, userId, error });
    return { ok: false, error: left ? "Couldn't leave the project. Please try again." : "Couldn't remove them. Please try again." };
  }
  if (!data?.length) {
    return { ok: false, error: left ? "Couldn't leave the project." : "Only a project owner can remove someone else." };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  if (left) revalidatePath("/projects");
  return { ok: true, left };
}

const roleInput = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["owner", "editor", "viewer"]),
});

export type UpdateMemberRoleResult = { ok: true } | { ok: false; error: string };

/**
 * Sets another member's role. RLS enforces the security boundary (owners
 * only, never your own row); this action adds the app-level guard that the
 * project's creator stays an owner — rename and delete hang off owner_id,
 * so demoting the creator would strand those powers on an "editor".
 *
 * Owner here means people-management: promoted owners invite, remove, and
 * set roles. Renaming and deleting stay with the creator.
 */
export async function updateMemberRoleAction(input: {
  projectId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
}): Promise<UpdateMemberRoleResult> {
  const { projectId, userId, role } = roleInput.parse(input);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out — sign in and try again." };
  if (userId === user.id) return { ok: false, error: "You can't change your own role." };

  const { data: project } = await supabase.from("projects").select("owner_id").eq("id", projectId).maybeSingle();
  if (project?.owner_id === userId) {
    return { ok: false, error: "The project creator's role can't be changed." };
  }

  const { data, error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    console.error("member role update failed", { projectId, userId, role, error });
    return { ok: false, error: "Couldn't change their role. Please try again." };
  }
  if (!data?.length) {
    return { ok: false, error: "Only a project owner can change roles." };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
