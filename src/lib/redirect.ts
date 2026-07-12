/**
 * Sanitizes a user-supplied post-auth redirect target. Only same-origin
 * absolute paths are allowed — anything else (external URLs,
 * protocol-relative "//host", javascript:) falls back.
 */
export function safeNextPath(next: string | null, fallback = "/projects"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}
