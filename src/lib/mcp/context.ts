import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireProjectAccessAs, type ProjectAccess } from "@/lib/content/access";
import type { ApiKeyScope } from "@/lib/db/schema/api-keys";
import { getLlmClient } from "@/lib/llm";
import type { LlmClient } from "@/lib/llm/client";
import { createAdminClient } from "@/lib/supabase/admin";

import { McpToolError, RateLimitExceededError } from "./errors";
import { verifyApiKey } from "./keys";

/**
 * The MCP request's capability object — and the security boundary made
 * structural. This is the ONLY module that may import the service-role
 * client (enforced by eslint no-restricted-imports); tools never hold it.
 * A tool that wants data must call `requireProject()`, which performs the
 * membership gate and only then hands back a db handle. Cross-tenant
 * access isn't a code-review catch anymore — it's unrepresentable in a
 * tool body.
 */

/** Total request budget per key per minute; LLM-backed tools draw extra. */
export const RATE_BUDGET_PER_MINUTE = 240;
export const LLM_TOOL_COST = 20;

/** Project access plus the db handle that access legitimizes. */
export interface ProjectHandle extends ProjectAccess {
  db: SupabaseClient;
}

export interface McpToolApi {
  userId: string;
  keyId: string;
  keyName: string;
  scopes: ApiKeyScope[];
  llm: LlmClient | null;
  /** Membership gate — the only door to project data. Throws McpToolError. */
  requireProject(projectId: string): Promise<ProjectHandle>;
  /** The one project-less read: the caller's own memberships. */
  listMemberships(): Promise<{ id: string; name: string; slug: string; role: string }[]>;
  /** Draws from the key's per-minute budget; throws RateLimitExceededError. */
  consumeRate(cost: number): Promise<void>;
  /** Append-only attribution trail. Identifiers only — never copy content. */
  audit(entry: { projectId?: string; tool: string; detail?: Record<string, unknown> }): Promise<void>;
}

/** Resolves a bearer key to a tool API, or null when the key doesn't stand. */
export async function authenticateMcp(bearerKey: string): Promise<McpToolApi | null> {
  const admin = createAdminClient();
  const identity = await verifyApiKey(admin, bearerKey);
  if (!identity) return null;

  return {
    userId: identity.userId,
    keyId: identity.keyId,
    keyName: identity.keyName,
    scopes: identity.scopes.filter(isScope),
    llm: getLlmClient(),

    async requireProject(projectId) {
      try {
        const access = await requireProjectAccessAs(admin, identity.userId, projectId);
        return { ...access, db: admin };
      } catch (err) {
        // access failures carry internals (repo names, store errors) meant
        // for our logs, not the connected agent
        console.error("mcp project access failed", err);
        throw new McpToolError("Project not found, or this key's owner is not a member.");
      }
    },

    async listMemberships() {
      const { data, error } = await admin
        .from("project_members")
        .select("role, projects(id, name, slug)")
        .eq("user_id", identity.userId);
      if (error) {
        console.error("mcp membership list failed", error);
        throw new McpToolError("Couldn't list projects.");
      }
      return (data ?? []).flatMap((row) => {
        const p = row.projects as unknown as { id: string; name: string; slug: string } | null;
        return p ? [{ id: p.id, name: p.name, slug: p.slug, role: row.role as string }] : [];
      });
    },

    async consumeRate(cost) {
      const { data, error } = await admin.rpc("consume_api_rate", { p_key_id: identity.keyId, p_cost: cost });
      if (error) {
        // fail closed: if we can't account for usage we don't do the work
        console.error("mcp rate accounting failed", error);
        throw new McpToolError("Temporarily unavailable — try again shortly.");
      }
      if (typeof data === "number" && data > RATE_BUDGET_PER_MINUTE) {
        throw new RateLimitExceededError();
      }
    },

    async audit(entry) {
      const { error } = await admin.from("mcp_audit_log").insert({
        api_key_id: identity.keyId,
        user_id: identity.userId,
        project_id: entry.projectId ?? null,
        tool: entry.tool,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
      });
      // an audit miss must not fail the user's action, but it must be loud
      if (error) console.error("mcp audit write failed", error);
    },
  };
}

function isScope(value: string): value is ApiKeyScope {
  return value === "read" || value === "write" || value === "collab" || value === "merge";
}
