import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { groupIntoSection, typeLines } from "./support/sections";

/**
 * The corrected model: a page is a mix of loose elements and sections.
 * Typing is loose by default — headings never create sections on their
 * own; grouping is the deliberate act that does.
 */

test("copy stays loose while typing; grouping creates a titled section", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Loose ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // write messy copy with headings — nothing sections itself
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await typeLines(page, ["# A big idea", "Some rambling thoughts.", "## Another heading", "More rambling."]);
  await page.waitForTimeout(1200);
  await expect(page.locator("[data-section-slug]")).toHaveCount(0);
  // no sections → no table of contents
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);

  // loose copy persists across reload
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  const editor = page.getByRole("textbox", { name: "Page copy" });
  await expect(editor).toContainText("A big idea");
  await expect(editor).toContainText("More rambling.");
  await expect(page.locator("[data-section-slug]")).toHaveCount(0);

  // grouping part of the copy creates a section, auto-titled from its heading
  await groupIntoSection(page, "A big idea", "Some rambling thoughts.");
  await expect(page.locator("[data-section-slug]")).toHaveCount(1);
  await expect(page.getByLabel("Section title")).toHaveValue("A big idea");
  // the rest stays loose, before/after order preserved on reload
  await page.waitForTimeout(1200);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Page copy" })).toContainText("Another heading");
});

test("wireframe renders linked sections only, with a nudge for the rest", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Linked ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await page.getByRole("textbox", { name: "Page copy" }).click();
  await typeLines(page, ["# Sectioned headline", "Sectioned body."]);
  await groupIntoSection(page, "Sectioned headline", "Sectioned body.");
  await expect(page.locator("[data-section-slug]")).toHaveCount(1);
  await page.keyboard.type("Loose leftover line.");
  await page.waitForTimeout(1200);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // generate: the wireframe holds the section's copy, not the loose line
  await page.getByRole("tab", { name: "Wireframe" }).click();
  await page.getByRole("button", { name: "Generate wireframe from sections" }).click();
  const wf = page.locator(".wf-root").last();
  await expect(wf.getByRole("heading", { name: "Sectioned headline" })).toBeVisible({ timeout: 20_000 });
  await expect(wf.getByText("Loose leftover line.")).toHaveCount(0);
  // the quiet nudge counts what was left out
  await expect(page.getByText(/loose element.*won't appear/)).toBeVisible();

  // unlink the section → badge shows; regenerating leaves the wireframe empty of it
  await page.getByRole("tab", { name: "Copy" }).click();
  await page.getByText("Sectioned body.").hover();
  await page.locator("[data-section-rail]").first().getByRole("button", { name: "Section options" }).click();
  await page.getByRole("button", { name: "Unlink from wireframe" }).click();
  await expect(page.getByText("unlinked", { exact: true })).toBeVisible();

  // the nudge now counts the unlinked section too
  await page.getByRole("tab", { name: "Split" }).click();
  await expect(page.getByText(/unlinked section.*won't appear/)).toBeVisible();
});

test("blank lines are freeform: multiple Enters persist across reload", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Blank ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  const editor = page.getByRole("textbox", { name: "Page copy" });
  await editor.click();
  await page.keyboard.type("top line");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("bottom line");

  // top · blank · blank · bottom
  await expect(editor.locator("> p")).toHaveCount(4);

  await page.waitForTimeout(1200);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  const reloaded = page.getByRole("textbox", { name: "Page copy" });
  await expect(reloaded).toContainText("bottom line");
  await expect(reloaded.locator("> p")).toHaveCount(4);
});

