import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The continuous document: selection spans sections, highlighted blocks
 * group into a new section, and the Notion-style rail inserts and drags
 * blocks between sections.
 */

async function setupTwoSections(page: Page, name: string) {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();

  await page.getByRole("textbox", { name: "Page copy" }).click();
  await page.keyboard.type("# Hero title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hero body line.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Features");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Feature body line.");
  await expect(page.locator("[data-section-slug]")).toHaveCount(2, { timeout: 10_000 });
}

test("selection spans sections and the toolbar groups it into a new section", async ({ page }) => {
  await setupTwoSections(page, `Group ${Date.now()}`);

  // select from the hero body through the Features heading (crosses the boundary)
  const from = page.getByText("Hero body line.");
  const to = page.getByText("Feature body line.");
  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;
  await page.mouse.move(fromBox.x + 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width - 2, toBox.y + toBox.height / 2, { steps: 8 });
  await page.mouse.up();

  // the floating toolbar appears with the grouping action
  const groupButton = page.getByRole("button", { name: "Group into section" });
  await expect(groupButton).toBeVisible({ timeout: 5_000 });
  await groupButton.click();

  // hero keeps its title; a new section owns the grouped blocks
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);
  const sections = page.locator("[data-section-slug]");
  await expect(sections.first()).toContainText("Hero title");
  await expect(sections.first()).not.toContainText("Hero body line.");
  await expect(sections.nth(1)).toContainText("Hero body line.");
  await expect(sections.nth(1)).toContainText("Features");
  await expect(sections.nth(1)).toContainText("Feature body line.");

  // grouped sections are pinned: the h2-after-body inside doesn't re-split
  await page.waitForTimeout(1200);
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);

  // survives a reload (files + doc.json persisted)
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);
  await expect(page.locator("[data-section-slug]").nth(1)).toContainText("Feature body line.");
});

test("rail: hover shows ⊕/⠿, + inserts a block, drag moves a block across sections", async ({ page }) => {
  await setupTwoSections(page, `Rail ${Date.now()}`);
  const sections = page.locator("[data-section-slug]");

  // hover the hero body → rail appears
  await page.getByText("Hero body line.").hover();
  await expect(page.getByRole("button", { name: "Add block below" })).toBeVisible();

  // + inserts an empty paragraph below and focuses it
  await page.getByRole("button", { name: "Add block below" }).click();
  await page.keyboard.type("Inserted line.");
  await expect(sections.first()).toContainText("Inserted line.");

  // drag "Feature body line." from section 2 into section 1 (below hero body)
  await page.getByText("Feature body line.").hover();
  const grip = page.getByRole("button", { name: "Drag to move block" });
  await expect(grip).toBeVisible();
  const gripBox = (await grip.boundingBox())!;
  const target = (await page.getByText("Inserted line.").boundingBox())!;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 2, { steps: 10 });
  await expect(page.locator("[data-drop-indicator]")).toBeVisible();
  await page.mouse.up();

  await expect(sections.first()).toContainText("Feature body line.");
  await expect(sections.nth(1)).not.toContainText("Feature body line.");
});

test("sections reorder by dragging their header grip", async ({ page }) => {
  await setupTwoSections(page, `SecDrag ${Date.now()}`);
  const sections = page.locator("[data-section-slug]");
  await expect(sections.first()).toContainText("Hero title");

  // reveal the second section's header grip and drag it above the first
  const secondHeader = page.locator("[data-section-header]").nth(1);
  await secondHeader.hover();
  const grip = secondHeader.getByRole("button", { name: "Drag to reorder section" });
  await expect(grip).toBeVisible();
  const gripBox = (await grip.boundingBox())!;
  const firstBox = (await sections.first().boundingBox())!;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 40, firstBox.y - 2, { steps: 10 });
  await page.mouse.up();

  await expect(sections.first()).toContainText("Features");
  await expect(sections.nth(1)).toContainText("Hero title");

  // order persists
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]").first()).toContainText("Features");
});
