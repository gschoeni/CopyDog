import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { Readable } from "node:stream";

/**
 * Safe URL fetching for site imports. Guards against SSRF: only http(s),
 * no private/loopback hosts (unless ALLOW_LOCAL_IMPORT=1 for dev/e2e),
 * every hostname's *resolved addresses* checked too (a public name can
 * point at a private IP), and — crucially — the connection is PINNED to the
 * exact address we vetted, so a rebinding DNS server can't hand `fetch` a
 * different (private) answer after the check passes. Redirects are followed
 * manually so each hop faces the same guards; bounded total time and size.
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
 * fail closed. Returns the vetted addresses so the caller can pin the socket
 * to one of them (closing the resolve-then-reresolve rebinding window). An
 * empty result means "don't pin": a dev/e2e local host, or an IP literal
 * whose host is already the address.
 */
export async function assertPublicResolution(url: URL, lookupImpl: LookupImpl = defaultLookup): Promise<string[]> {
  if (process.env.ALLOW_LOCAL_IMPORT === "1") return [];
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return []; // literals were already vetted by assertSafeImportUrl
  let addresses: { address: string }[];
  try {
    addresses = await lookupImpl(host);
  } catch {
    throw new ImportFetchError("Couldn't reach that URL.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateHost(address))) {
    throw new ImportFetchError("That host can't be imported.");
  }
  return addresses.map(({ address }) => address);
}

/**
 * A `fetch` that connects to a specific, pre-vetted IP while keeping the real
 * hostname for TLS SNI, certificate validation, and the Host header — so the
 * request lands on exactly the address `assertPublicResolution` approved,
 * with no second DNS lookup for a rebinding server to poison.
 */
function pinnedFetch(addresses: string[]): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const options: RequestOptions = {
        protocol: url.protocol,
        hostname: addresses[0], // the vetted IP; an IP literal skips re-resolution
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? "GET",
        headers: { ...(init?.headers as Record<string, string> | undefined), host: url.host },
        servername: url.hostname, // SNI + cert identity stay the real hostname
        signal: init?.signal ?? undefined,
      };
      const req = request(options, (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
          else if (value != null) headers.set(key, value);
        }
        resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode ?? 502, headers }));
      });
      req.on("error", reject);
      req.end();
    });
}

export async function fetchImportHtml(
  rawUrl: string,
  fetchImpl?: typeof fetch,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<string> {
  let url = assertSafeImportUrl(rawUrl);

  // one deadline for the whole redirect chain (not a fresh 10s per hop), so a
  // hostile site can't stretch an import to minutes by chaining slow redirects
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  // follow redirects by hand: every hop gets the same host + DNS guards the
  // first URL got, otherwise a public page 302ing to 169.254.169.254 wins
  let res: Response;
  for (let hop = 0; ; hop++) {
    const addresses = await assertPublicResolution(url, lookupImpl);
    // pin the socket to a vetted address (production); tests inject fetchImpl
    const doFetch = fetchImpl ?? (addresses.length ? pinnedFetch(addresses) : fetch);
    try {
      res = await doFetch(url, {
        redirect: "manual",
        signal: deadline,
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
