"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOxenClient } from "@/lib/oxen";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { shortId, slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export interface CreateProjectState {
  error?: string;
}

const nameSchema = z.string().trim().min(1, "Give your project a name").max(80, "Keep it under 80 characters");

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name" };
  }
  const name = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const author = { name: profile?.display_name ?? user.email ?? "copydog", email: user.email ?? "unknown@copydog.app" };

  const slug = slugify(name);
  const repoName = `${slug}-${shortId()}`;

  let projectId: string;
  try {
    await provisionProjectRepo(getOxenClient(), { repoName, author });

    const { data, error } = await supabase
      .rpc("create_project", { p_name: name, p_slug: slug, p_oxen_repo: repoName })
      .single<{ id: string }>();
    if (error) {
      console.error("create_project failed after repo provisioning", { repoName, error });
      return { error: "Could not create the project. Please try again." };
    }
    projectId = data.id;
  } catch (err) {
    console.error("project provisioning failed", err);
    return { error: "Could not reach the content store. Please try again." };
  }

  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
