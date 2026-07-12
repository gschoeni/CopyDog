import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

test("export downloads a standalone HTML page with the active copy", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Export ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();
  await page.getByRole("textbox", { name: "Section copy" }).click();
  await page.keyboard.type("# Exported headline");
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("tab", { name: "Wireframe" }).click();
  await page.getByRole("button", { name: "Generate wireframe from copy" }).click();
  await expect(page.locator(".wf-root").getByRole("heading", { name: "Exported headline" })).toBeVisible({
    timeout: 20_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export HTML" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/export-.*-home\.html/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const html = Buffer.concat(chunks).toString();

  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("Exported headline");
  expect(html).toContain(".wf-root");
});
