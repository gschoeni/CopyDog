import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

/** Owner deletes a project from the cards grid: confirm dialog, then gone. */
test("delete a project from the projects page", async ({ page }) => {
  await signIn(page);

  const name = `Doomed ${Date.now()}`;
  await page.getByPlaceholder("Acme landing page").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await page.goto("/projects");
  const card = page.getByRole("link", { name: new RegExp(name) });
  await expect(card).toBeVisible();

  // the trash reveals on hover; deleting demands a confirm
  await card.hover();
  await page.getByRole("button", { name: `Delete project ${name}` }).click();
  await expect(page.getByText("There is no undo.")).toBeVisible();
  await page.getByRole("button", { name: "Delete project", exact: true }).click();

  await expect(card).toHaveCount(0, { timeout: 15_000 });
  // and it stays gone
  await page.reload();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
});
