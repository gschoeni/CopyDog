import { expect, test, type Page } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";
import { typeLines, writeSection } from "./support/sections";

/**
 * The continuous document: selection spans sections, highlighted elements
 * group into a new section, and the Notion-style rail inserts and drags
 * elements between sections.
 */

async function setupTwoSections(page: Page, name: string) {
  await signIn(page);
  await page.getByPlaceholder("Acme landing page").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });

  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Hero title", "Hero body line."], 1);
  await writeSection(page, ["## Features", "Feature body line."], 2);
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

  // hero keeps its title; a new section owns the grouped elements
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);
  const sections = page.locator("[data-section-slug]");
  await expect(sections.first()).toContainText("Hero title");
  await expect(sections.first()).not.toContainText("Hero body line.");
  await expect(sections.nth(1)).toContainText("Hero body line.");
  await expect(sections.nth(1)).toContainText("Features");
  await expect(sections.nth(1)).toContainText("Feature body line.");

  // survives a reload (files + doc.json persisted)
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]")).toHaveCount(2);
  await expect(page.locator("[data-section-slug]").nth(1)).toContainText("Feature body line.");
});

test("turn-into: highlighted text changes element type from the toolbar", async ({ page }) => {
  await setupTwoSections(page, `TurnInto ${Date.now()}`);

  // select the hero body paragraph
  await page.getByText("Hero body line.").click({ clickCount: 3 });
  const toolbar = page.getByRole("toolbar", { name: "Selection tools" });
  await expect(toolbar).toBeVisible();

  // open the turn-into menu and pick Heading 2
  await toolbar.getByRole("button", { name: "Turn into" }).click();
  await page.getByRole("option", { name: "Heading 2" }).click();
  await expect(
    page.getByRole("textbox", { name: "Page copy" }).getByRole("heading", { level: 2, name: "Hero body line." }),
  ).toBeVisible();

  // and to a bulleted list
  await page.getByText("Hero body line.").click({ clickCount: 3 });
  await toolbar.getByRole("button", { name: "Turn into" }).click();
  await page.getByRole("option", { name: "Bulleted list" }).click();
  await expect(
    page.getByRole("textbox", { name: "Page copy" }).getByRole("listitem").filter({ hasText: "Hero body line." }),
  ).toBeVisible();
});

test("toolbar: quick headings, quote, and links on highlighted text", async ({ page }) => {
  await setupTwoSections(page, `Tools ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Page copy" });
  const toolbar = page.getByRole("toolbar", { name: "Selection tools" });

  // H2 quick button
  await page.getByText("Hero body line.").click({ clickCount: 3 });
  await toolbar.getByRole("button", { name: "Heading 2" }).click();
  await expect(editor.getByRole("heading", { level: 2, name: "Hero body line." })).toBeVisible();

  // quote
  await page.getByText("Hero body line.").click({ clickCount: 3 });
  await toolbar.getByRole("button", { name: "Quote" }).click();
  await expect(editor.locator("blockquote", { hasText: "Hero body line." })).toBeVisible();

  // link: select a word in the features body, apply a URL
  await page.getByText("Feature body line.").click({ clickCount: 3 });
  await toolbar.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByLabel("Link URL").fill("https://copydog.app/docs");
  await page.keyboard.press("Enter");
  const anchor = editor.locator('a[href="https://copydog.app/docs"]');
  await expect(anchor).toContainText("Feature body line.");

  // everything persists through the markdown round-trip
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Page copy" }).locator("blockquote")).toContainText("Hero body line.");
  await expect(
    page.getByRole("textbox", { name: "Page copy" }).locator('a[href="https://copydog.app/docs"]'),
  ).toContainText("Feature body line.");

  // removing the link
  await page.getByText("Feature body line.").click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "Selection tools" }).getByRole("button", { name: "Remove link" }).click();
  await expect(page.getByRole("textbox", { name: "Page copy" }).locator("a")).toHaveCount(0);
});

test("section rail: ⊕ inserts a new section below and focuses it", async ({ page }) => {
  await setupTwoSections(page, `Rail ${Date.now()}`);
  const sections = page.locator("[data-section-slug]");

  // hover the hero section → its left-rail controls appear
  await page.getByText("Hero body line.").hover();
  const addButton = page.locator("[data-section-rail]").first().getByRole("button", { name: "Add section below" });
  await addButton.click();

  // a fresh section appears between hero and features, ready to type
  await expect(sections).toHaveCount(3, { timeout: 10_000 });
  await page.keyboard.type("Middle section copy.");
  await expect(sections.nth(1)).toContainText("Middle section copy.");
  await expect(sections.nth(2)).toContainText("Features");
});

test("Shift+Enter and the phantom placeholder create sections", async ({ page }) => {
  await setupTwoSections(page, `NewSec ${Date.now()}`);
  const sections = page.locator("[data-section-slug]");

  // caret in the first section → Shift+Enter opens a fresh section below it
  await page.getByText("Hero body line.").click();
  await page.waitForTimeout(200); // let the click's selection settle
  await page.keyboard.press("Shift+Enter");
  await expect(sections).toHaveCount(3, { timeout: 10_000 });
  await page.keyboard.type("Born by shortcut.");
  await expect(sections.nth(1)).toContainText("Born by shortcut.");
  await expect(sections.first()).not.toContainText("Born by shortcut.");

  // the phantom below the document: hover reveals it, click makes it real
  const phantom = page.locator("[data-phantom-section]");
  await phantom.hover();
  await expect(phantom).toHaveClass(/hover:opacity-100/);
  await phantom.click();
  await expect(sections).toHaveCount(4, { timeout: 10_000 });
  await page.keyboard.type("Born from the phantom.");
  await expect(sections.nth(3)).toContainText("Born from the phantom.");

  // Backspace through the emptied section deletes it and the caret lands
  // on what precedes it — the blank continuation line left by grouping,
  // which persists (blank lines are content), so typing continues loose
  await page.getByText("Born from the phantom.").click({ clickCount: 3 });
  await page.keyboard.press("Backspace"); // clears the selected text
  await expect(sections.nth(3)).not.toContainText("Born from the phantom.");
  await page.keyboard.press("Backspace"); // empty section → deleted
  await expect(sections).toHaveCount(3, { timeout: 10_000 });
  await page.keyboard.type("Continued loose.");
  await expect(page.getByRole("textbox", { name: "Page copy" })).toContainText("Continued loose.");
  await expect(sections.nth(2)).not.toContainText("Continued loose.");
});

test("sections reorder by dragging their header grip", async ({ page }) => {
  await setupTwoSections(page, `SecDrag ${Date.now()}`);
  const sections = page.locator("[data-section-slug]");
  await expect(sections.first()).toContainText("Hero title");

  // chrome is invisible until you hover the section — hover its copy first
  await page.getByText("Feature body line.").hover();
  const secondRail = page.locator("[data-section-rail]").nth(1);
  const grip = secondRail.getByRole("button", { name: "Section options" });
  await expect(grip).toBeVisible();
  const gripBox = (await grip.boundingBox())!;
  const firstBox = (await sections.first().boundingBox())!;

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 40, firstBox.y - 2, { steps: 10 });
  await page.mouse.up();

  await expect(sections.first()).toContainText("Features");
  await expect(sections.nth(1)).toContainText("Hero title");

  // the ↑/↓ arrows in the strip also reorder: push Features back down
  // (rail positions settle on a rAF after the reorder)
  await page.waitForTimeout(150);
  await openSectionChrome(page, 0);
  await page
    .locator("[data-section-header]")
    .first()
    .getByRole("button", { name: "Move section down" })
    .click();
  await expect(sections.first()).toContainText("Hero title");
  await expect(sections.nth(1)).toContainText("Features");
  // and back up, so the persisted order matches the drag result
  await page.waitForTimeout(150);
  await openSectionChrome(page, 1);
  await page
    .locator("[data-section-header]")
    .nth(1)
    .getByRole("button", { name: "Move section up" })
    .click();
  await expect(sections.first()).toContainText("Features");

  // order persists
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("[data-section-slug]").first()).toContainText("Features");
});

test("the rail handle toggles the section header: click to open, click to dismiss", async ({ page }) => {
  await setupTwoSections(page, `Toggle ${Date.now()}`);

  await openSectionChrome(page);
  const rail = page.locator("[data-section-rail]").first();
  const slug = await rail.getAttribute("data-section-rail");
  const header = page.locator(`[data-section-header="${slug}"]`);
  await expect(header).toHaveClass(/opacity-100/);

  // second click on the same handle dismisses
  await rail.getByRole("button", { name: "Section options" }).click();
  await expect(header).toHaveClass(/opacity-0/);

  // and it can come right back
  await rail.getByRole("button", { name: "Section options" }).click();
  await expect(header).toHaveClass(/opacity-100/);

  // clicking into the copy still dismisses it (outside click)
  await page.getByText("Hero body line.").click();
  await expect(header).toHaveClass(/opacity-0/);
});

