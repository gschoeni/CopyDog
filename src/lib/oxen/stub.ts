import type { OxenBranch, OxenCommit, OxenDirEntry } from "./types";

/**
 * In-memory emulation of the slice of the Oxen HTTP API that CopyDog uses.
 * `stub.fetch` is a drop-in for the client's `fetchImpl`, so tests exercise
 * the real request/response serialization without a running oxen-server.
 *
 * Fidelity notes (mirrors documented behavior):
 * - commits are immutable snapshots; branches point at commits
 * - named workspaces are pinned to a branch's commit and fast-forward on commit
 * - committing a workspace whose base is behind its branch fails with 422
 */

interface StubCommit extends OxenCommit {
  /** full file tree at this commit: path -> content */
  files: Map<string, string>;
}

interface StubWorkspace {
  id: string;
  name?: string;
  branchName: string;
  baseCommitId: string;
  /** staged content by path; `null` marks a staged removal */
  staged: Map<string, string | null>;
}

interface StubRepo {
  namespace: string;
  name: string;
  branches: Map<string, string>; // branch name -> commit id
  commits: Map<string, StubCommit>;
  workspaces: Map<string, StubWorkspace>;
}

export class OxenStub {
  private repos = new Map<string, StubRepo>();
  private commitCounter = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    try {
      return await this.route(req);
    } catch (err) {
      if (err instanceof StubHttpError) {
        return json({ status: "error", status_message: err.message }, err.status);
      }
      throw err;
    }
  };

  /** Direct read of a committed file, for test assertions. */
  fileAt(repoName: string, branch: string, path: string): string | undefined {
    const repo = this.repos.get(repoName);
    const commitId = repo?.branches.get(branch);
    return commitId ? repo?.commits.get(commitId)?.files.get(path) : undefined;
  }

  branchHead(repoName: string, branch: string): string | undefined {
    return this.repos.get(repoName)?.branches.get(branch);
  }

  // -- routing -------------------------------------------------------------

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    // all routes start with /api/repos
    if (segments[0] !== "api" || segments[1] !== "repos") {
      throw new StubHttpError(404, `unknown route ${url.pathname}`);
    }

    if (segments.length === 2 && req.method === "POST") return this.createRepo(req);

    const [, , , repoName, resource, ...rest] = segments;
    const repo = this.repos.get(repoName ?? "");
    if (!repo) throw new StubHttpError(404, `repo not found: ${repoName}`);

    if (!resource && req.method === "GET") {
      return json({ status: "success", repository: { namespace: repo.namespace, name: repo.name } });
    }
    if (!resource && req.method === "DELETE") {
      this.repos.delete(repo.name);
      return json({ status: "success" });
    }

    switch (resource) {
      case "branches":
        return this.routeBranches(req, repo, rest);
      case "file":
        return this.readFile(repo, rest);
      case "dir":
        return this.listDir(repo, rest);
      case "workspaces":
        return this.routeWorkspaces(req, repo, rest);
      default:
        throw new StubHttpError(404, `unknown resource: ${resource}`);
    }
  }

  private async createRepo(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      namespace: string;
      name: string;
      user: { name: string; email: string };
      files?: { path: string; contents: string }[];
    };
    if (this.repos.has(body.name)) throw new StubHttpError(400, `repo exists: ${body.name}`);
    const repo: StubRepo = {
      namespace: body.namespace,
      name: body.name,
      branches: new Map(),
      commits: new Map(),
      workspaces: new Map(),
    };
    // seed files land in the root commit, mirroring hub's RepoNew.files
    const seeded = new Map((body.files ?? []).map((file) => [file.path, file.contents]));
    const initial = this.makeCommit(repo, [], "Initialized repo", body.user.name, body.user.email, seeded);
    repo.branches.set("main", initial.id);
    this.repos.set(body.name, repo);
    return json({
      status: "success",
      status_message: "resource_created",
      repository: { namespace: repo.namespace, name: repo.name, latest_commit: toApiCommit(initial) },
    });
  }

  private async routeBranches(req: Request, repo: StubRepo, rest: string[]): Promise<Response> {
    if (rest.length === 0 && req.method === "GET") {
      const branches: OxenBranch[] = [...repo.branches.entries()].map(([name, commit_id]) => ({ name, commit_id }));
      return json({ status: "success", branches });
    }
    if (rest.length === 0 && req.method === "POST") {
      const body = (await req.json()) as { new_name: string; from_name: string };
      const existing = repo.branches.get(body.new_name);
      if (existing !== undefined) {
        return json({ status: "success", branch: { name: body.new_name, commit_id: existing } });
      }
      const fromCommit = repo.branches.get(body.from_name) ?? (repo.commits.has(body.from_name) ? body.from_name : undefined);
      if (!fromCommit) throw new StubHttpError(404, `revision not found: ${body.from_name}`);
      repo.branches.set(body.new_name, fromCommit);
      return json({ status: "success", branch: { name: body.new_name, commit_id: fromCommit } });
    }
    // GET /branches/{name} — branch names may contain slashes
    if (req.method === "GET") {
      const name = rest.join("/");
      const commitId = repo.branches.get(name);
      if (!commitId) throw new StubHttpError(404, `branch not found: ${name}`);
      return json({ status: "success", branch: { name, commit_id: commitId } });
    }
    throw new StubHttpError(404, "unsupported branches route");
  }

  private readFile(repo: StubRepo, resourceSegments: string[]): Response {
    const { commit, path } = this.resolveResource(repo, resourceSegments);
    const content = commit.files.get(path);
    if (content === undefined) throw new StubHttpError(404, `file not found: ${path}`);
    return new Response(content, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  }

  private listDir(repo: StubRepo, resourceSegments: string[]): Response {
    const { commit, path } = this.resolveResource(repo, resourceSegments);
    const prefix = path ? `${path}/` : "";
    const names = new Map<string, OxenDirEntry>();
    for (const [filePath] of commit.files) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      const [head] = remainder.split("/");
      if (!head || names.has(head)) continue;
      const isDir = remainder.includes("/");
      names.set(head, {
        filename: head,
        hash: "",
        is_dir: isDir,
        size: isDir ? 0 : (commit.files.get(filePath)?.length ?? 0),
        data_type: isDir ? "dir" : "text",
        mime_type: isDir ? "inode/directory" : "text/plain",
        extension: isDir ? "" : (head.split(".").pop() ?? ""),
      });
    }
    const entries = [...names.values()];
    return json({
      status: "success",
      entries,
      page_number: 0,
      page_size: entries.length,
      total_pages: 1,
      total_entries: entries.length,
    });
  }

  private async routeWorkspaces(req: Request, repo: StubRepo, rest: string[]): Promise<Response> {
    // modern servers: PUT /workspaces/get_or_create; older: PUT /workspaces
    if ((rest[0] === "get_or_create" || rest.length === 0) && req.method === "PUT") {
      const body = (await req.json()) as { workspace_id: string; branch_name: string; name?: string };
      let ws = repo.workspaces.get(body.workspace_id);
      if (!ws) {
        const baseCommitId = repo.branches.get(body.branch_name);
        if (!baseCommitId) throw new StubHttpError(404, `branch not found: ${body.branch_name}`);
        ws = {
          id: body.workspace_id,
          name: body.name,
          branchName: body.branch_name,
          baseCommitId,
          staged: new Map(),
        };
        repo.workspaces.set(ws.id, ws);
      }
      const commit = repo.commits.get(ws.baseCommitId)!;
      return json({ status: "success", workspace: { id: ws.id, name: ws.name, commit: toApiCommit(commit) } });
    }

    const wsId = rest[0];
    const ws = wsId ? repo.workspaces.get(wsId) : undefined;
    if (!ws) throw new StubHttpError(404, `workspace not found: ${wsId}`);

    if (rest.length === 1 && req.method === "DELETE") {
      repo.workspaces.delete(ws.id);
      return json({ status: "success" });
    }

    if (rest[1] === "changes" && req.method === "GET") {
      const base = repo.commits.get(ws.baseCommitId)!;
      const added: { filename: string }[] = [];
      const modified: { filename: string }[] = [];
      const removed: { filename: string }[] = [];
      for (const [path, content] of ws.staged) {
        if (content === null) removed.push({ filename: path });
        else (base.files.has(path) ? modified : added).push({ filename: path });
      }
      return json({
        status: "success",
        staged: {
          added_dirs: {},
          added_files: { entries: added },
          modified_files: { entries: modified },
          removed_files: { entries: removed },
        },
      });
    }

    if (rest[1] === "files") {
      const path = rest.slice(2).join("/");
      if (req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new StubHttpError(400, "missing multipart part: file");
        const fullPath = path ? `${path}/${file.name}` : file.name;
        ws.staged.set(fullPath, await file.text());
        return json({ status: "success", paths: [fullPath] });
      }
      if (req.method === "GET") {
        const staged = ws.staged.get(path);
        if (staged === null) throw new StubHttpError(404, `file not found: ${path}`);
        const content = staged ?? repo.commits.get(ws.baseCommitId)!.files.get(path);
        if (content === undefined) throw new StubHttpError(404, `file not found: ${path}`);
        return new Response(content, { status: 200 });
      }
      if (req.method === "DELETE" && path === "") {
        // stages removals; paths absent from both stage and base are reported back
        const paths = (await req.json()) as string[];
        const base = repo.commits.get(ws.baseCommitId)!;
        const missing: string[] = [];
        for (const p of paths) {
          const staged = ws.staged.get(p);
          if (staged === undefined && !base.files.has(p)) {
            missing.push(p);
            continue;
          }
          if (base.files.has(p)) ws.staged.set(p, null);
          else ws.staged.delete(p); // never committed — unstage entirely
        }
        return json({ status: "success", paths: missing.length ? missing : paths }, missing.length ? 206 : 200);
      }
    }

    if (rest[1] === "merge" && req.method === "POST") {
      const branch = rest.slice(2).join("/");
      const body = (await req.json()) as { message: string; author: string; email: string };
      const branchHead = repo.branches.get(branch);
      if (!branchHead) throw new StubHttpError(404, `branch not found: ${branch}`);
      if (branchHead !== ws.baseCommitId) {
        throw new StubHttpError(422, "workspace is behind the target branch");
      }
      const baseFiles = new Map(repo.commits.get(ws.baseCommitId)!.files);
      for (const [p, content] of ws.staged) {
        if (content === null) baseFiles.delete(p);
        else baseFiles.set(p, content);
      }
      const commit = this.makeCommit(repo, [branchHead], body.message, body.author, body.email, baseFiles);
      repo.branches.set(branch, commit.id);
      // named workspaces persist and fast-forward to the new head
      ws.baseCommitId = commit.id;
      ws.staged.clear();
      return json({ status: "success", commit: toApiCommit(commit) });
    }

    throw new StubHttpError(404, "unsupported workspaces route");
  }

  // -- helpers ---------------------------------------------------------------

  /** Resource paths embed the revision: longest matching branch name wins, then commit ids. */
  private resolveResource(repo: StubRepo, segments: string[]): { commit: StubCommit; path: string } {
    for (let take = segments.length; take >= 1; take--) {
      const candidate = segments.slice(0, take).join("/");
      const commitId = repo.branches.get(candidate) ?? (repo.commits.has(candidate) ? candidate : undefined);
      if (commitId) {
        return { commit: repo.commits.get(commitId)!, path: segments.slice(take).join("/") };
      }
    }
    throw new StubHttpError(404, `revision not found in resource: ${segments.join("/")}`);
  }

  private makeCommit(
    repo: StubRepo,
    parentIds: string[],
    message: string,
    author: string,
    email: string,
    files: Map<string, string>,
  ): StubCommit {
    const commit: StubCommit = {
      id: `commit-${++this.commitCounter}`,
      parent_ids: parentIds,
      message,
      author,
      email,
      timestamp: new Date(0).toISOString(),
      files,
    };
    repo.commits.set(commit.id, commit);
    return commit;
  }
}

class StubHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function toApiCommit(commit: StubCommit): OxenCommit {
  const { files: _files, ...rest } = commit;
  return rest;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
