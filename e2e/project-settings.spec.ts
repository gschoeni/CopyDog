import { expect, test, type Browser, type Page } from "@playwright/test";

import { signIn } from "./support/auth";

/**
 * The project settings page, end to end with two real users: the owner
 * renames the project and invites a teammate; the teammate sees the
 * roster but no owner controls, and leaves; the owner invites them back
 * and removes them, at which point the project vanishes for the teammate.
 */
test("settings: rename, invite, leave, and remove a member", async ({ browser }) => {
  test.setTimeout(180_000);

  // Bob signs in once so his account exists to be invited
  const bob = await newSession(browser);
  const bobEmail = await signIn(bob.page);
  const bobName = bobEmail.split("@")[0]!;

  // Alice creates a project and opens its settings from the sidebar gear
  const alice = await newSession(browser);
  await signIn(alice.page);
  const projectName = `Settings ${Date.now()}`;
  await alice.page.getByPlaceholder("Acme landing page").fill(projectName);
  await alice.page.getByRole("button", { name: "Create project" }).click();
  await expect(alice.page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  const projectUrl = alice.page.url().replace(/\/pages\/home$/, "");

  await alice.page.getByRole("link", { name: "Project settings" }).click();
  await expect(alice.page).toHaveURL(/\/settings$/);
  await expect(alice.page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // the roster starts as just the owner
  const roster = alice.page.getByRole("list", { name: "Project members" });
  await expect(roster.getByRole("listitem")).toHaveCount(1);
  await expect(roster.getByText("owner")).toBeVisible();
  await expect(roster.getByText("(you)")).toBeVisible();

  // owner renames the project
  await alice.page.getByLabel("Project name").fill(`${projectName} v2`);
  await alice.page.getByRole("button", { name: "Save" }).click();
  await expect(alice.page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });

  // owner invites Bob; he appears in the roster as an editor
  await alice.page.getByLabel("Invite by email").fill(bobEmail);
  await alice.page.getByRole("button", { name: "Invite" }).click();
  const bobRow = roster.getByRole("listitem").filter({ hasText: bobName });
  await expect(bobRow).toBeVisible({ timeout: 10_000 });
  await expect(bobRow.getByLabel(`Change ${bobName}'s role`)).toHaveValue("editor");

  // inviting him again is honest about it, not a false "Added"
  await alice.page.getByLabel("Invite by email").fill(bobEmail);
  await alice.page.getByRole("button", { name: "Invite" }).click();
  await expect(alice.page.getByText("They're already on this project.")).toBeVisible({ timeout: 10_000 });

  // the owner can change Bob's role — promote to owner, then back to editor;
  // her own (creator) row offers no role control
  const bobRole = alice.page.getByLabel(`Change ${bobName}'s role`);
  await expect(alice.page.getByLabel(/Change .*'s role/)).toHaveCount(1);
  await bobRole.selectOption("owner");
  await expect(alice.page.getByText(/is an owner now/)).toBeVisible({ timeout: 10_000 });
  await expect(bobRole).toHaveValue("owner");
  await bobRole.selectOption("editor");
  await expect(alice.page.getByText(/is an editor now/)).toBeVisible({ timeout: 10_000 });
  await expect(bobRole).toHaveValue("editor");

  // Bob sees the settings page, but none of the owner's controls
  await bob.page.goto(`${projectUrl}/settings`);
  await expect(bob.page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(bob.page.getByText("only the project's creator can rename it")).toBeVisible();
  await expect(bob.page.getByRole("button", { name: "Delete project" })).toHaveCount(0);

  // Bob leaves — two clicks — and lands on a project list without it
  await bob.page.getByRole("button", { name: "Leave project" }).click();
  await bob.page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(bob.page).toHaveURL(/\/projects$/, { timeout: 10_000 });
  await expect(bob.page.getByText(`${projectName} v2`)).toHaveCount(0);

  // Alice sees him gone, invites him back, then removes him
  await alice.page.reload();
  await expect(roster.getByRole("listitem")).toHaveCount(1);
  await alice.page.getByLabel("Invite by email").fill(bobEmail);
  await alice.page.getByRole("button", { name: "Invite" }).click();
  await expect(bobRow).toBeVisible({ timeout: 10_000 });

  await bobRow.getByRole("button", { name: /^Remove .* from the project$/ }).click();
  await bobRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(roster.getByRole("listitem")).toHaveCount(1, { timeout: 10_000 });

  // removal sticks: the project is a 404 for Bob now
  await bob.page.goto(`${projectUrl}/settings`);
  await expect(bob.page.getByRole("heading", { name: "Settings" })).toHaveCount(0);

  await alice.context.close();
  await bob.context.close();
});

async function newSession(browser: Browser): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
