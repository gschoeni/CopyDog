import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "eslint-config-next";

export default defineConfig([
  globalIgnores([".next/**", ".next-build/**", "node_modules/**", "playwright-report/**", "test-results/**", "supabase/**"]),
  ...nextPlugin,
  {
    // The service-role client bypasses RLS. Exactly two modules may hold it:
    // the MCP auth boundary (which gates every use behind membership checks)
    // and the access module that implements those checks. Everything else —
    // pages, actions, MCP tools — uses the RLS-scoped clients or the
    // McpToolApi facade. Widening this list is a security decision; see
    // docs/08_security.md.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/mcp/context.ts", "src/lib/supabase/admin.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "Service-role access is confined to src/lib/mcp/context.ts. Use the RLS-scoped client (supabase/server) or the McpToolApi facade.",
            },
          ],
          // catch relative spellings too (./admin, ../supabase/admin, …) — the
          // alias path alone lets a relative import slip through the fence
          patterns: [
            {
              group: ["**/supabase/admin", "**/supabase/admin.*", "./admin", "./admin.*"],
              message:
                "Service-role access is confined to src/lib/mcp/context.ts. Use the RLS-scoped client (supabase/server) or the McpToolApi facade.",
            },
          ],
        },
      ],
    },
  },
]);
