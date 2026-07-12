import { expect, test } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:54324/api/v1";

/** Fetches the newest Mailpit message for a recipient and returns its HTML body. */
async function latestEmailHtml(recipient: string): Promise<string | null> {
  const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:${recipient}`)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { messages: { ID: string }[] };
  const id = data.messages[0]?.ID;
  if (!id) return null;
  const message = await fetch(`${MAILPIT_API}/message/${id}`);
  const body = (await message.json()) as { HTML: string };
  return body.HTML;
}

test("visiting the app signed out redirects to login", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("magic link flow signs in and lands on projects", async ({ page }) => {
  // unique address per run so the newest-email lookup is unambiguous
  const email = `e2e-${Date.now()}@copydog.test`;

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  // the mail arrives asynchronously — poll Mailpit
  let html: string | null = null;
  await expect
    .poll(async () => (html = await latestEmailHtml(email)), { timeout: 15_000 })
    .not.toBeNull();

  const match = html!.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
  expect(match, "magic link email should contain an /auth/confirm link").not.toBeNull();
  const link = match![1]!.replace(/&amp;/g, "&");

  await page.goto(link);
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // fresh account → the first-project form is already open
  await expect(page.getByText("Name your first project")).toBeVisible();

  // sign out returns to login
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});
