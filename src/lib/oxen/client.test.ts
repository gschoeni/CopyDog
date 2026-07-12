import { beforeEach, describe, expect, it } from "vitest";

import { OxenClient, OxenError } from "./client";
import { OxenStub } from "./stub";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };

describe("OxenClient against the stub server", () => {
  let stub: OxenStub;
  let client: OxenClient;

  beforeEach(() => {
    stub = new OxenStub();
    client = new OxenClient({
      token: "test-token",
      namespace: "copydog-test",
      baseUrl: "https://stub.oxen.local",
      fetchImpl: stub.fetch,
    });
  });

  it("creates a repo with an initial main branch", async () => {
    const repo = await client.createRepo("landing-page", { user: AUTHOR });
    expect(repo.name).toBe("landing-page");

    const branches = await client.listBranches("landing-page");
    expect(branches.map((b) => b.name)).toEqual(["main"]);
  });

  it("creates per-user draft branches from main", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    const branch = await client.createBranch("landing-page", "draft/user-123", "main");
    expect(branch.name).toBe("draft/user-123");

    const main = await client.getBranch("landing-page", "main");
    expect(branch.commit_id).toBe(main.commit_id);
  });

  it("is idempotent when a branch already exists", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    const first = await client.createBranch("landing-page", "draft/user-123", "main");
    const second = await client.createBranch("landing-page", "draft/user-123", "main");
    expect(second.commit_id).toBe(first.commit_id);
  });

  it("stages autosaves in a workspace without touching the branch", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    await client.createBranch("landing-page", "draft/user-123", "main");
    const headBefore = stub.branchHead("landing-page", "draft/user-123");

    await client.getOrCreateWorkspace("landing-page", {
      workspaceId: "ws-user-123",
      branchName: "draft/user-123",
      name: "draft-user-123",
    });
    await client.writeWorkspaceFile(
      "landing-page",
      "ws-user-123",
      "pages/home/sections/hero/punchy.md",
      "# Ship copy and wireframes together",
    );

    // autosave is visible inside the workspace…
    const staged = await client.readWorkspaceFile(
      "landing-page",
      "ws-user-123",
      "pages/home/sections/hero/punchy.md",
    );
    expect(staged).toContain("Ship copy");

    // …but history is untouched until publish
    expect(stub.branchHead("landing-page", "draft/user-123")).toBe(headBefore);
  });

  it("publishes a workspace as one atomic commit on the draft branch", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    await client.createBranch("landing-page", "draft/user-123", "main");
    await client.getOrCreateWorkspace("landing-page", {
      workspaceId: "ws-user-123",
      branchName: "draft/user-123",
    });
    await client.writeWorkspaceFile("landing-page", "ws-user-123", "pages/home/doc.json", `{"sections":[]}`);
    await client.writeWorkspaceFile("landing-page", "ws-user-123", "pages/home/sections/hero/punchy.md", "# Hello");

    const commit = await client.commitWorkspace("landing-page", "ws-user-123", "draft/user-123", {
      message: "Publish hero drafts",
      author: AUTHOR,
    });

    expect(commit.message).toBe("Publish hero drafts");
    expect(stub.branchHead("landing-page", "draft/user-123")).toBe(commit.id);
    expect(stub.fileAt("landing-page", "draft/user-123", "pages/home/sections/hero/punchy.md")).toBe("# Hello");
    // main is untouched — publishing is per-user
    expect(stub.fileAt("landing-page", "main", "pages/home/sections/hero/punchy.md")).toBeUndefined();
  });

  it("workspaces persist and fast-forward after commit, so autosave can continue", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    await client.getOrCreateWorkspace("landing-page", { workspaceId: "ws-1", branchName: "main" });
    await client.writeWorkspaceFile("landing-page", "ws-1", "site.json", `{"pages":["home"]}`);
    await client.commitWorkspace("landing-page", "ws-1", "main", { message: "first", author: AUTHOR });

    await client.writeWorkspaceFile("landing-page", "ws-1", "site.json", `{"pages":["home","about"]}`);
    const second = await client.commitWorkspace("landing-page", "ws-1", "main", { message: "second", author: AUTHOR });

    expect(stub.branchHead("landing-page", "main")).toBe(second.id);
    expect(stub.fileAt("landing-page", "main", "site.json")).toContain("about");
  });

  it("rejects committing a workspace that is behind its branch (422)", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    // two workspaces on the same branch
    await client.getOrCreateWorkspace("landing-page", { workspaceId: "ws-a", branchName: "main" });
    await client.getOrCreateWorkspace("landing-page", { workspaceId: "ws-b", branchName: "main" });

    await client.writeWorkspaceFile("landing-page", "ws-a", "a.md", "from a");
    await client.commitWorkspace("landing-page", "ws-a", "main", { message: "a wins", author: AUTHOR });

    await client.writeWorkspaceFile("landing-page", "ws-b", "b.md", "from b");
    await expect(
      client.commitWorkspace("landing-page", "ws-b", "main", { message: "b is stale", author: AUTHOR }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("reads files and directories at a branch revision", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    await client.getOrCreateWorkspace("landing-page", { workspaceId: "ws-1", branchName: "main" });
    await client.writeWorkspaceFile("landing-page", "ws-1", "pages/home/sections/hero/punchy.md", "# Hi");
    await client.writeWorkspaceFile("landing-page", "ws-1", "pages/home/sections/hero/calm.md", "# Hello there");
    await client.commitWorkspace("landing-page", "ws-1", "main", { message: "seed", author: AUTHOR });

    expect(await client.readFile("landing-page", "main", "pages/home/sections/hero/punchy.md")).toBe("# Hi");

    const listing = await client.listDir("landing-page", "main", "pages/home/sections/hero");
    expect(listing.entries.map((e) => e.filename).sort()).toEqual(["calm.md", "punchy.md"]);
  });

  it("resolves branch names containing slashes in resource paths", async () => {
    await client.createRepo("landing-page", { user: AUTHOR });
    await client.createBranch("landing-page", "draft/user-123", "main");
    await client.getOrCreateWorkspace("landing-page", { workspaceId: "ws-1", branchName: "draft/user-123" });
    await client.writeWorkspaceFile("landing-page", "ws-1", "pages/home/doc.json", "{}");
    await client.commitWorkspace("landing-page", "ws-1", "draft/user-123", { message: "seed", author: AUTHOR });

    expect(await client.readFile("landing-page", "draft/user-123", "pages/home/doc.json")).toBe("{}");
  });

  it("surfaces API errors as OxenError with status", async () => {
    await expect(client.getRepo("does-not-exist")).rejects.toBeInstanceOf(OxenError);
    await expect(client.getRepo("does-not-exist")).rejects.toMatchObject({ status: 404 });
  });
});
