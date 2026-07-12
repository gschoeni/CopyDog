import { createServer } from "node:http";

import { OxenStub } from "../../src/lib/oxen/stub";

/**
 * Serves the in-memory Oxen stub over HTTP so e2e tests can exercise the
 * full app loop (provision → autosave → publish) with no external Oxen.
 * State lives for the lifetime of the process — one Playwright run.
 */

const PORT = Number(process.env.OXEN_STUB_PORT ?? 3232);
const stub = new OxenStub();

const server = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"ok":true}`);
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
