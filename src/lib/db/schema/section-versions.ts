import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";
import { projects } from "./projects";

/**
 * Index of *published* copy versions — refreshed from a user's doc.json
 * every time they publish. This is how teammates discover each other's
 * versions without scanning Oxen branches. Draft-only (unpublished)
 * versions are intentionally absent: private until published.
 */
export const sectionVersions = pgTable(
  "section_versions",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    pageSlug: text("page_slug").notNull(),
    sectionSlug: text("section_slug").notNull(),
    versionSlug: text("version_slug").notNull(),
    label: text("label").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.authorId, table.pageSlug, table.sectionSlug, table.versionSlug],
    }),
    pgPolicy("section_versions_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
    }),
    pgPolicy("section_versions_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`public.is_project_member(${table.projectId}) and ${table.authorId} = ${authUid}`,
    }),
    pgPolicy("section_versions_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.authorId} = ${authUid}`,
      withCheck: sql`${table.authorId} = ${authUid}`,
    }),
    pgPolicy("section_versions_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.authorId} = ${authUid}`,
    }),
  ],
);
