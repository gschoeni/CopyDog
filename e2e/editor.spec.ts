import { expect, test } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";

/**
 * The full copy-editing loop: create a project, open its Home page,
 * add a section, write copy, autosave to the Oxen workspace (stub),
 * and verify it survives a reload.
 */
test("create project, write copy, autosave persists across reload", async ({ page }) => {
  await signIn(page);

  // create the first project — the form is already open for new accounts
  const projectName = `Acme ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // open the Home page editor
  await expect(page).toHaveURL(/\/pages\/home$/);

  // add a section and write copy using markdown shortcuts
  const editor = page.getByRole("textbox", { name: "Page copy" });
  await editor.click();
  await page.keyboard.type("# Copy that ships itself");
  await page.keyboard.press("Enter");
  await page.keyboard.type("No more pasting between docs and design tools.");

  // rename the section (the handle opens the header)
  await openSectionChrome(page);
  const title = page.getByLabel("Section title");
  await title.fill("Hero");
  await title.blur();

  // wait for autosave to settle
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // everything survives a reload — content came back from the Oxen workspace
  await page.reload();
  await expect(page.getByRole("heading", { name: "Copy that ships itself" })).toBeVisible();
  await expect(page.getByText("No more pasting between docs")).toBeVisible();
  await expect(page.getByLabel("Section title")).toHaveValue("Hero");
});

test("multi-page: add a page and switch between pages", async ({ page }) => {
  await signIn(page);

  const projectName = `Multi ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await expect(page).toHaveURL(/\/pages\/home$/);

  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("New page name").fill("Pricing");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pages\/pricing$/);

  // both pages listed in the sidebar; switching works
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/home$/);
});
