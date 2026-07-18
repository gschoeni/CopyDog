import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
}

/**
 * Resolves a presented key to its owner, or null when unknown/revoked.
 * Runs on the service-role client — api_keys has no anon-readable path and
 * the MCP request carries no session. Bumps last_used_at best-effort.
 */
export async function verifyApiKey(admin: SupabaseClient, rawKey: string): Promise<ApiKeyIdentity | null> {
  if (!looksLikeApiKey(rawKey)) return null;
  const keyHash = hashApiKey(rawKey);
  const { data } = await admin
    .from("api_keys")
    .select("id, user_id, key_hash, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle<{ id: string; user_id: string; key_hash: string; revoked_at: string | null }>();
  if (!data || data.revoked_at) return null;
  // defense in depth: constant-time confirm the hash the index matched on
  const a = Buffer.from(data.key_hash, "hex");
  const b = Buffer.from(keyHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(undefined, () => {});

  return { keyId: data.id, userId: data.user_id };
}
