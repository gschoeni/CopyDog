import { expect, test } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";

async function createProjectAndOpenHome(page: import("@playwright/test").Page, name: string) {
  await page.getByPlaceholder("Acme landing page").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
}

test("alternate versions: create, edit independently, toggle back", async ({ page }) => {
  await signIn(page);
  await createProjectAndOpenHome(page, `Versions ${Date.now()}`);

  // one section with some original copy
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await page.keyboard.type("Original headline idea");
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // branch a new version from current copy (the handle opens the header)
  await openSectionChrome(page);
  await page.getByRole("button", { name: /Original/ }).click();
  await page.getByRole("menuitem", { name: "New version from current" }).click();
  await page.getByLabel("New version name").fill("Punchy");
  await page.keyboard.press("Enter");

  // new version starts as a copy; make it diverge
  await expect(page.getByRole("button", { name: /Punchy/ })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Page copy" });
  await expect(editor).toContainText("Original headline idea");
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  await page.keyboard.type("Punchy alternative!");
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // toggle back to Original — the old copy is untouched
  await openSectionChrome(page);
  await page.getByRole("button", { name: /Punchy/ }).click();
  await page.getByRole("menuitemradio", { name: "Original" }).click();
  await expect(editor).toContainText("Original headline idea");

  // and forward again
  await openSectionChrome(page);
  await page.getByRole("button", { name: /Original · 2/ }).click();
  await page.getByRole("menuitemradio", { name: "Punchy" }).click();
  await expect(editor).toContainText("Punchy alternative!");

  // survives reload with the chosen version active
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Page copy" })).toContainText("Punchy alternative!");
});

test("notes: add, see count, resolve", async ({ page }) => {
  await signIn(page);
  await createProjectAndOpenHome(page, `Notes ${Date.now()}`);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  await openSectionChrome(page);
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.getByLabel("Add a note").fill("Client wants this friendlier");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Client wants this friendlier")).toBeVisible();

  // count badge shows one open note
  await expect(page.getByRole("button", { name: "Notes (1 open)" })).toBeVisible();

  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Notes$/ })).toBeVisible();
});
