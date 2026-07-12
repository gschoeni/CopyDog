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

describe("fetchImportHtml", () => {
  it("rejects non-html responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(fetchImportHtml("https://example.com", fetchImpl)).rejects.toThrow("isn't an HTML page");
  });

  it("rejects oversized responses", async () => {
    const big = "x".repeat(2_100_000);
    const fetchImpl: typeof fetch = async () =>
      new Response(big, { status: 200, headers: { "Content-Type": "text/html" } });
    await expect(fetchImportHtml("https://example.com", fetchImpl)).rejects.toThrow("too large");
  });

  it("returns the html body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html><body><h1>Hi</h1></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    await expect(fetchImportHtml("https://example.com", fetchImpl)).resolves.toContain("<h1>Hi</h1>");
  });
});
