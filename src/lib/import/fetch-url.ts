/**
 * Safe URL fetching for site imports. Guards against SSRF: only http(s),
 * no private/loopback hosts (unless ALLOW_LOCAL_IMPORT=1 for dev/e2e),
 * bounded time and size.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export class ImportFetchError extends Error {}

export function assertSafeImportUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportFetchError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportFetchError("Only http(s) URLs can be imported.");
  }
  if (process.env.ALLOW_LOCAL_IMPORT !== "1" && isPrivateHost(url.hostname)) {
    throw new ImportFetchError("That host can't be imported.");
  }
  return url;
}

export async function fetchImportHtml(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = assertSafeImportUrl(rawUrl);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "CopyDog-Importer/1.0", Accept: "text/html" },
    });
  } catch {
    throw new ImportFetchError("Couldn't reach that URL.");
  }
  if (!res.ok) {
    throw new ImportFetchError(`The site responded with ${res.status}.`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("application/xhtml")) {
    throw new ImportFetchError("That URL isn't an HTML page.");
  }

  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      void reader.cancel();
      throw new ImportFetchError("That page is too large to import.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, received));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isPrivateHost(hostname: string): boolean {
  // URL.hostname keeps brackets around IPv6 literals
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;

  // IPv6 literals
  if (host.includes(":")) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }

  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = octets as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}
