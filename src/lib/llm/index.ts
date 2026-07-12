import "server-only";

import { serverEnv } from "@/lib/env";
import { LlmClient } from "./client";

/**
 * Returns the configured LLM client, or null when no real key is present —
 * callers fall back to non-LLM behavior (e.g. heuristic wireframes).
 */
export function getLlmClient(): LlmClient | null {
  const key = serverEnv().OXEN_API_KEY;
  if (!key || key.includes("your-oxen-api-key")) return null;
  return new LlmClient({ apiKey: key });
}
