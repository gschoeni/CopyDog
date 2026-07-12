import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";

test("visiting the app signed out redirects to login", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("magic link flow signs in and lands on projects", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // fresh account → the first-project form is already open
  await expect(page.getByText("Name your first project")).toBeVisible();

  // sign out returns to login
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});
