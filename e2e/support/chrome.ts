import { expect, type Page } from "@playwright/test";

/**
 * Opens a section's header strip (title · version · notes · arrows · delete)
 * by clicking its rail handle — the strip only appears deliberately, never
 * on hover. Verifies the strip for the clicked section actually opened
 * (rail positions re-measure on a rAF, so this retries through races).
 */
export async function openSectionChrome(page: Page, index = 0): Promise<void> {
  await expect(async () => {
    const rail = page.locator("[data-section-rail]").nth(index);
    const slug = await rail.getAttribute("data-section-rail");
    await rail.getByRole("button", { name: "Section options" }).click();
    await expect(page.locator(`[data-section-header="${slug}"]`)).toHaveClass(/opacity-100/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
