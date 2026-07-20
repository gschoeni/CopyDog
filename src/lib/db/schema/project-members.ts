import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";
import { projects } from "./projects";

/**
 * Three roles: owners manage the project, editors write, viewers only read.
 * "May write" checks go through public.is_project_editor (owner or editor);
 * viewer is the read-only client seat.
 */
export const projectRole = pgEnum("project_role", ["owner", "editor", "viewer"]);

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
    // owners set other members' roles; never their own row, so a project
    // can't demote its way to zero owners. Protecting the project creator
    // (projects.owner_id) is app logic in the settings actions, not RLS —
    // demoting the creator is a footgun, not a privilege escalation.
    pgPolicy("project_members_update_owner_not_self", {
      for: "update",
      to: authenticatedRole,
      using: sql`public.is_project_owner(${table.projectId}) and ${table.userId} <> ${authUid}`,
      withCheck: sql`public.is_project_owner(${table.projectId}) and ${table.userId} <> ${authUid}`,
    }),
  ],
);
