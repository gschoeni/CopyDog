import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * Reference material end to end: an upload and a link both travel through
 * the attach route into the user's draft, ride the next message as real
 * content the model can read, and stay out of the publish path.
 */

/** A 1×1 PNG — enough to prove the multipart → data-url → vision path. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function openAssistant(page: Page, projectName: string) {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Open assistant" }).click();
  return page.getByRole("complementary", { name: "Assistant" });
}

test("a link attaches as a reference the agent can read", async ({ page }) => {
  const assistant = await openAssistant(page, `Reference link ${Date.now()}`);

  await assistant.getByRole("button", { name: "Attach a reference" }).click();
  await assistant.getByLabel("…or paste a link").fill("http://localhost:3232/fixtures/landing.html");
  await assistant.getByRole("button", { name: "Add", exact: true }).click();

  // the chip names the source; the fetched copy never shows in the UI
  await expect(assistant.getByText("localhost", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(assistant.getByText("Imported headline")).toHaveCount(0);

  await assistant.getByLabel("Message the assistant").fill("Build the page from this");
  await assistant.getByRole("button", { name: "Send" }).click();

  await expect(assistant.getByText("Reference received: localhost (stub)")).toBeVisible({ timeout: 20_000 });
  // the chip is preserved on the sent message and cleared from the composer
  await expect(assistant.getByLabel("Attached context and references")).toBeVisible();
});

test("an uploaded image reaches the model as pixels", async ({ page }) => {
  const assistant = await openAssistant(page, `Reference upload ${Date.now()}`);

  await assistant.getByRole("button", { name: "Attach a reference" }).click();
  await assistant
    .locator('input[type="file"]')
    .setInputFiles({ name: "competitor.png", mimeType: "image/png", buffer: TINY_PNG });

  await expect(assistant.getByText("competitor.png", { exact: true })).toBeVisible({ timeout: 20_000 });

  await assistant.getByLabel("Message the assistant").fill("Design a hero like this");
  await assistant.getByRole("button", { name: "Send" }).click();

  // the stub only says "(image)" when a real image_url part arrived
  await expect(assistant.getByText("Reference received: competitor.png (image) (stub)")).toBeVisible({
    timeout: 20_000,
  });

  // the chip survives a reload — it's stored on the message, not in memory
  await page.reload();
  await expect(assistant.getByText("competitor.png", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("rejects a file type that isn't reference material", async ({ page }) => {
  const assistant = await openAssistant(page, `Reference reject ${Date.now()}`);

  await assistant.getByRole("button", { name: "Attach a reference" }).click();
  await assistant
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });

  await expect(assistant.getByRole("alert")).toContainText("PNG, JPG, WEBP, GIF, or PDF");
});
