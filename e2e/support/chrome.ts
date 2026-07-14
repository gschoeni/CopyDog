import { expect, type Page } from "@playwright/test";

/**
 * Opens a section's header strip (title · version · notes · arrows · delete)
 * by clicking its rail handle — the strip only appears deliberately, never
 * on hover. The handle is a toggle, so we only click when the strip isn't
 * already open (rail positions re-measure on a rAF; toPass retries races).
 */
export async function openSectionChrome(page: Page, index = 0): Promise<void> {
  await expect(async () => {
    const rail = page.locator("[data-section-rail]").nth(index);
    const slug = await rail.getAttribute("data-section-rail");
    const header = page.locator(`[data-section-header="${slug}"]`);
    const alreadyOpen = await header
      .evaluate((el) => el.classList.contains("opacity-100"))
      .catch(() => false);
    if (!alreadyOpen) {
      await rail.getByRole("button", { name: "Section options" }).click();
    }
    await expect(header).toHaveClass(/opacity-100/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
