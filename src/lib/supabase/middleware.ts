import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/auth/confirm", "/auth/callback"];

/**
 * Refreshes the auth session on every request and gates the app routes:
 * signed-out users are sent to /login, signed-in users skip /login.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // The MCP endpoint authenticates with its own bearer API key (no cookie
  // session) — the handler owns auth; cookie gating would just 302 it to
  // /login. Match /api/mcp exactly (and subpaths), not the whole /api/mcp*
  // namespace, so a future cookie-auth route like /api/mcp-admin isn't
  // silently un-gated.
  const { pathname } = request.nextUrl;
  if (pathname === "/api/mcp" || pathname.startsWith("/api/mcp/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Important: do not run code between createServerClient and getUser —
  // it can cause sessions to be dropped mid-refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith("/auth/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
