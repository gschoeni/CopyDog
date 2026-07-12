import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/** Supabase client for browser components. RLS applies — safe by construction. */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
}
