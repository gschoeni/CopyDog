import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole } from "drizzle-orm/supabase";

import { profiles } from "./profiles";

/**
 * What a key may do, least to most powerful. Scopes are independent flags,
 * not a hierarchy — enforcement lives in the MCP tool registry:
 *  - read:   list/get/diff — no writes anywhere
 *  - write:  edits to the owner's private draft (copy, layouts, pages)
 *  - collab: publish, propose, close, comment — visible to the team
 *  - merge:  merge proposals onto main; opt-in, never granted by default,
 *            and even with it a key cannot merge its owner's own proposals
 */
export const API_KEY_SCOPES = ["read", "write", "collab", "merge"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Personal API keys for programmatic access (the MCP endpoint). Only a
 * SHA-256 hash of the secret is stored — the plaintext key is shown once at
 * creation and never again. `key_prefix` exists purely so the UI can show
 * "cdk_a1b2c3d4…" for recognition.
 *
 * RLS covers the browser paths (mint, list, revoke — always as yourself).
 * The MCP request path authenticates by hash lookup through the service-role
 * client in src/lib/mcp/auth.ts, which is the one place allowed to bypass RLS.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{read}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null = no expiry; verification treats past-expiry like revoked. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("api_keys_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${table.userId} = ${authUid}`,
    }),
    pgPolicy("api_keys_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${table.userId} = ${authUid}`,
    }),
    // update exists only to set revoked_at — keys are never edited
    pgPolicy("api_keys_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${table.userId} = ${authUid}`,
      withCheck: sql`${table.userId} = ${authUid}`,
    }),
    pgPolicy("api_keys_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${table.userId} = ${authUid}`,
    }),
  ],
);
