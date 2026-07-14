import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { writeSection } from "./support/sections";

test("generate wireframe from copy, live-update it, persists across reload", async ({ page }) => {
  await signIn(page);

  const projectName = `Wireframe ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // write hero copy and group it into a (linked) section
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Copy meets layout", "The wireframe is a view over your words."], 1);
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // switch to wireframe view and generate
  await page.getByRole("tab", { name: "Wireframe" }).click();
  await expect(page.getByText("No wireframe yet")).toBeVisible();
  await page.getByRole("button", { name: "Generate wireframe from sections" }).click();

  // the greyscale wireframe renders with the copy substituted in
  const wireframe = page.locator(".wf-root").last();
  await expect(wireframe.getByRole("heading", { name: "Copy meets layout" })).toBeVisible({ timeout: 20_000 });
  await expect(wireframe.getByText("The wireframe is a view over your words.")).toBeVisible();

  // side-by-side: editing copy updates the wireframe live
  await page.getByRole("tab", { name: "Split" }).click();
  const editor = page.getByRole("textbox", { name: "Page copy" });
  // triple-click selects the heading line; typing replaces it
  await editor.getByText("Copy meets layout").click({ clickCount: 3 });
  await page.keyboard.type("Copy meets layout today");
  await expect(page.locator(".wf-root").getByRole("heading", { name: "Copy meets layout today" })).toBeVisible();

  // wireframe (and mode) survive a reload
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator(".wf-root").getByRole("heading", { name: "Copy meets layout today" })).toBeVisible({
    timeout: 15_000,
  });
});
