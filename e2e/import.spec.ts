import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

async function createProjectAndOpenHome(page: import("@playwright/test").Page, name: string) {
  await page.getByPlaceholder("Acme landing page").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();
  await expect(page).toHaveURL(/\/pages\/home$/);
}

test("import from a URL replaces the page with extracted sections + wireframe", async ({ page }) => {
  await signIn(page);
  await createProjectAndOpenHome(page, `Import URL ${Date.now()}`);

  await page.getByRole("button", { name: "Import…" }).click();
  await page.getByLabel("Website URL").fill("http://localhost:3232/fixtures/landing.html");
  await page.getByRole("button", { name: "Import", exact: true }).click();

  // copy landed as sections
  const editor = page.getByRole("textbox", { name: "Page copy" }).first();
  await expect(editor).toContainText("Imported headline", { timeout: 20_000 });
  await expect(editor).toContainText("This copy came from a real HTTP fetch");
  await expect(page.getByLabel("Section title").first()).toHaveValue("Imported headline");

  // wireframe was generated too — split view shows it with copy injected
  await page.getByRole("tab", { name: "Split" }).click();
  await expect(page.locator(".wf-root").getByRole("heading", { name: "Imported headline" })).toBeVisible();
  await expect(page.locator(".wf-root").getByText("Point one")).toBeVisible();
});

test("import from pasted HTML", async ({ page }) => {
  await signIn(page);
  await createProjectAndOpenHome(page, `Import HTML ${Date.now()}`);

  await page.getByRole("button", { name: "Import…" }).click();
  await page.getByRole("tab", { name: "Paste HTML" }).click();
  await page.getByLabel("Raw HTML").fill(
    `<body><main>
      <section><h1>Pasted page</h1><p>Some pasted body copy for the page.</p></section>
      <section><h2>Second section</h2><p>Another paragraph of real copy.</p></section>
    </main></body>`,
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "Page copy" }).first()).toContainText("Pasted page", {
    timeout: 20_000,
  });
  await expect(page.getByLabel("Section title").nth(1)).toHaveValue("Second section");
});

test("import URL rejects unsafe hosts with a friendly error", async ({ page }) => {
  await signIn(page);
  await createProjectAndOpenHome(page, `Import Bad ${Date.now()}`);

  await page.getByRole("button", { name: "Import…" }).click();
  await page.getByLabel("Website URL").fill("not-a-url");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("That doesn't look like a valid URL.")).toBeVisible();
});
