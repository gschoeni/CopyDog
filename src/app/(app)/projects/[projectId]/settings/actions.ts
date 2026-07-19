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
