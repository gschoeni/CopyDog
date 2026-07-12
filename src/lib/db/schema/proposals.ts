import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";
import { projects } from "./projects";

export const proposalStatus = pgEnum("proposal_status", ["open", "merged", "closed"]);

/**
 * PR-style proposals: "make my draft the team's copy." The diff itself is
 * computed live from Oxen (source branch vs main); this row is the
 * queryable index entry and audit trail.
 */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sourceBranch: text("source_branch").notNull(),
    /** main's head when the proposal was opened */
    baseCommit: text("base_commit").notNull(),
    status: proposalStatus("status").notNull().default("open"),
    mergedCommit: text("merged_commit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("proposals_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
    }),
    pgPolicy("proposals_insert_members_as_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`public.is_project_member(${table.projectId}) and ${table.authorId} = ${authUid}`,
    }),
    // v1: every editor can merge or close — the review moment is social,
    // not gated (matches "everyone is an editor")
    pgPolicy("proposals_update_members", {
      for: "update",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
      withCheck: sql`public.is_project_member(${table.projectId})`,
    }),
  ],
);
