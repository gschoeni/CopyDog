import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The pages sidebar is a tree: subpages nest via the row ⊕, and the grip
 * drag-handle reorders (row edges) or nests (row middle) — pointer-based,
 * like every drag in the app.
 */

async function addTopLevelPage(page: Page, title: string) {
  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("New page name").fill(title);
  await page.getByLabel("New page name").press("Enter");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible({ timeout: 15_000 });
}

function rowOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-page-row]")].map((el) => el.dataset.pageRow!),
  );
}

/** Grips the row of `from` (title + slug) and drops it on `to`'s zone. */
async function dragPage(
  page: Page,
  from: { title: string; slug: string },
  toSlug: string,
  zone: "before" | "after" | "into",
) {
  await page.locator(`[data-page-row="${from.slug}"]`).hover();
  const gripBox = (await page.getByRole("button", { name: `Drag ${from.title}` }).boundingBox())!;
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  const target = (await page.locator(`[data-page-row="${toSlug}"]`).boundingBox())!;
  const y = zone === "before" ? target.y + 2 : zone === "after" ? target.y + target.height - 2 : target.y + target.height / 2;
  await page.mouse.move(target.x + target.width / 2, y, { steps: 8 });
  await page.mouse.up();
}

test("subpages nest and drag-reorder in the sidebar tree", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Tree ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await addTopLevelPage(page, "About");
  await addTopLevelPage(page, "Pricing");
  await expect.poll(() => rowOrder(page)).toEqual(["home", "about", "pricing"]);

  // ⊕ on the About row adds a nested subpage
  await page.locator(`[data-page-row="about"]`).hover();
  await page.getByRole("button", { name: "Add subpage inside About" }).click();
  await page.getByLabel("New page name").fill("Team");
  await page.getByLabel("New page name").press("Enter");
  await expect(page).toHaveURL(/\/pages\/team$/, { timeout: 15_000 });
  await expect.poll(() => rowOrder(page)).toEqual(["home", "about", "team", "pricing"]);
  // breadcrumbs walk the full nesting chain — the ancestor navigates
  const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  await expect(crumbs.getByRole("link", { name: "About" })).toBeVisible();
  await expect(crumbs).toContainText("Team");
  // About grew a fold chevron; folding hides the subtree
  await page.getByRole("button", { name: "Fold About" }).click();
  await expect.poll(() => rowOrder(page)).toEqual(["home", "about", "pricing"]);
  await page.getByRole("button", { name: "Expand About" }).click();

  // grip-drag Pricing above Home (top edge = before)
  await dragPage(page, { title: "Pricing", slug: "pricing" }, "home", "before");
  await expect.poll(() => rowOrder(page)).toEqual(["pricing", "home", "about", "team"]);

  // grip-drag Home onto Team (middle = nest inside)
  await dragPage(page, { title: "Home", slug: "home" }, "team", "into");
  await expect.poll(() => rowOrder(page)).toEqual(["pricing", "about", "team", "home"]);
  // home is now inside team's subtree: folding Team hides it
  await page.getByRole("button", { name: "Fold Team" }).click();
  await expect.poll(() => rowOrder(page)).toEqual(["pricing", "about", "team"]);
  await page.getByRole("button", { name: "Expand Team" }).click();

  // the structure survives a reload (persisted to site.json in the draft)
  await page.reload();
  await expect.poll(() => rowOrder(page), { timeout: 15_000 }).toEqual(["pricing", "about", "team", "home"]);
  await expect(page.getByRole("button", { name: "Fold About" })).toBeVisible();
});
