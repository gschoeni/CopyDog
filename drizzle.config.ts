import { defineConfig } from "drizzle-kit";

/**
 * Drizzle owns the schema; the Supabase CLI owns the environment.
 * `pnpm db:generate` diffs src/lib/db/schema/ and emits SQL into
 * supabase/migrations/ (supabase-style filenames), which
 * `supabase db reset` / `supabase migration up` then applies.
 * Never run `supabase db diff` — one generator only.
 */
export default defineConfig({
  schema: "./src/lib/db/schema",
  out: "./supabase/migrations",
  dialect: "postgresql",
  migrations: { prefix: "supabase" },
  dbCredentials: {
    // local `supabase start` Postgres; CI/production inject their own
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
});
