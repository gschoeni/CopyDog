import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The doc-like editor: a fresh page is immediately writable, and typing a
 * new H2 after body copy splits a section out automatically, titled from
 * its heading — same editor, so the caret never breaks stride.
 */
test("start typing immediately; headings create sections automatically", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Doc ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();

  // no button, no setup — the page opens ready to type
  await expect(page.getByRole("button", { name: "+ Add section" })).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "Page copy" });
  await editor.click();
  await page.keyboard.type("# Welcome to Acme");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We make lovely things for lovely people.");

  // the section titled itself from the heading
  await expect(page.getByLabel("Section title").first()).toHaveValue("Welcome to Acme", { timeout: 10_000 });

  // typing an H2 after body copy splits a new section automatically
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Our features");
  const sections = page.locator("[data-section-slug]");
  await expect(sections).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByLabel("Section title").nth(1)).toHaveValue("Our features");

  // same editor, same caret — keep typing into the new section
  await page.keyboard.press("Enter");
  await page.keyboard.type("Fast, versioned, collaborative.");
  await expect(sections.nth(1)).toContainText("Fast, versioned, collaborative.");
  await expect(sections.first()).not.toContainText("Our features");

  // everything persists — let the debounce window elapse so the "Saved"
  // state reflects *these* edits, not an earlier settle
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);
  await expect(page.getByLabel("Section title").nth(1)).toHaveValue("Our features");
  await expect(page.locator("[data-section-slug]").nth(1)).toContainText("Fast, versioned, collaborative.");
});

test("pasting multi-section copy splits it all at once", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Paste ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();

  await page.getByRole("textbox", { name: "Page copy" }).click();
  await page.keyboard.type("# Hero headline");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hero body copy.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Pricing");
  await page.keyboard.press("Enter");
  await page.keyboard.type("One simple plan.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## FAQ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Everything you wondered.");

  await expect(page.locator("[data-section-slug]")).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByLabel("Section title").nth(0)).toHaveValue("Hero headline");
  await expect(page.getByLabel("Section title").nth(1)).toHaveValue("Pricing");
  await expect(page.getByLabel("Section title").nth(2)).toHaveValue("FAQ");
});
