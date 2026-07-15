import { expect, test } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";
import { writeSection } from "./support/sections";

/**
 * Agent loop against the stub's scripted chat completions: the assistant
 * rewrites a section via a real tool call, the draft updates, and the
 * conversation persists.
 */
test("assistant rewrites a section through a tool call", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Agent ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Human headline"], 1);
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // open the assistant and ask for a rewrite
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
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

/**
 * The wireframe-design loop: the assistant redesigns one section through
 * design_section (streamed over the real route), and the wireframe pane
 * live-updates to the new layout without touching the copy.
 */
test("assistant redesigns a wireframe section through a tool call", async ({ page }) => {
  await signIn(page);

  await page.getByPlaceholder("Acme landing page").fill(`Agent design ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  await page.getByRole("textbox", { name: "Page copy" }).click();
  await writeSection(page, ["# Design me", "Copy that wants a layout."], 1);
  await page.waitForTimeout(1000);
  await expect(page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // start from a generated wireframe (heuristic centered hero — no wf-split)
  await page.getByRole("tab", { name: "Split" }).click();
  await page.getByRole("button", { name: "Generate wireframe from sections" }).click();
  const wireframe = page.locator(".wf-root").last();
  await expect(wireframe.getByRole("heading", { name: "Design me" })).toBeVisible({ timeout: 20_000 });
  await expect(wireframe.locator(".wf-split")).toHaveCount(0);

  // ask the assistant for a section redesign
  await page.getByRole("button", { name: "Assistant", exact: true }).click();

  // the panel is pinned in the viewport BESIDE both panes — copy, wireframe,
  // and chat input all on screen at once, nothing wrapped below the fold
  await expect(page.getByLabel("Message the assistant")).toBeInViewport({ ratio: 1 });
  await expect(wireframe.getByRole("heading", { name: "Design me" })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Page copy" })).toBeInViewport();

  await page.getByLabel("Message the assistant").fill("Make this section a split layout");
  await page.getByRole("button", { name: "Send" }).click();

  // scripted design_section runs; the wireframe becomes a split, copy intact
  await expect(page.getByText("the section is a split")).toBeVisible({ timeout: 20_000 });
  await expect(wireframe.locator(".wf-split")).toHaveCount(1, { timeout: 20_000 });
  await expect(wireframe.getByRole("heading", { name: "Design me" })).toBeVisible();
});
