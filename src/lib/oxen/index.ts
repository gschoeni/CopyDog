import "server-only";

import { serverEnv } from "@/lib/env";
import { OxenClient } from "./client";

/** Server-side Oxen client bound to the configured hub and namespace. */
export function getOxenClient(): OxenClient {
  const env = serverEnv();
  return new OxenClient({
    token: env.OXEN_TOKEN,
    namespace: env.OXEN_NAMESPACE,
    baseUrl: env.OXEN_BASE_URL,
  });
}
