import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Safe URL fetching for site imports. Guards against SSRF: only http(s),
 * no private/loopback hosts (unless ALLOW_LOCAL_IMPORT=1 for dev/e2e),
 * every hostname's *resolved addresses* checked too (a public name can
 * point at a private IP), redirects followed manually so each hop faces
 * the same guards, bounded time and size.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type LookupImpl = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupImpl = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

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

/**
 * Rejects hostnames whose DNS answers include a private address — the guard
 * `assertSafeImportUrl` can't do from the name alone. Unresolvable names
 * fail closed. Skipped under ALLOW_LOCAL_IMPORT (dev/e2e), like the host check.
 */
export async function assertPublicResolution(url: URL, lookupImpl: LookupImpl = defaultLookup): Promise<void> {
  if (process.env.ALLOW_LOCAL_IMPORT === "1") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return; // literals were already vetted by assertSafeImportUrl
  let addresses: { address: string }[];
  try {
    addresses = await lookupImpl(host);
  } catch {
    throw new ImportFetchError("Couldn't reach that URL.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateHost(address))) {
    throw new ImportFetchError("That host can't be imported.");
  }
}

export async function fetchImportHtml(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<string> {
  let url = assertSafeImportUrl(rawUrl);

  // follow redirects by hand: every hop gets the same host + DNS guards the
  // first URL got, otherwise a public page 302ing to 169.254.169.254 wins
  let res: Response;
  for (let hop = 0; ; hop++) {
    await assertPublicResolution(url, lookupImpl);
    try {
      res = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "CopyDog-Importer/1.0", Accept: "text/html" },
      });
    } catch {
      throw new ImportFetchError("Couldn't reach that URL.");
    }
    if (!REDIRECT_STATUSES.has(res.status)) break;
    const location = res.headers.get("location");
    if (!location || hop >= MAX_REDIRECTS) {
      throw new ImportFetchError("That URL redirects too much to import.");
    }
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new ImportFetchError("That URL redirects somewhere invalid.");
    }
    url = assertSafeImportUrl(next.toString());
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

function isIpLiteral(host: string): boolean {
  if (host.includes(":")) return true; // IPv6 literal (brackets already stripped by callers)
  const octets = host.split(".");
  return octets.length === 4 && octets.every((o) => /^\d+$/.test(o));
}

function isPrivateHost(hostname: string): boolean {
  // URL.hostname keeps brackets around IPv6 literals
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;

  // IPv6 literals — including v4-mapped forms (::ffff:10.0.0.1), which DNS
  // answers can contain and which would otherwise dodge the IPv4 checks
  if (host.includes(":")) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
    if (mapped) return isPrivateHost(mapped[1]!);
    return (
      host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")
    );
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
