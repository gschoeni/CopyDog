import { z } from "zod";

/**
 * Typed access to server-side environment variables, validated once at first
 * use so misconfiguration fails loudly at boot rather than deep in a request.
 * Server-only — never import from client components.
 */

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OXEN_TOKEN: z.string().min(1),
  OXEN_NAMESPACE: z.string().min(1),
  /** Oxen.ai inference key; optional until LLM features are exercised. */
  OXEN_API_KEY: z.string().optional(),
  /** Override to point at a local/self-hosted oxen-server. */
  OXEN_BASE_URL: z.string().url().optional(),
  /** Override the inference endpoint (e2e uses the stub server). */
  LLM_BASE_URL: z.string().url().optional(),
});

let cached: z.infer<typeof serverEnvSchema> | undefined;

export function serverEnv(): z.infer<typeof serverEnvSchema> {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}

/**
 * NEXT_PUBLIC_* vars are inlined at build time, so they must be referenced
 * statically rather than through process.env[name].
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
} as const;
