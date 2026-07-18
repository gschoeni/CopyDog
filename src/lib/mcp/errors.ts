/**
 * Errors whose messages are WRITTEN FOR the external agent — everything
 * else that escapes a tool is logged server-side and reported generically,
 * so internal details (supabase errors, repo names, stack shapes) never
 * leak through the MCP surface.
 */
export class McpToolError extends Error {}

export class RateLimitExceededError extends McpToolError {
  constructor() {
    super("Rate limit exceeded for this API key — wait a minute and try again.");
  }
}
