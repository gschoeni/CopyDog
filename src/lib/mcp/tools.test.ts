import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProjectAccess } from "@/lib/content/access";
import { ensureDraftView, hasUnpublishedChanges, writeDoc, writeSectionVersion } from "@/lib/content/store";
import { OxenClient } from "@/lib/oxen/client";
import { provisionProjectRepo } from "@/lib/oxen/provision";
import { OxenStub } from "@/lib/oxen/stub";

import { buildMcpServer, type McpContext } from "./tools";

/**
 * The MCP tool surface against the in-memory Oxen stub. The access gate is
 * mocked (it's the one seam that needs live Supabase + env); everything
 * below it — store, agent tools, collab — runs for real.
 */

const state = vi.hoisted(() => ({ access: null as ProjectAccess | null }));

vi.mock("@/lib/content/access", () => ({
  requireProjectAccessAs: async () => {
    if (!state.access) throw new Error("test access not configured");
    return state.access;
  },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR = { name: "tester", email: "tester@copydog.app" };
const REPO = "mcp-tools-test";

function fakeSupabase(recorded: { versionRows: unknown[] }): SupabaseClient {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { display_name: "Tester" } }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
        delete: () => ({ match: async () => ({ error: null }) }),
        insert: async (rows: unknown) => {
          if (table === "section_versions") {
            recorded.versionRows.push(...(Array.isArray(rows) ? rows : [rows]));
          }
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("MCP tool surface", () => {
  let oxen: OxenClient;
  let ctx: McpContext;
  let recorded: { versionRows: unknown[] };

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

    recorded = { versionRows: [] };
    state.access = {
      user: { id: USER_ID, email: "tester@copydog.app" },
      project: { id: PROJECT_ID, name: "Test", slug: "test", oxenRepo: REPO },
      oxen,
      view,
    };
    ctx = { userId: USER_ID, supabase: fakeSupabase(recorded), llm: null };
  });

  it("omits LLM-backed design tools when no LLM is configured", async () => {
    const names = (await buildMcpServer(ctx).listTools()).map((t) => t.name);
    expect(names).toContain("rewrite_section");
    expect(names).toContain("publish_draft");
    expect(names).not.toContain("design_section");
    expect(names).not.toContain("redesign_page");
    // and calling one anyway is a tool error, not a crash
    const res = await buildMcpServer(ctx).callTool("design_section", {
      project_id: PROJECT_ID,
      page_slug: "home",
      section_slug: "hero",
      instruction: "split layout",
    });
    expect(res.isError).toBe(true);
  });

  it("reads a page's structure and copy", async () => {
    const res = await buildMcpServer(ctx).callTool("get_page", { project_id: PROJECT_ID, page_slug: "home" });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.content).toHaveLength(1);
    expect(parsed.content[0].slug).toBe("hero");
    expect(parsed.content[0].markdown).toContain("Welcome to the show");
  });

  it("rewrite_section adds a labeled version and makes it active (via the chat agent's tool)", async () => {
    const server = buildMcpServer(ctx);
    const res = await server.callTool("rewrite_section", {
      project_id: PROJECT_ID,
      page_slug: "home",
      section_slug: "hero",
      label: "Punchier",
      markdown: "# Bark once\n\nShip copy faster.\n",
    });
    expect(res.isError).toBeUndefined();

    const page = JSON.parse((await server.callTool("get_page", { project_id: PROJECT_ID, page_slug: "home" })).content[0]!.text);
    const hero = page.content[0];
    expect(hero.versions).toHaveLength(2);
    expect(hero.activeVersion).toBe("punchier");
    expect(hero.markdown).toContain("Bark once");
  });

  it("update_section refuses to invent versions", async () => {
    const res = await buildMcpServer(ctx).callTool("update_section", {
      project_id: PROJECT_ID,
      page_slug: "home",
      section_slug: "hero",
      version_slug: "nope",
      markdown: "# Nope\n",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('no version "nope"');
  });

  it("publish_draft commits staged edits and refreshes the version index", async () => {
    const server = buildMcpServer(ctx);
    expect(await hasUnpublishedChanges(oxen, state.access!.view)).toBe(true);

    const res = await server.callTool("publish_draft", { project_id: PROJECT_ID, message: "from mcp" });
    expect(res.isError).toBeUndefined();
    expect(await hasUnpublishedChanges(oxen, state.access!.view)).toBe(false);
    expect(recorded.versionRows).toContainEqual(
      expect.objectContaining({ page_slug: "home", section_slug: "hero", version_slug: "original" }),
    );
  });

  it("validates arguments through zod before touching anything", async () => {
    const res = await buildMcpServer(ctx).callTool("get_page", { project_id: "not-a-uuid", page_slug: "home" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Invalid arguments");
  });

  it("reports unknown tools as tool errors", async () => {
    const res = await buildMcpServer(ctx).callTool("drop_tables", {});
    expect(res.isError).toBe(true);
  });
});
