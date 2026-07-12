import { expect, test } from "@playwright/test";

test("home page renders the brand and value proposition", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Write the words.");
  await expect(page.getByText("CopyDog")).toBeVisible();
});

test("theme toggle flips and persists across reloads", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const initial = await html.getAttribute("data-theme");
  expect(initial === "light" || initial === "dark").toBe(true);

  await page.getByRole("button", { name: "Toggle color theme" }).click();
  const flipped = initial === "dark" ? "light" : "dark";
  await expect(html).toHaveAttribute("data-theme", flipped);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", flipped);
});
