import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";
import { projects } from "./projects";

/** v1 keeps roles simple: everyone edits; owners can also manage the project. */
export const projectRole = pgEnum("project_role", ["owner", "editor"]);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    // membership checks go through SECURITY DEFINER helpers to avoid
    // recursive RLS evaluation on this same table
    pgPolicy("project_members_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.projectId})`,
    }),
    pgPolicy("project_members_insert_owner", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`public.is_project_owner(${table.projectId})`,
    }),
    pgPolicy("project_members_delete_owner_or_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`public.is_project_owner(${table.projectId}) or ${table.userId} = ${authUid}`,
    }),
  ],
);
