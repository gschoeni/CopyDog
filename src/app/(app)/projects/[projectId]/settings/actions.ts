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
});

export type InviteMemberResult =
  | { ok: true; added: boolean } // added=false: they were already on the project
  | { ok: false; error: string };

/**
 * Invites by email through the `invite_member` SECURITY DEFINER RPC (any
 * member can invite; the invitee must have signed in once). Runs server-side
 * so a successful invite can revalidate every route that renders the roster.
 */
export async function inviteMemberAction(input: { projectId: string; email: string }): Promise<InviteMemberResult> {
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }
  const { projectId, email } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_member", {
    p_project_id: projectId,
    p_email: email,
  });
  if (error) {
    // CD001 is the RPC's stable no-account errcode; the message check keeps
    // this working against a database that predates the errcode migration
    if (error.code === "CD001" || error.message.includes("no CopyDog account")) {
      return { ok: false, error: "No account with that email yet — ask them to sign in once first." };
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
    return { ok: false, error: left ? "Owners can't leave their own project." : "Only the project's owner can remove someone else." };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  if (left) revalidatePath("/projects");
  return { ok: true, left };
}
