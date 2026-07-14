import { expect, type Page } from "@playwright/test";

/**
 * Section creation the way users do it now: write loose copy, highlight it,
 * Group into section. After grouping, the caret sits in a fresh loose
 * paragraph below the new section, ready for the next run.
 */

/** Types lines at the caret, separated by Enter. */
export async function typeLines(page: Page, lines: string[]): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(lines[i]!);
  }
}

/** Selects from one text to another (or one line via triple-click) and groups it. */
export async function groupIntoSection(page: Page, firstText: string, lastText?: string): Promise<void> {
  const from = page.getByText(firstText).first();
  if (!lastText) {
    await from.click({ clickCount: 3 });
  } else {
    const to = page.getByText(lastText).first();
    const fromBox = (await from.boundingBox())!;
    const toBox = (await to.boundingBox())!;
    await page.mouse.move(fromBox.x + 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(toBox.x + toBox.width - 2, toBox.y + toBox.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await page
    .getByRole("toolbar", { name: "Selection tools" })
    .getByRole("button", { name: "Group into section" })
    .click();
}

/** Types the lines and groups them into a section; caret ends below it. */
export async function writeSection(page: Page, lines: string[], expectedCount: number): Promise<void> {
  await typeLines(page, lines);
  const plain = (line: string) => line.replace(/^#+\s*/, "").replace(/^- /, "");
  await groupIntoSection(page, plain(lines[0]!), lines.length > 1 ? plain(lines[lines.length - 1]!) : undefined);
  await expect(page.locator("[data-section-slug]")).toHaveCount(expectedCount, { timeout: 10_000 });
}
