import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";
import { projects } from "./projects";

/**
 * Notes on sections — feedback and stray thoughts that are *about* the copy
 * but are not copy. Queryable app state, so it lives in Postgres, addressed
 * by (project, page slug, section slug) into the Oxen content.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pageSlug: text("page_slug").notNull(),
    sectionSlug: text("section_slug").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("comments_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
    }),
    pgPolicy("comments_insert_members_as_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`public.is_project_member(${table.projectId}) and ${table.authorId} = ${authUid}`,
    }),
    // any member can resolve/unresolve (clients resolve their feedback loops)
    pgPolicy("comments_update_members", {
      for: "update",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
      withCheck: sql`public.is_project_member(${table.projectId})`,
    }),
    pgPolicy("comments_delete_author", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.authorId} = ${authUid}`,
    }),
  ],
);
