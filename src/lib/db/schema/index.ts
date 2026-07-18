/**
 * Barrel for the Drizzle schema. One file per table, exported here.
 * Postgres is the index (pointers, permissions, fast queries) — never
 * document content; that lives in Oxen. RLS policies are defined in the
 * same file as the table they protect.
 */

export * from "./profiles";
export * from "./projects";
export * from "./project-members";
export * from "./comments";
export * from "./proposals";
export * from "./section-versions";
export * from "./chat-messages";
export * from "./api-keys";
export * from "./mcp-audit";
