import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The workbench panel system: every edge surface collapses to a slim icon
 * rail and back — the pages sidebar on the left, the assistant on the right —
 * with state persisting across reloads.
 */
test("sidebar and assistant collapse to icon rails and back", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Panels ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  // --- pages sidebar → rail
  await expect(page.getByLabel("Invite by email")).toBeVisible();
  await page.getByRole("button", { name: "Collapse project sidebar" }).click();
  // slims to icon dots: the page keeps an initial, the roster is tucked away
  await expect(page.getByLabel("Invite by email")).toBeHidden();
  const homeDot = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeDot).toBeVisible();
  await expect(homeDot).toHaveText("H");

  // collapsed state survives a reload
  await page.reload();
  await expect(page.getByRole("button", { name: "Open project sidebar" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open project sidebar" }).click();
  await expect(page.getByLabel("Invite by email")).toBeVisible();

  // --- assistant: a rail on the right edge, never hidden behind the toolbar
  const openAssistant = page.getByRole("button", { name: "Open assistant" });
  await expect(openAssistant).toBeVisible();
  await openAssistant.click();
  await expect(page.getByLabel("Message the assistant")).toBeInViewport({ ratio: 1 });

  // collapse from the panel header; the rail affordance returns
  await page.getByRole("button", { name: "Collapse assistant" }).click();
  await expect(page.getByLabel("Message the assistant")).toBeHidden();
  await expect(openAssistant).toBeVisible();

  // the toolbar sparkles button drives the same state
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page.getByLabel("Message the assistant")).toBeInViewport({ ratio: 1 });
});
