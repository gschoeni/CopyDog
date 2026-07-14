import { expect, test, type Browser, type Page } from "@playwright/test";

import { openSectionChrome } from "./support/chrome";
import { signIn } from "./support/auth";

/**
 * The full collaboration story, two real users in separate sessions:
 * Alice creates a project, invites Bob, writes copy, publishes, proposes.
 * Bob reviews the diff, merges it into main, pulls main into his draft,
 * and adopts Alice's alternate version — without ever touching her branch.
 */
test("two users: invite → publish → propose → merge → sync → adopt", async ({ browser }) => {
  test.setTimeout(120_000);

  // Bob signs in once so his account exists to be invited
  const bob = await newSession(browser);
  const bobEmail = await signIn(bob.page);

  // Alice sets up the project
  const alice = await newSession(browser);
  await signIn(alice.page);
  const projectName = `Collab ${Date.now()}`;
  await alice.page.getByPlaceholder("Acme landing page").fill(projectName);
  await alice.page.getByRole("button", { name: "Create project" }).click();
  await expect(alice.page).toHaveURL(/\/pages\/home$/, { timeout: 20_000 });
  const projectUrl = alice.page.url().replace(/\/pages\/home$/, "");

  // invite Bob from the editor sidebar
  await alice.page.getByLabel("Invite by email").fill(bobEmail);
  await alice.page.keyboard.press("Enter");
  await expect(alice.page.getByText(bobEmail.split("@")[0]!)).toBeVisible({ timeout: 10_000 });

  // Alice writes hero copy and an alternate version
  await alice.page.getByRole("textbox", { name: "Page copy" }).click();
  await alice.page.keyboard.type("# Alice's headline");
  await openSectionChrome(alice.page);
  const title = alice.page.getByLabel("Section title");
  await title.fill("Hero");
  await title.blur();
  await expect(alice.page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  await openSectionChrome(alice.page);
  await alice.page.getByRole("button", { name: /Original/ }).click();
  await alice.page.getByRole("menuitem", { name: "New version from current" }).click();
  await alice.page.getByLabel("New version name").fill("Bold take");
  await alice.page.keyboard.press("Enter");
  await openSectionChrome(alice.page);
  await expect(alice.page.getByRole("button", { name: /Bold take/ })).toBeVisible();
  const aliceEditor = alice.page.getByRole("textbox", { name: "Page copy" });
  await aliceEditor.getByText("Alice's headline").click({ clickCount: 3 });
  await alice.page.keyboard.type("The bold alternative");
  await expect(alice.page.getByText("Saved to your draft")).toBeVisible({ timeout: 10_000 });

  // propose (publishes automatically)
  await alice.page.getByRole("button", { name: "Propose" }).click();
  await alice.page.getByPlaceholder("Proposal title").fill("New hero copy");
  await alice.page.getByRole("button", { name: "Open proposal" }).click();
  await expect(alice.page).toHaveURL(/\/proposals\/[0-9a-f-]+$/, { timeout: 20_000 });
  await expect(alice.page.getByText("The bold alternative")).toBeVisible();

  const proposalUrl = alice.page.url();

  // Bob reviews and merges
  await bob.page.goto(proposalUrl);
  await expect(bob.page.getByRole("heading", { name: "New hero copy" })).toBeVisible();
  await expect(bob.page.getByText("The bold alternative")).toBeVisible();
  await bob.page.getByRole("button", { name: "Merge into main" }).click();
  await expect(bob.page.getByText(/This proposal is merged/)).toBeVisible({ timeout: 20_000 });

  // Bob pulls main into his draft and sees Alice's merged copy
  await bob.page.goto(`${projectUrl}/pages/home`);
  await bob.page.getByRole("button", { name: "Update from main" }).click();
  await bob.page.getByRole("button", { name: "Replace my page" }).click();
  await expect(bob.page.getByRole("textbox", { name: "Page copy" })).toContainText("The bold alternative", {
    timeout: 20_000,
  });

  // Bob adopts Alice's other published version from the switcher
  await openSectionChrome(bob.page);
  await bob.page.getByRole("button", { name: /Bold take/ }).click();
  const adoptItem = bob.page.getByRole("menuitem", { name: /Original —/ });
  await expect(adoptItem).toBeVisible({ timeout: 10_000 });
  await adoptItem.click();
  await expect(bob.page.getByRole("textbox", { name: "Page copy" })).toContainText("Alice's headline", {
    timeout: 20_000,
  });

  await alice.context.close();
  await bob.context.close();
});

async function newSession(browser: Browser): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
