import { createServer } from "node:http";

import { OxenStub } from "../../src/lib/oxen/stub";

/**
 * Serves the in-memory Oxen stub over HTTP so e2e tests can exercise the
 * full app loop (provision → autosave → publish) with no external Oxen.
 * State lives for the lifetime of the process — one Playwright run.
 */

const PORT = Number(process.env.OXEN_STUB_PORT ?? 3232);
const stub = new OxenStub();

/** Static fixture for URL-import e2e — a small landing page. */
const LANDING_FIXTURE = `<!DOCTYPE html>
<html><head><title>Fixture Landing</title></head>
<body>
  <main>
    <section>
      <p class="eyebrow">FIXTURE</p>
      <h1>Imported headline</h1>
      <p>This copy came from a real HTTP fetch during e2e.</p>
      <a class="btn" href="/go">Try it now</a>
    </section>
    <section>
      <h2>Details</h2>
      <ul><li>Point one</li><li>Point two</li></ul>
    </section>
  </main>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"ok":true}`);
    return;
  }
  if (req.url === "/fixtures/landing.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(LANDING_FIXTURE);
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((item) => [k, item] as [string, string]) : [[k, v] as [string, string]],
    ),
    body: body.length > 0 ? body : undefined,
  });

  const response = await stub.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, () => {
  console.log(`oxen stub listening on :${PORT}`);
});
