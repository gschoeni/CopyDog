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
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });

  const keys: ApiKeyRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    revoked: Boolean(row.revoked_at),
  }));

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        Connect Claude or any MCP-speaking agent to CopyDog. Keys act as you — they edit your draft and can
        publish and propose on your behalf. Point your agent at{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-[12px]">/api/mcp</code> with the key as a bearer
        token.
      </p>
      <div className="mt-8">
        <ApiKeysManager keys={keys} />
      </div>
    </div>
  );
}
