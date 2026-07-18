import { sql } from "drizzle-orm";
import { integer, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { apiKeys } from "./api-keys";
import { profiles } from "./profiles";
import { projects } from "./projects";

/**
 * Audit trail for MCP writes. Every mutating tool call an external agent
 * makes lands here: who (key + user), where (project), what (tool + slugs).
 * Deliberately NO copy content — slugs and identifiers only, so the audit
 * log never becomes a second store of the team's words.
 *
 * Written by the MCP request path (service role); members can read their
 * project's trail. No update/delete policies — an audit log is append-only.
 */
export const mcpAuditLog = pgTable(
  "mcp_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    /** Identifier-only context, e.g. {"page_slug":"home","section_slug":"hero"}. */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("mcp_audit_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.projectId} is not null and public.is_project_member(${table.projectId})`,
    }),
  ],
);

/**
 * Fixed-window rate accounting for API keys, one row per key per minute.
 * Incremented atomically by the consume_api_rate() SQL function (see the
 * companion migration); the MCP path refuses work once a window's count
 * exceeds its budget. Service-role only — no client policies at all.
 */
export const apiKeyRate = pgTable(
  "api_key_rate",
  {
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.apiKeyId, table.windowStart] })],
);
