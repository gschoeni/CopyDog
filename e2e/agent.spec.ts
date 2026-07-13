import { expect, test } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";

/**
 * Agent loop against the stub's scripted chat completions: the assistant
 * rewrites a section via a real tool call, the draft updates, and the
 * conversation persists.
 */
test("assistant rewrites a section through a tool call", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Agent ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await page.keyboard.type("# Human headline");
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // open the assistant and ask for a rewrite
  await page.getByRole("button", { name: "Assistant" }).click();
  await page.getByLabel("Message the assistant").fill("Punch up this section");
  await page.getByRole("button", { name: "Send" }).click();

  // scripted reply arrives and the editor reloads with the agent's version
  await expect(page.getByText("I rewrote it with a stronger promise")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Page copy" })).toContainText("Rewritten by the assistant", {
    timeout: 20_000,
  });
  await openSectionChrome(page);
  await expect(page.getByRole("button", { name: /Agent take/ })).toBeVisible();

  // the human's original is preserved as a version
  await openSectionChrome(page);
  await page.getByRole("button", { name: /Agent take/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Original" })).toBeVisible();

  // conversation survives a reload
  await page.reload();
  await expect(page.getByText("Punch up this section")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("I rewrote it with a stronger promise")).toBeVisible();
});
