import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { Readable } from "node:stream";

/**
 * Safe URL fetching for site imports and assistant references. Guards against
 * SSRF: only http(s), no private/loopback hosts (unless ALLOW_LOCAL_IMPORT=1
 * for dev/e2e), every hostname's *resolved addresses* checked too (a public
 * name can point at a private IP), and — crucially — the connection is PINNED
 * to the exact address we vetted, so a rebinding DNS server can't hand `fetch`
 * a different (private) answer after the check passes. Redirects are followed
 * manually so each hop faces the same guards; bounded total time and size.
 */

/** What a fetched URL turned out to be. Anything else is refused. */
export type ImportResourceKind = "html" | "image" | "pdf";

export interface ImportResource {
  kind: ImportResourceKind;
  /** The response's content type, normalized (no charset). */
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Per-kind ceilings. HTML is text we extract from; images and PDFs travel to
 * the inference API, so their limits track what it accepts (24 MB documents).
 * Reached mid-stream: the read aborts rather than buffering a hostile body.
 */
const MAX_BYTES_BY_KIND: Record<ImportResourceKind, number> = {
  html: 2_000_000,
  image: 8_000_000,
  pdf: 24_000_000,
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

/** Convenience wrapper for the page-import path, which only ever wants HTML. */
export async function fetchImportHtml(
  rawUrl: string,
  fetchImpl?: typeof fetch,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<string> {
  const resource = await fetchImportResource(rawUrl, { accept: ["html"], fetchImpl, lookupImpl });
  return new TextDecoder().decode(resource.bytes);
}

/**
 * Fetches a URL under every guard above and classifies what came back. The
 * assistant accepts all three kinds — an HTML page becomes extracted copy, an
 * image or PDF becomes something the model can actually look at — so the
 * caller says which kinds it can handle and gets a clear error otherwise.
 */
export async function fetchImportResource(
  rawUrl: string,
  options: {
    accept?: ImportResourceKind[];
    fetchImpl?: typeof fetch;
    lookupImpl?: LookupImpl;
  } = {},
): Promise<ImportResource> {
  const { accept = ["html", "image", "pdf"], fetchImpl, lookupImpl = defaultLookup } = options;
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
        headers: { "User-Agent": "CopyDog-Importer/1.0", Accept: acceptHeader(accept) },
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

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const kind = classifyContentType(contentType);
  if (kind === null || !accept.includes(kind)) {
    throw new ImportFetchError(
      accept.length === 1 && accept[0] === "html"
        ? "That URL isn't an HTML page."
        : "That URL isn't a web page, image, or PDF.",
    );
  }

  const reader = res.body?.getReader();
  if (!reader) return { kind, contentType, bytes: new Uint8Array() };
  const limit = MAX_BYTES_BY_KIND[kind];
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      void reader.cancel();
      throw new ImportFetchError(
        kind === "html" ? "That page is too large to import." : "That file is too large to attach.",
      );
    }
    chunks.push(value);
  }
  return { kind, contentType, bytes: concat(chunks, received) };
}

function classifyContentType(type: string): ImportResourceKind | null {
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  return null;
}

function acceptHeader(kinds: ImportResourceKind[]): string {
  const parts: string[] = [];
  if (kinds.includes("html")) parts.push("text/html");
  if (kinds.includes("image")) parts.push("image/*");
  if (kinds.includes("pdf")) parts.push("application/pdf");
  return parts.join(",");
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
