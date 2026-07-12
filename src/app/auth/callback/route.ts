import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

/** Exchanges the OAuth code (e.g. Google) for a session. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?error=oauth-failed");
}
