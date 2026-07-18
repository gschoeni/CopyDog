import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { writeSection } from "./support/sections";

test("table of contents lists numbered sections, navigates, and compacts in split mode", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Toc ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // three sections with enough copy to force scrolling
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Hero", "Hero filler line number 0 with a decent amount of words in it.", "Hero filler line number 1 with a decent amount of words in it.", "Hero filler line number 2 with a decent amount of words in it.", "Hero filler line number 3 with a decent amount of words in it.", "Hero filler line number 4 with a decent amount of words in it.", "Hero filler line number 5 with a decent amount of words in it.", "Hero filler line number 6 with a decent amount of words in it.", "Hero filler line number 7 with a decent amount of words in it.", "Hero filler line number 8 with a decent amount of words in it.", "Hero filler line number 9 with a decent amount of words in it.", "Hero filler line number 10 with a decent amount of words in it.", "Hero filler line number 11 with a decent amount of words in it."], 1);
  await writeSection(page, ["## Features", "Feature filler line number 0 with a decent amount of words in it.", "Feature filler line number 1 with a decent amount of words in it.", "Feature filler line number 2 with a decent amount of words in it.", "Feature filler line number 3 with a decent amount of words in it.", "Feature filler line number 4 with a decent amount of words in it.", "Feature filler line number 5 with a decent amount of words in it.", "Feature filler line number 6 with a decent amount of words in it.", "Feature filler line number 7 with a decent amount of words in it.", "Feature filler line number 8 with a decent amount of words in it.", "Feature filler line number 9 with a decent amount of words in it.", "Feature filler line number 10 with a decent amount of words in it.", "Feature filler line number 11 with a decent amount of words in it."], 2);
  await writeSection(page, ["## Closing call", "The last section's copy."], 3);

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

  // split mode halves the pane, so the container query compacts the TOC
  // to a numbers-only rail: titles stay in the DOM but hide
  await page.getByRole("tab", { name: "Split" }).click();
  const compactButton = toc.getByRole("button", { name: "Go to section 2: Features" });
  await expect(compactButton).toBeVisible();
  await expect(compactButton.getByText("Features")).toBeHidden();
  await expect(compactButton.getByText("2", { exact: true })).toBeVisible();

  // the list icon pins it open (titles even in the narrow pane) …
  await toc.getByRole("button", { name: "Expand contents" }).click();
  await expect(compactButton.getByText("Features")).toBeVisible();

  // … the preference survives a reload …
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(toc.getByRole("button", { name: "Go to section 2: Features" }).getByText("Features")).toBeVisible({ timeout: 15_000 });

  // … and the chevron pins it back to the numbers rail
  await toc.getByRole("button", { name: "Collapse contents" }).click();
  await expect(toc.getByRole("button", { name: "Go to section 2: Features" }).getByText("Features")).toBeHidden();
});
