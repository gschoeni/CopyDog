import { emptyDoc, serializeDocFile } from "@/lib/content/doc";
import { SITE_FILE_PATH, emptySite, pageDocPath, serializeSiteFile } from "@/lib/content/site";
import type { OxenClient } from "./client";
import type { CommitAuthor } from "./types";

/**
 * Creates and seeds the Oxen repo for a new project: an initial sitemap with
 * a Home page and its empty doc, as the repo's ROOT commit. Seeding happens
 * in the create call itself — a commitless main can't host workspaces, so
 * the repo must be born with content (hub rejects the old create-then-
 * workspace-commit dance with no_commits_on_branch).
 */
export async function provisionProjectRepo(
  oxen: OxenClient,
  options: { repoName: string; author: CommitAuthor },
): Promise<string> {
  const { repoName, author } = options;

  const site = emptySite();
  await oxen.createRepo(repoName, {
    description: "CopyDog project content",
    isPublic: false,
    user: author,
    files: [
      { path: SITE_FILE_PATH, contents: serializeSiteFile(site) },
      ...site.pages.map((page) => ({ path: pageDocPath(page.slug), contents: serializeDocFile(emptyDoc()) })),
    ],
  });

  return repoName;
}
