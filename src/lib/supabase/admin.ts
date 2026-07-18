import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client — bypasses RLS. Exists for exactly one
 * caller: the MCP request path, where there is no cookie session to derive
 * `auth.uid()` from. Everything that touches it must go through
 * `requireProjectAccessAs` (src/lib/content/access.ts), which re-implements
 * the same membership gate the RLS policies enforce. Never import this from
 * a page, server action, or anything cookie-authenticated — use
 * src/lib/supabase/server.ts there so RLS stays the authority.
 */
export function createAdminClient(): SupabaseClient {
  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
