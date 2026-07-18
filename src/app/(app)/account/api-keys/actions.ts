"use server";

import { z } from "zod";

import { API_KEY_SCOPES } from "@/lib/db/schema/api-keys";
import { mintApiKey } from "@/lib/mcp/keys";
import { createClient } from "@/lib/supabase/server";

/**
 * Personal API key management — cookie-authenticated, so RLS scopes every
 * row to the caller. The plaintext key exists only in the create response.
 * Scopes are chosen at mint and immutable after (rotate to change), so a
 * key's power never silently grows.
 */

const createInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  /** days until expiry; null/omitted = no expiry */
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullish(),
});

export async function createApiKeyAction(
  input: z.infer<typeof createInput>,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const { name, scopes, expiresInDays } = createInput.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // write implies read: a key that can edit can obviously look
  const granted = [...new Set(scopes.includes("read") ? scopes : ["read", ...scopes])];

  const minted = mintApiKey();
  const { error } = await supabase.from("api_keys").insert({
    user_id: user.id,
    name,
    key_hash: minted.keyHash,
    key_prefix: minted.keyPrefix,
    scopes: granted,
    expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
  });
  if (error) return { ok: false, error: "Couldn't create the key — try again." };
  return { ok: true, key: minted.key };
}

const revokeInput = z.object({ keyId: z.uuid() });

export async function revokeApiKeyAction(input: z.infer<typeof revokeInput>): Promise<{ ok: boolean }> {
  const { keyId } = revokeInput.parse(input);
  const supabase = await createClient();
  // RLS: only the owner's rows are updatable
  await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", keyId);
  return { ok: true };
}
