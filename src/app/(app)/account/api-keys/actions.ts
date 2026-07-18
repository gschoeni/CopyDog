"use server";

import { z } from "zod";

import { mintApiKey } from "@/lib/mcp/keys";
import { createClient } from "@/lib/supabase/server";

/**
 * Personal API key management — cookie-authenticated, so RLS scopes every
 * row to the caller. The plaintext key exists only in the create response.
 */

const createInput = z.object({ name: z.string().trim().min(1).max(60) });

export async function createApiKeyAction(
  input: z.infer<typeof createInput>,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const { name } = createInput.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const minted = mintApiKey();
  const { error } = await supabase.from("api_keys").insert({
    user_id: user.id,
    name,
    key_hash: minted.keyHash,
    key_prefix: minted.keyPrefix,
  });
  if (error) return { ok: false, error: error.message };
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
