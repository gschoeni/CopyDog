import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";

/**
 * A project is a multi-page website. Content lives in the project's Oxen
 * repo (`oxen_repo`); this row is the queryable index entry.
 *
 * Inserts go through the `create_project()` SECURITY DEFINER function so the
 * project row and its owner membership land atomically — hence no insert
 * policy here.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    oxenRepo: text("oxen_repo").notNull().unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("projects_select_members", {
      for: "select",
      to: authenticatedRole,
      using: sql`public.is_project_member(${table.id})`,
    }),
    pgPolicy("projects_update_owner", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.ownerId} = ${authUid}`,
      withCheck: sql`${table.ownerId} = ${authUid}`,
    }),
    pgPolicy("projects_delete_owner", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.ownerId} = ${authUid}`,
    }),
  ],
);
