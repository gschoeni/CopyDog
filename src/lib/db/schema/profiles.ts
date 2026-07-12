import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authUsers, authenticatedRole } from "drizzle-orm/supabase";

/**
 * One row per auth user, created automatically by the `handle_new_user`
 * trigger (see the auth-functions migration). App-facing identity only —
 * auth itself lives in auth.users.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // any signed-in user can see names/avatars (needed to render collaborators)
    pgPolicy("profiles_select_authenticated", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
    pgPolicy("profiles_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.id}`,
      withCheck: sql`${authUid} = ${table.id}`,
    }),
  ],
);
