import { expect, type Page } from "@playwright/test";

const MAILPIT_API = "http://127.0.0.1:54324/api/v1";

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

/**
 * Follows an emailed auth link, rewritten onto the test server's origin —
 * emails are built from supabase's site_url (the dev port), but token_hash
 * verification works on any app instance.
 */
export async function gotoEmailLink(page: Page, href: string): Promise<void> {
  const link = new URL(href.replace(/&amp;/g, "&"));
  const base = new URL(page.url());
  link.protocol = base.protocol;
  link.host = base.host;
  await page.goto(link.toString());
}

/** Full magic-link sign-in via the local Mailpit inbox. Returns the email used. */
export async function signIn(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@copydog.test`;

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  let html: string | null = null;
  await expect
    .poll(async () => (html = await latestEmailHtml(email)), { timeout: 15_000 })
    .not.toBeNull();

  const match = html!.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
  expect(match, "magic link email should contain an /auth/confirm link").not.toBeNull();
  await gotoEmailLink(page, match![1]!);
  await expect(page).toHaveURL(/\/projects/);

  return email;
}
