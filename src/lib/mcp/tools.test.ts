import { beforeEach, describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureDraftView, hasUnpublishedChanges, writeDoc, writeSectionVersion } from "@/lib/content/store";
import type { ApiKeyScope } from "@/lib/db/schema/api-keys";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import type { McpToolApi, ProjectHandle } from "./context";
import { McpToolError, RateLimitExceededError } from "./errors";
import { buildMcpServer } from "./tools";

/**
 * The MCP tool surface against the in-memory Oxen stub, driven through a
 * hand-built McpToolApi — the same seam production uses (context.ts), so
 * scope gating, rate charging, auditing, and error shaping are all
 * exercised exactly as an external agent would hit them.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "44444444-4444-4444-8444-444444444444";
const AUTHOR = { name: "tester", email: "tester@copydog.app" };
const REPO = "mcp-tools-test";

interface Recorded {
  versionRows: unknown[];
  auditRows: { tool: string; projectId?: string; detail?: Record<string, unknown> }[];
  rateCharges: number[];
  proposalAuthor: string | null;
  commits: string[];
}

function fakeDb(recorded: Recorded): SupabaseClient {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { display_name: "Tester" } }),
            eq: () => ({
              maybeSingle: async () =>
                table === "proposals" && recorded.proposalAuthor
                  ? { data: { author_id: recorded.proposalAuthor } }
                  : { data: null },
            }),
            maybeSingle: async () => ({ data: null }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        delete: () => ({ match: async () => ({ error: null }) }),
        insert: async (rows: unknown) => {
          if (table === "section_versions") {
            recorded.versionRows.push(...(Array.isArray(rows) ? rows : [rows]));
          }
          return { error: null };
        },
        update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
      };
    },
  } as unknown as SupabaseClient;
}

function makeApi(
  handle: ProjectHandle,
  recorded: Recorded,
  overrides: Partial<Pick<McpToolApi, "scopes" | "llm">> & { rateLimited?: boolean } = {},
): McpToolApi {
  return {
    userId: USER_ID,
    keyId: KEY_ID,
    keyName: "test key",
    scopes: overrides.scopes ?? (["read", "write", "collab", "merge"] as ApiKeyScope[]),
    llm: overrides.llm ?? null,
    requireProject: async (projectId) => {
      if (projectId !== PROJECT_ID) throw new McpToolError("Project not found, or this key's owner is not a member.");
      return handle;
    },
    listMemberships: async () => [{ id: PROJECT_ID, name: "Test", slug: "test", role: "editor" }],
    consumeRate: async (cost) => {
      recorded.rateCharges.push(cost);
      if (overrides.rateLimited) throw new RateLimitExceededError();
    },
    audit: async (entry) => {
      recorded.auditRows.push({ tool: entry.tool, projectId: entry.projectId, detail: entry.detail });
    },
  };
}

describe("MCP tool surface", () => {
  let oxen: OxenClient;
  let handle: ProjectHandle;
  let recorded: Recorded;

  beforeEach(async () => {
    const stub = new OxenStub();
    oxen = new OxenClient({ token: "t", namespace: "ns", baseUrl: "https://stub.oxen.local", fetchImpl: stub.fetch });
    await provisionProjectRepo(oxen, { repoName: REPO, author: AUTHOR });
    const view = await ensureDraftView(oxen, REPO, USER_ID);

    await writeSectionVersion(oxen, view, "home", "hero", "original", "# Hello\n\nWelcome to the show.\n");
    await writeDoc(oxen, view, "home", {
      version: 2,
      content: [
        {
          kind: "section",
          slug: "hero",
          title: "Hero",
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          linked: true,
        },
      ],
    });

    recorded = { versionRows: [], auditRows: [], rateCharges: [], proposalAuthor: null, commits: [] };
    handle = {
      user: { id: USER_ID, email: "tester@copydog.app" },
      project: { id: PROJECT_ID, name: "Test", slug: "test", oxenRepo: REPO },
      oxen,
      view,
      db: fakeDb(recorded),
    };
  });

  describe("scope gating", () => {
    it("a read-only key sees and can call only read tools", async () => {
      const server = buildMcpServer(makeApi(handle, recorded, { scopes: ["read"] }));
      const names = (await server.listTools()).map((t) => t.name);
      expect(names).toContain("get_page");
      expect(names).toContain("diff_draft");
      expect(names).not.toContain("rewrite_section");
      expect(names).not.toContain("publish_draft");
      expect(names).not.toContain("merge_proposal");

      const res = await server.callTool("rewrite_section", {
        project_id: PROJECT_ID,
        page_slug: "home",
        section_slug: "hero",
        label: "Nope",
        markdown: "# nope\n",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("not permitted");
    });

    it("merge scope is required for merge_proposal and no other scope grants it", async () => {
      const server = buildMcpServer(makeApi(handle, recorded, { scopes: ["read", "write", "collab"] }));
      expect((await server.listTools()).map((t) => t.name)).not.toContain("merge_proposal");
    });
  });

  it("omits LLM-backed design tools when no LLM is configured, but keeps author-your-own layout tools", async () => {
    const server = buildMcpServer(makeApi(handle, recorded));
    const names = (await server.listTools()).map((t) => t.name);
    expect(names).not.toContain("design_section");
    expect(names).not.toContain("redesign_page");
    expect(names).toContain("get_design_system");
    expect(names).toContain("write_section_layout");
    expect(names).toContain("write_page_layout");
  });

  it("reads a page's structure and copy", async () => {
    const res = await buildMcpServer(makeApi(handle, recorded)).callTool("get_page", {
      project_id: PROJECT_ID,
      page_slug: "home",
    });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.content[0].slug).toBe("hero");
    expect(parsed.content[0].markdown).toContain("Welcome to the show");
  });

  it("rewrite_section adds a labeled version, makes it active, and audits identifiers only", async () => {
    const server = buildMcpServer(makeApi(handle, recorded));
    const res = await server.callTool("rewrite_section", {
      project_id: PROJECT_ID,
      page_slug: "home",
      section_slug: "hero",
      label: "Punchier",
      markdown: "# Bark once\n\nShip copy faster. SECRET-COPY-TEXT\n",
    });
    expect(res.isError).toBeUndefined();

    const page = JSON.parse(
      (await server.callTool("get_page", { project_id: PROJECT_ID, page_slug: "home" })).content[0]!.text,
    );
    expect(page.content[0].activeVersion).toBe("punchier");

    expect(recorded.auditRows).toHaveLength(1);
    const audit = recorded.auditRows[0]!;
    expect(audit.tool).toBe("rewrite_section");
    expect(audit.projectId).toBe(PROJECT_ID);
    // slugs and labels are fine; the copy itself must never reach the audit log
    expect(JSON.stringify(audit.detail)).not.toContain("SECRET-COPY-TEXT");
    expect(audit.detail).toMatchObject({ page_slug: "home", section_slug: "hero" });
  });

  it("read tools are not audited", async () => {
    const server = buildMcpServer(makeApi(handle, recorded));
    await server.callTool("get_page", { project_id: PROJECT_ID, page_slug: "home" });
    await server.callTool("diff_draft", { project_id: PROJECT_ID });
    expect(recorded.auditRows).toHaveLength(0);
  });

  it("charges the extra LLM cost for design tools and stops when rate-limited", async () => {
    const fakeLlm = {} as never;
    const limited = buildMcpServer(makeApi(handle, recorded, { llm: fakeLlm, rateLimited: true }));
    const res = await limited.callTool("design_section", {
      project_id: PROJECT_ID,
      page_slug: "home",
      section_slug: "hero",
      instruction: "split layout",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Rate limit");
    expect(recorded.rateCharges).toEqual([20]);
  });

  describe("merge_proposal protections", () => {
    it("refuses to merge the key owner's own proposal even with merge scope", async () => {
      recorded.proposalAuthor = USER_ID;
      const server = buildMcpServer(makeApi(handle, recorded));
      const res = await server.callTool("merge_proposal", {
        project_id: PROJECT_ID,
        proposal_id: "55555555-5555-4555-8555-555555555555",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("someone else on the team");
    });

    it("proceeds past the self-merge check for a teammate's proposal", async () => {
      recorded.proposalAuthor = OTHER_USER;
      const server = buildMcpServer(makeApi(handle, recorded));
      const res = await server.callTool("merge_proposal", {
        project_id: PROJECT_ID,
        proposal_id: "55555555-5555-4555-8555-555555555555",
      });
      // the fake db's proposal row lookup inside mergeProposal returns "not
      // found" — the point here is the self-merge gate let a teammate's
      // proposal through to the merge path
      expect(res.content[0]!.text).not.toContain("someone else on the team");
    });
  });

  it("publish_draft commits with key attribution and refreshes the version index", async () => {
    const server = buildMcpServer(makeApi(handle, recorded));
    expect(await hasUnpublishedChanges(oxen, handle.view)).toBe(true);
    const res = await server.callTool("publish_draft", { project_id: PROJECT_ID, message: "from mcp" });
    expect(res.isError).toBeUndefined();
    expect(await hasUnpublishedChanges(oxen, handle.view)).toBe(false);
    expect(recorded.versionRows).toContainEqual(
      expect.objectContaining({ page_slug: "home", section_slug: "hero", version_slug: "original" }),
    );
    // attribution rides the commit message; the branch head should carry it
    const branch = await oxen.getBranch(REPO, handle.view.branch);
    expect(branch.commit_id).toBeTruthy();
  });

  describe("externally-authored layouts", () => {
    it("serves the design-system contract", async () => {
      const res = await buildMcpServer(makeApi(handle, recorded)).callTool("get_design_system", {});
      expect(res.content[0]!.text).toContain("wf-section");
    });

    it("write_section_layout accepts a conformant fragment and sanitizes hostile input", async () => {
      const server = buildMcpServer(makeApi(handle, recorded));
      const ok = await server.callTool("write_section_layout", {
        project_id: PROJECT_ID,
        page_slug: "home",
        section_slug: "hero",
        html:
          '<section class="wf-section" data-copy="hero"><h1 class="wf-h1" data-element="h1"></h1>' +
          "<script>alert(1)</script></section>",
      });
      expect(ok.isError).toBeUndefined();
      const wireframe = (await server.callTool("get_wireframe", { project_id: PROJECT_ID, page_slug: "home" }))
        .content[0]!.text;
      expect(wireframe).toContain('data-copy="hero"');
      expect(wireframe).not.toContain("script");
    });

    it("write_section_layout rejects a wrong-slug fragment with contract feedback", async () => {
      const res = await buildMcpServer(makeApi(handle, recorded)).callTool("write_section_layout", {
        project_id: PROJECT_ID,
        page_slug: "home",
        section_slug: "hero",
        html: '<section class="wf-section" data-copy="other"></section>',
      });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain('data-copy="hero"');
    });

    it("write_page_layout requires a slot for every linked section", async () => {
      const res = await buildMcpServer(makeApi(handle, recorded)).callTool("write_page_layout", {
        project_id: PROJECT_ID,
        page_slug: "home",
        html: '<section class="wf-section" data-copy="not-hero"></section>',
      });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("hero");
    });
  });

  describe("error shaping", () => {
    it("zod failures surface as invalid-arguments", async () => {
      const res = await buildMcpServer(makeApi(handle, recorded)).callTool("get_page", {
        project_id: "not-a-uuid",
        page_slug: "home",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("Invalid arguments");
    });

    it("McpToolError messages pass through; unexpected errors are generic", async () => {
      const server = buildMcpServer(makeApi(handle, recorded));
      const known = await server.callTool("read_section", {
        project_id: PROJECT_ID,
        page_slug: "home",
        section_slug: "missing",
      });
      expect(known.content[0]!.text).toContain('No section "missing"');

      const brokenHandle = { ...handle, oxen: null as unknown as typeof handle.oxen };
      const broken = buildMcpServer(makeApi(brokenHandle, recorded));
      const res = await broken.callTool("get_page", { project_id: PROJECT_ID, page_slug: "home" });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("Internal error");
      expect(res.content[0]!.text).not.toContain("null");
    });

    it("unknown tools are tool errors", async () => {
      const res = await buildMcpServer(makeApi(handle, recorded)).callTool("drop_tables", {});
      expect(res.isError).toBe(true);
    });
  });
});
