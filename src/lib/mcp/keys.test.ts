import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { API_KEY_PREFIX, hashApiKey, looksLikeApiKey, mintApiKey, verifyApiKey } from "./keys";

interface KeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  revoked_at: string | null;
}

/** Just enough of the supabase query chain for verifyApiKey. */
function fakeAdmin(rows: KeyRow[], touched: string[] = []): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () => ({ data: rows.find((r) => r.key_hash === value) ?? null }),
        }),
      }),
      update: () => ({
        eq: (_col: string, id: string) => ({
          then: (onOk?: (v: unknown) => unknown) => {
            touched.push(id);
            return Promise.resolve(onOk?.({ error: null }));
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("API keys", () => {
  it("mints prefixed keys with a stable hash and display prefix", () => {
    const minted = mintApiKey();
    expect(minted.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(minted.key.length).toBeGreaterThanOrEqual(API_KEY_PREFIX.length + 43);
    expect(minted.keyHash).toBe(hashApiKey(minted.key));
    expect(minted.keyPrefix).toBe(minted.key.slice(0, API_KEY_PREFIX.length + 8));
  });

  it("mints unique keys", () => {
    expect(mintApiKey().key).not.toBe(mintApiKey().key);
  });

  it("recognizes key-shaped strings only", () => {
    expect(looksLikeApiKey(mintApiKey().key)).toBe(true);
    expect(looksLikeApiKey("cdk_short")).toBe(false);
    expect(looksLikeApiKey("sk-something-else-entirely-but-long-enough")).toBe(false);
  });

  it("verifies a live key and bumps last_used_at", async () => {
    const minted = mintApiKey();
    const touched: string[] = [];
    const admin = fakeAdmin([{ id: "k1", user_id: "u1", key_hash: minted.keyHash, revoked_at: null }], touched);

    const identity = await verifyApiKey(admin, minted.key);
    expect(identity).toEqual({ keyId: "k1", userId: "u1" });
    // last_used_at update is fire-and-forget; give the microtask a beat
    await new Promise((r) => setTimeout(r, 0));
    expect(touched).toEqual(["k1"]);
  });

  it("rejects unknown, revoked, and malformed keys", async () => {
    const live = mintApiKey();
    const revoked = mintApiKey();
    const admin = fakeAdmin([
      { id: "k1", user_id: "u1", key_hash: live.keyHash, revoked_at: null },
      { id: "k2", user_id: "u1", key_hash: revoked.keyHash, revoked_at: "2026-01-01T00:00:00Z" },
    ]);

    expect(await verifyApiKey(admin, mintApiKey().key)).toBeNull(); // unknown
    expect(await verifyApiKey(admin, revoked.key)).toBeNull(); // revoked
    expect(await verifyApiKey(admin, "not-a-key")).toBeNull(); // malformed — no query needed
  });
});
