import { expect, test, type Page } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:54324/api/v1";

async function latestEmailHtml(recipient: string): Promise<string | null> {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${recipient}`)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { messages: { ID: string }[] };
  const id = data.messages[0]?.ID;
  if (!id) return null;
  const message = await fetch(`${MAILPIT_API}/message/${id}`);
  return ((await message.json()) as { HTML: string }).HTML;
}

/** Clicks a mode-switch button until its target appears (hydration-safe). */
async function switchMode(page: Page, buttonName: string, expectLabel: string) {
  await expect(async () => {
    await page.getByRole("button", { name: buttonName }).click();
    await expect(page.getByLabel(expectLabel, { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function openPasswordSignup(page: Page) {
  await page.goto("/login");
  await switchMode(page, "Sign in with a password", "Password");
  await switchMode(page, "New here? Create an account", "Choose a password");
}

test("create account with a password, sign out, sign back in", async ({ page }) => {
  const email = `pw-${Date.now()}@copydog.test`;

  await openPasswordSignup(page);
  await page.getByLabel("Your name").fill("Paula Password");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Choose a password").fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();

  // confirmations are off locally — straight into the app, with the name from signup
  await expect(page).toHaveURL(/\/projects/, { timeout: 20_000 });
  await expect(page.getByText("Paula Password")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await switchMode(page, "Sign in with a password", "Password");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("hunter2hunter2");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 20_000 });
});

test("wrong password shows a friendly error", async ({ page }) => {
  const email = `pw-bad-${Date.now()}@copydog.test`;
  await openPasswordSignup(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Choose a password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Sign out" }).click();

  await switchMode(page, "Sign in with a password", "Password");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
});

test("forgot password: reset via email, set a new one, sign in with it", async ({ page }) => {
  const email = `pw-reset-${Date.now()}@copydog.test`;

  // account to reset
  await openPasswordSignup(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Choose a password").fill("old-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Sign out" }).click();

  // request the reset from the sign-in form
  await switchMode(page, "Sign in with a password", "Password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("We sent a password reset link")).toBeVisible();

  let html: string | null = null;
  await expect
    .poll(async () => (html = await latestEmailHtml(email)), { timeout: 15_000 })
    .not.toBeNull();
  const match = html!.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
  expect(match, "recovery email should contain an /auth/confirm link").not.toBeNull();

  await page.goto(match![1]!.replace(/&amp;/g, "&"));
  await expect(page).toHaveURL(/\/account\/password/, { timeout: 15_000 });
  await page.getByLabel("New password", { exact: true }).fill("new-password-456");
  await page.getByLabel("Confirm new password").fill("new-password-456");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 15_000 });

  // the new password works
  await page.getByRole("button", { name: "Sign out" }).click();
  await switchMode(page, "Sign in with a password", "Password");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("new-password-456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/projects/, { timeout: 20_000 });
});
