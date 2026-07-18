import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Personal API keys: `cdk_` + 43 chars of base64url (32 random bytes).
 * The database stores only sha256(key); the plaintext exists exactly once,
 * in the response to the mint request.
 */

export const API_KEY_PREFIX = "cdk_";

export interface MintedKey {
  /** The full secret — show once, never store. */
  key: string;
  /** sha256 hex of the full secret — what the database stores. */
  keyHash: string;
  /** First characters for display, e.g. "cdk_a1b2c3d4". */
  keyPrefix: string;
}

export function mintApiKey(): MintedKey {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, API_KEY_PREFIX.length + 8) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function looksLikeApiKey(candidate: string): boolean {
  return candidate.startsWith(API_KEY_PREFIX) && candidate.length >= API_KEY_PREFIX.length + 32;
}

export interface ApiKeyIdentity {
  keyId: string;
  userId: string;
  keyName: string;
  scopes: string[];
}

/** How stale last_used_at must be before we rewrite it — throttles the hot-path write. */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Resolves a presented key to its owner, or null when unknown, revoked, or
 * expired. Runs on the service-role client — api_keys has no anon-readable
 * path and the MCP request carries no session. The row is looked up by the
 * key's SHA-256 (high-entropy), which is the actual protection. Refreshes
 * last_used_at at most once a minute, awaited so it survives serverless freeze.
 */
export async function verifyApiKey(admin: SupabaseClient, rawKey: string): Promise<ApiKeyIdentity | null> {
  if (!looksLikeApiKey(rawKey)) return null;
  const keyHash = hashApiKey(rawKey);
  const { data } = await admin
    .from("api_keys")
    .select("id, user_id, name, scopes, revoked_at, expires_at, last_used_at")
    .eq("key_hash", keyHash)
    .maybeSingle<{
      id: string;
      user_id: string;
      name: string;
      scopes: string[];
      revoked_at: string | null;
      expires_at: string | null;
      last_used_at: string | null;
    }>();
  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  const lastUsed = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
    // awaited (not detached): a fire-and-forget promise is dropped when a
    // serverless instance freezes on response, so the timestamp never lands
    await admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(undefined, () => {});
  }

  return { keyId: data.id, userId: data.user_id, keyName: data.name, scopes: data.scopes ?? [] };
}
