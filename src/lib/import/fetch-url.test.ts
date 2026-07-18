import { afterEach, describe, expect, it } from "vitest";

import { assertSafeImportUrl, fetchImportHtml, ImportFetchError } from "./fetch-url";

const originalAllow = process.env.ALLOW_LOCAL_IMPORT;

afterEach(() => {
  if (originalAllow === undefined) delete process.env.ALLOW_LOCAL_IMPORT;
  else process.env.ALLOW_LOCAL_IMPORT = originalAllow;
});

describe("assertSafeImportUrl", () => {
  it("accepts public http(s) urls", () => {
    delete process.env.ALLOW_LOCAL_IMPORT;
    expect(() => assertSafeImportUrl("https://example.com/page")).not.toThrow();
  });

  it.each([
    "ftp://example.com",
    "javascript:alert(1)",
    "http://localhost/admin",
    "http://127.0.0.1:8080",
    "http://10.1.2.3",
    "http://172.20.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://internal.local",
    "not a url",
  ])("rejects %s", (url) => {
    delete process.env.ALLOW_LOCAL_IMPORT;
    expect(() => assertSafeImportUrl(url)).toThrow(ImportFetchError);
  });

  it("allows local hosts when ALLOW_LOCAL_IMPORT=1 (dev/e2e)", () => {
    process.env.ALLOW_LOCAL_IMPORT = "1";
    expect(() => assertSafeImportUrl("http://localhost:3232/fixtures/landing.html")).not.toThrow();
  });
});

/** Public-answer resolver so tests never touch real DNS. */
const publicLookup = async () => [{ address: "93.184.216.34" }];

describe("fetchImportHtml", () => {
  it("rejects non-html responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(fetchImportHtml("https://example.com", fetchImpl, publicLookup)).rejects.toThrow(
      "isn't an HTML page",
    );
  });

  it("rejects oversized responses", async () => {
    const big = "x".repeat(2_100_000);
    const fetchImpl: typeof fetch = async () =>
      new Response(big, { status: 200, headers: { "Content-Type": "text/html" } });
    await expect(fetchImportHtml("https://example.com", fetchImpl, publicLookup)).rejects.toThrow("too large");
  });

  it("returns the html body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html><body><h1>Hi</h1></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    await expect(fetchImportHtml("https://example.com", fetchImpl, publicLookup)).resolves.toContain("<h1>Hi</h1>");
  });

  it("follows redirects but re-validates every hop (blocks 302 → private host)", async () => {
    delete process.env.ALLOW_LOCAL_IMPORT;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://example.com")) {
        return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } });
      }
      throw new Error(`private hop was fetched: ${url}`);
    };
    await expect(fetchImportHtml("https://example.com", fetchImpl, publicLookup)).rejects.toThrow(
      ImportFetchError,
    );
  });

  it("follows public redirects to the final page", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://example.com/") {
        return new Response(null, { status: 301, headers: { Location: "https://www.example.com/landing" } });
      }
      return new Response("<h1>Landed</h1>", { status: 200, headers: { "Content-Type": "text/html" } });
    };
    await expect(fetchImportHtml("https://example.com/", fetchImpl, publicLookup)).resolves.toContain("Landed");
  });

  it("caps redirect chains", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const n = Number(url.searchParams.get("n") ?? "0");
      return new Response(null, { status: 302, headers: { Location: `https://example.com/?n=${n + 1}` } });
    };
    await expect(fetchImportHtml("https://example.com/?n=0", fetchImpl, publicLookup)).rejects.toThrow(
      "redirects too much",
    );
  });

  it("blocks hostnames that resolve to private addresses (DNS rebinding)", async () => {
    delete process.env.ALLOW_LOCAL_IMPORT;
    const evilLookup = async () => [{ address: "10.0.0.5" }];
    const fetchImpl: typeof fetch = async () => {
      throw new Error("must not fetch a privately-resolved host");
    };
    await expect(fetchImportHtml("https://evil.example.com", fetchImpl, evilLookup)).rejects.toThrow(
      "can't be imported",
    );
  });

  it("blocks v4-mapped IPv6 answers", async () => {
    delete process.env.ALLOW_LOCAL_IMPORT;
    const mappedLookup = async () => [{ address: "::ffff:127.0.0.1" }];
    const fetchImpl: typeof fetch = async () => {
      throw new Error("must not fetch");
    };
    await expect(fetchImportHtml("https://evil.example.com", fetchImpl, mappedLookup)).rejects.toThrow(
      "can't be imported",
    );
  });
});
