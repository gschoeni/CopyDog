/**
 * Vitest stand-in for the `server-only` marker package, which throws when
 * imported outside a React Server environment. Tests run in plain Node, so
 * the marker resolves here (see vitest.config.ts) and becomes a no-op —
 * the build-time protection for real bundles is unaffected.
 */
export {};
