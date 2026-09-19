import { KeyIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/server";

import { ApiKeysManager, type ApiKeyRow } from "./api-keys-manager";

export const metadata = { title: "API keys" };

/**
 * Personal API keys let external agents (Claude Code, or anything speaking
 * MCP) work in CopyDog as you — same draft, same permissions. Listed under
 * RLS, so this only ever shows the signed-in user's keys.
 */
export default async function ApiKeysPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, scopes, created_at, expires_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });

  const keys: ApiKeyRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    scopes: (row.scopes as string[] | null) ?? ["read"],
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    revoked: Boolean(row.revoked_at),
  }));

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-ink shadow-soft">
          <KeyIcon className="size-5" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-secondary">
            Give Claude Code or another MCP client secure access to your CopyDog projects.
          </p>
        </div>
      </header>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-ink-secondary">
        <span className="shrink-0">MCP endpoint</span>
        <code className="min-w-0 flex-1 truncate font-medium text-ink">/api/mcp</code>
        <span className="hidden text-ink-tertiary sm:inline">Bearer token</span>
      </div>

      <div className="mt-8">
        <ApiKeysManager keys={keys} />
      </div>
    </main>
  );
}
