import { describe, expect, it } from "vitest";

import { parseDocFile } from "@/lib/content/doc";
import { parseSiteFile } from "@/lib/content/site";
import { OxenClient } from "./client";
import { provisionProjectRepo } from "./provision";
import { OxenStub } from "./stub";

const AUTHOR = { name: "greg", email: "greg@copydog.app" };

describe("provisionProjectRepo", () => {
  it("creates a repo seeded with a sitemap and an empty home doc", async () => {
    const stub = new OxenStub();
    const client = new OxenClient({
      token: "t",
      namespace: "copydog-test",
      baseUrl: "https://stub.oxen.local",
      fetchImpl: stub.fetch,
    });

    const repoName = await provisionProjectRepo(client, { repoName: "acme-abc123", author: AUTHOR });
    expect(repoName).toBe("acme-abc123");

    const site = parseSiteFile(await client.readFile(repoName, "main", "site.json"));
    expect(site.pages).toEqual([{ slug: "home", title: "Home" }]);

    const doc = parseDocFile(await client.readFile(repoName, "main", "pages/home/doc.json"));
    expect(doc.sections).toEqual([]);

    // provisioning workspace is cleaned up; main holds exactly the seed commit
    const branches = await client.listBranches(repoName);
    expect(branches.map((b) => b.name)).toEqual(["main"]);
  });
});
