import { emptyDoc, serializeDocFile } from "@/lib/content/doc";
import { SITE_FILE_PATH, emptySite, pageDocPath, serializeSiteFile } from "@/lib/content/site";
import type { OxenClient } from "./client";
import type { CommitAuthor } from "./types";

/**
 * Creates and seeds the Oxen repo for a new project: an initial sitemap with
 * a Home page and its empty doc, committed to main as one commit. Returns
 * the repo name to store on the project row.
 */
export async function provisionProjectRepo(
  oxen: OxenClient,
  options: { repoName: string; author: CommitAuthor },
): Promise<string> {
  const { repoName, author } = options;

  await oxen.createRepo(repoName, {
    description: "CopyDog project content",
    isPublic: false,
    user: author,
  });

  const workspaceId = `provision-${repoName}`;
  await oxen.getOrCreateWorkspace(repoName, {
    workspaceId,
    branchName: "main",
    name: workspaceId,
  });

  const site = emptySite();
  await oxen.writeWorkspaceFile(repoName, workspaceId, SITE_FILE_PATH, serializeSiteFile(site));
  for (const page of site.pages) {
    await oxen.writeWorkspaceFile(repoName, workspaceId, pageDocPath(page.slug), serializeDocFile(emptyDoc()));
  }

  await oxen.commitWorkspace(repoName, workspaceId, "main", {
    message: "Initialize project structure",
    author,
  });
  await oxen.deleteWorkspace(repoName, workspaceId);

  return repoName;
}
