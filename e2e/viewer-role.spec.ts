import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The viewer seat, end to end: invited as a viewer, Bob can see the project
 * but the editor is read-only chrome-free — no publish/propose/import, no
 * typing, no assistant, no new pages, no invite form. Promoted to editor,
 * the same routes light up and he can write.
 */
test("viewer: read-only everywhere until promoted to editor", async ({ browser }) => {
  test.setTimeout(180_000);

  const bob = await newSession(browser);
  const bobEmail = await signIn(bob.page);
  const bobName = bobEmail.split("@")[0]!;

  const alice = await newSession(browser);
  await signIn(alice.page);
  await alice.page.getByPlaceholder("Acme landing page").fill(`Viewer ${Date.now()}`);
  await alice.page.getByRole("button", { name: "Create project" }).click();
  await expect(alice.page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  const projectUrl = alice.page.url().replace(/\/pages\/home$/, "");

  // invite Bob as a viewer from settings
  await alice.page.getByRole("link", { name: "Project settings" }).click();
  await alice.page.getByLabel("Invite by email").fill(bobEmail);
  await alice.page.getByRole("combobox", { name: "Role for the invitation" }).click();
  await alice.page.getByRole("option", { name: "Viewer" }).click();
  await alice.page.getByRole("button", { name: "Invite" }).click();
  await expect(alice.page.getByText("Added as a viewer")).toBeVisible({ timeout: 10_000 });
  const roster = alice.page.getByRole("list", { name: "Project members" });
  const bobRole = roster
    .getByRole("listitem")
    .filter({ hasText: bobName })
    .getByRole("combobox", { name: `Change ${bobName}'s role` });
  await expect(bobRole).toContainText("Viewer");

  // Bob's editor is a reading room: no write chrome anywhere
  await bob.page.goto(`${projectUrl}/pages/home`);
  await expect(bob.page.getByText("Read-only view")).toBeVisible({ timeout: 20_000 });
  // the copy is visible but the surface refuses input
  await expect(bob.page.getByRole("textbox", { name: "Page copy" })).toHaveAttribute("contenteditable", "false");
  await expect(bob.page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Propose" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Update from main" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Import…" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Open assistant" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "+ New page" })).toHaveCount(0);

  // settings for a viewer: roster is visible, management isn't
  await bob.page.goto(`${projectUrl}/settings`);
  await expect(bob.page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(bob.page.getByLabel("Invite by email")).toHaveCount(0);
  await expect(bob.page.getByRole("combobox", { name: /Change .*'s role/ })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Leave project" })).toBeVisible();

  // promotion flips the same routes to writable
  await bobRole.click();
  await alice.page.getByRole("option", { name: "Editor" }).click();
  await expect(alice.page.getByText(/is an editor now/)).toBeVisible({ timeout: 10_000 });

  await bob.page.goto(`${projectUrl}/pages/home`);
  const editor = bob.page.getByRole("textbox", { name: "Page copy" });
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 20_000 });
  await expect(bob.page.getByRole("button", { name: "Propose" })).toBeVisible();
  await editor.click();
  await bob.page.keyboard.type("Bob can write now");
  await expect(bob.page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  await alice.context.close();
  await bob.context.close();
});

async function newSession(browser: Browser): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
