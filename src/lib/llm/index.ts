import "server-only";

import { serverEnv } from "@/lib/env";
import { LlmClient } from "./client";

/**
 * Returns the configured LLM client, or null when no real key is present —
 * callers fall back to non-LLM behavior (e.g. heuristic wireframes).
 */
export function getLlmClient(): LlmClient | null {
  const env = serverEnv();
  if (env.LLM_BASE_URL) {
    // explicit endpoint override (e2e stub / self-hosted inference)
    return new LlmClient({ apiKey: env.OXEN_API_KEY ?? "stub", baseUrl: env.LLM_BASE_URL });
  }
  const key = env.OXEN_API_KEY;
  if (!key || key.includes("your-oxen-api-key")) return null;
  return new LlmClient({ apiKey: key });
}
