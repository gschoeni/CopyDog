import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { openSectionChrome } from "./support/chrome";
import { typeLines, writeSection } from "./support/sections";

/**
 * The full copy-editing loop: create a project, write loose copy, group
 * part of it into a section, rename it, and verify everything survives a
 * reload (autosave through the Oxen workspace).
 */
test("create project, write copy, group a section, autosave persists", async ({ page }) => {
  await signIn(page);

  const projectName = `Acme ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // loose copy first, like a blank doc
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Copy that ships itself", "No more pasting between docs and design tools."], 1);
  await typeLines(page, ["A loose afterthought."]);

  // rename the section (the handle opens the header)
  await openSectionChrome(page);
  const title = page.getByLabel("Section title");
  await title.fill("Hero");
  await title.blur();

  // wait for autosave to settle
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // everything survives a reload — section, loose run, and title
  await page.reload();
  await expect(page.getByRole("heading", { name: "Copy that ships itself" })).toBeVisible();
  await expect(page.getByText("No more pasting between docs")).toBeVisible();
  await expect(page.getByText("A loose afterthought.")).toBeVisible();
  await expect(page.getByLabel("Section title")).toHaveValue("Hero");
});

test("multi-page: add a page and switch between pages", async ({ page }) => {
  await signIn(page);

  const projectName = `Multi ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("New page name").fill("Pricing");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pages\/pricing$/);

  // both pages listed in the sidebar; switching works
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/home$/);
});
