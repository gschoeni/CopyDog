import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

test("table of contents lists numbered sections, navigates, and compacts in split mode", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Toc ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // three sections with enough copy to force scrolling
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await page.keyboard.type("# Hero");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.type(`Hero filler line number ${i} with a decent amount of words in it.`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("## Features");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.type(`Feature filler line number ${i} with a decent amount of words in it.`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("## Closing call");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The last section's copy.");

  // TOC shows all three, numbered and titled
  const toc = page.getByRole("navigation", { name: "Sections" });
  await expect(toc.getByRole("button", { name: "Go to section 1: Hero" })).toBeVisible();
  await expect(toc.getByRole("button", { name: "Go to section 2: Features" })).toBeVisible();
  await expect(toc.getByRole("button", { name: "Go to section 3: Closing call" })).toBeVisible();

  // navigate: jump to the top, then use the TOC to reach the last section
  await page.getByRole("button", { name: "Go to section 1: Hero" }).click();
  await expect(page.getByRole("heading", { name: "Hero" })).toBeInViewport();
  await page.getByRole("button", { name: "Go to section 3: Closing call" }).click();
  await expect(page.getByRole("heading", { name: "Closing call" })).toBeInViewport({ timeout: 10_000 });

  // split mode: compact rail, numbers only
  await page.getByRole("tab", { name: "Split" }).click();
  const compactButton = toc.getByRole("button", { name: "Go to section 2: Features" });
  await expect(compactButton).toBeVisible();
  await expect(compactButton.getByText("Features")).toHaveCount(0);
  await expect(compactButton.getByText("2", { exact: true })).toBeVisible();
});
