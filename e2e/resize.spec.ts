import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { writeSection } from "./support/sections";

/**
 * Panel resizing: the project sidebar, the assistant panel, and the
 * split-mode divider all drag, step with arrow keys, reset on
 * double-click, and persist across reloads.
 */
test("panels resize by dragging and persist", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(`Resize ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // --- project sidebar: drag its right edge wider
  const sidebar = page.getByRole("complementary", { name: "Project sidebar" });
  const sidebarHandle = page.getByRole("separator", { name: "Resize project sidebar" });
  const startWidth = (await sidebar.boundingBox())!.width;
  const sidebarBox = (await sidebarHandle.boundingBox())!;
  const grabY = sidebarBox.y + 300;
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, grabY);
  await page.mouse.down();
  await page.mouse.move(sidebarBox.x + 120, grabY, { steps: 5 });
  await page.mouse.up();
  const draggedWidth = (await sidebar.boundingBox())!.width;
  expect(draggedWidth).toBeGreaterThan(startWidth + 80);

  // arrow keys step it, double-click resets it
  await sidebarHandle.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(draggedWidth + 8);
  await sidebarHandle.dblclick();
  await page.waitForTimeout(150);
  expect((await sidebar.boundingBox())!.width).toBeLessThan(startWidth + 8);

  // --- assistant: open, drag its left edge wider
  await page.getByRole("button", { name: "Open assistant" }).click();
  await expect(page.getByLabel("Message the assistant")).toBeVisible();
  await page.waitForTimeout(300); // expand animation
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  const assistantBefore = (await assistant.boundingBox())!.width;
  const assistantHandle = page.getByRole("separator", { name: "Resize assistant" });
  const assistantBox = (await assistantHandle.boundingBox())!;
  await page.mouse.move(assistantBox.x + 2, grabY);
  await page.mouse.down();
  await page.mouse.move(assistantBox.x - 150, grabY, { steps: 5 });
  await page.mouse.up();
  const assistantAfter = (await assistant.boundingBox())!.width;
  expect(assistantAfter).toBeGreaterThan(assistantBefore + 100);

  // widths persist across a reload
  await page.reload();
  await expect(page.getByLabel("Message the assistant")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  expect(Math.abs((await assistant.boundingBox())!.width - assistantAfter)).toBeLessThan(3);

  // --- split divider: drag the copy/wireframe boundary left
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Resize me"], 1);
  await page.getByRole("tab", { name: "Split" }).click();
  const splitHandle = page.getByRole("separator", { name: "Resize copy and wireframe panes" });
  const splitBox = (await splitHandle.boundingBox())!;
  await page.mouse.move(splitBox.x + splitBox.width / 2, grabY);
  await page.mouse.down();
  await page.mouse.move(splitBox.x - 120, grabY, { steps: 5 });
  await page.mouse.up();
  const movedBox = (await splitHandle.boundingBox())!;
  expect(movedBox.x).toBeLessThan(splitBox.x - 80);
});
