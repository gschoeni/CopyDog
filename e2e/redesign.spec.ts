import { expect, test } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";
import { writeSection } from "./support/sections";

/**
 * Redesigning a section without knowing the layout vocabulary: hover the
 * wireframe section → Redesign → pick a pattern chip → the assistant designs
 * it → the pane's undo flips the layout back, and forward again.
 */
test("redesign a section from the wireframe with a pattern chip, then undo and redo", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Redesign ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Walks your dog loves", "Book a walker in under a minute."], 1);
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // first layout: the rule-based generator, so nothing to undo yet
  await page.getByRole("tab", { name: "Wireframe" }).click();
  await page.getByRole("button", { name: "Generate wireframe from sections" }).click();
  const wireframe = page.locator(".wf-root").last();
  await expect(wireframe.getByRole("heading", { name: "Walks your dog loves" })).toBeVisible({ timeout: 20_000 });
  await expect(wireframe.locator(".wf-split")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo layout change" })).toHaveCount(0);

  // hover the section → Redesign: the assistant opens with the section attached and patterns offered
  await wireframe.locator("[data-copy]").first().hover();
  await page.getByRole("button", { name: "Redesign section" }).click();
  await expect(page.getByRole("group", { name: "Layout patterns" })).toBeVisible();
  await expect(page.getByText("Redesign “", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Split, image left" }).click();

  // the scripted designer lays it out as a split; the pane updates live
  await expect(page.getByText("Done — the section is a split")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".wf-root .wf-split")).toHaveCount(1, { timeout: 20_000 });
  // the finished turn refreshes the editor from the server; let that land first
  await page.waitForLoadState("networkidle");

  // undo flips back to the first layout; again is redo
  const undo = page.getByRole("button", { name: "Undo layout change" });
  await expect(undo).toBeVisible({ timeout: 10_000 });
  await undo.click();
  await expect(page.locator(".wf-root .wf-split")).toHaveCount(0, { timeout: 10_000 });
  await undo.click();
  await expect(page.locator(".wf-root .wf-split")).toHaveCount(1, { timeout: 10_000 });

  // the assistant can undo too
  await page.getByLabel("Message the assistant").fill("undo that");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Restored the earlier layout")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".wf-root .wf-split")).toHaveCount(0, { timeout: 10_000 });
});

test("the section header and the page wand also open the assistant with patterns", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Redesign entry ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["## Why walkers love us"], 1);
  await page.waitForTimeout(800);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // from the copy editor's section header
  await openSectionChrome(page);
  await page.getByRole("button", { name: "Design this section" }).click();
  await expect(page.getByRole("group", { name: "Layout patterns" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Card grid" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss layout patterns" }).click();
  await expect(page.getByRole("group", { name: "Layout patterns" })).toHaveCount(0);

  // from the pane's wand, once a wireframe exists: page-level patterns
  await page.getByRole("tab", { name: "Wireframe" }).click();
  await page.getByRole("button", { name: "Generate wireframe from sections" }).click();
  await expect(page.locator(".wf-root").last().getByRole("heading", { name: "Why walkers love us" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Redesign page" }).click();
  await expect(page.getByRole("button", { name: "More rhythm" })).toBeVisible();
});
