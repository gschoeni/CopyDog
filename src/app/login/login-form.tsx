"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1";

type Mode = "magic" | "signin" | "signup";

type Status =
  | { state: "idle" | "busy" }
  | { state: "link-sent"; email: string }
  | { state: "reset-sent"; email: string }
  | { state: "confirm-email"; email: string }
  | { state: "error"; message: string };

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("magic");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  // shared across modes so switching doesn't lose what you typed
  const [email, setEmail] = useState("");

  const busy = status.state === "busy";

  function switchMode(next: Mode) {
    setMode(next);
    setStatus({ state: "idle" });
  }

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus({ state: "busy" });
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/confirm` },
    });
    setStatus(error ? { state: "error", message: error.message } : { state: "link-sent", email });
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    if (!email || typeof password !== "string" || !password) return;
    setStatus({ state: "busy" });
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setStatus({
        state: "error",
        message: error.message.includes("Invalid login credentials")
          ? "That email and password don't match."
          : error.message,
      });
      return;
    }
    location.assign("/projects");
  }

  async function signUpWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const name = form.get("name");
    if (!email || typeof password !== "string" || password.length < 8) {
      setStatus({ state: "error", message: "Passwords need at least 8 characters." });
      return;
    }
    setStatus({ state: "busy" });
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        data: typeof name === "string" && name.trim() ? { full_name: name.trim() } : undefined,
        emailRedirectTo: `${location.origin}/auth/confirm`,
      },
    });
    if (error) {
      setStatus({ state: "error", message: error.message });
      return;
    }
    // with email confirmations enabled there's no session yet — tell them to check their inbox
    if (!data.session) {
      setStatus({ state: "confirm-email", email });
      return;
    }
    location.assign("/projects");
  }

  async function sendPasswordReset() {
    if (!email) {
      setStatus({ state: "error", message: "Enter your email first, then tap “Forgot password?”." });
      return;
    }
    setStatus({ state: "busy" });
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/confirm?next=/account/password`,
    });
    setStatus(error ? { state: "error", message: error.message } : { state: "reset-sent", email });
  }

  if (status.state === "link-sent" || status.state === "reset-sent" || status.state === "confirm-email") {
    const copy = {
      "link-sent": "We sent a sign-in link to",
      "reset-sent": "We sent a password reset link to",
      "confirm-email": "Almost there — confirm your address via the link we sent to",
    }[status.state];
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
        <p className="text-sm font-medium">Check your email</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
          {copy} <span className="font-medium text-ink">{status.email}</span>. The link expires in one hour.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mode === "magic" && (
        <form onSubmit={sendMagicLink} className="space-y-3">
          <EmailField email={email} onChange={setEmail} disabled={busy} />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Sending link…" : "Send sign-in link"}
          </Button>
        </form>
      )}

      {mode === "signin" && (
        <form onSubmit={signInWithPassword} className="space-y-3">
          <EmailField email={email} onChange={setEmail} disabled={busy} />
          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" placeholder="Password" disabled={busy} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex justify-between text-xs">
            <button type="button" onClick={() => void sendPasswordReset()} className="text-ink-tertiary underline-offset-2 hover:text-ink hover:underline" disabled={busy}>
              Forgot password?
            </button>
            <button type="button" onClick={() => switchMode("signup")} className="text-ink-tertiary underline-offset-2 hover:text-ink hover:underline" disabled={busy}>
              New here? Create an account
            </button>
          </div>
        </form>
      )}

      {mode === "signup" && (
        <form onSubmit={signUpWithPassword} className="space-y-3">
          <div>
            <label htmlFor="name" className="sr-only">
              Your name
            </label>
            <Input id="name" name="name" autoComplete="name" placeholder="Your name (shown to teammates)" disabled={busy} />
          </div>
          <EmailField email={email} onChange={setEmail} disabled={busy} />
          <div>
            <label htmlFor="new-password" className="sr-only">
              Choose a password
            </label>
            <Input
              id="new-password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Choose a password (8+ characters)"
              disabled={busy}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
          <div className="text-center text-xs">
            <button type="button" onClick={() => switchMode("signin")} className="text-ink-tertiary underline-offset-2 hover:text-ink hover:underline" disabled={busy}>
              Already have an account? Sign in
            </button>
          </div>
        </form>
      )}

      {status.state === "error" && <p className="text-sm text-danger">{status.message}</p>}

      <div className="flex items-center gap-3 text-xs text-ink-tertiary">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-2">
        {mode === "magic" ? (
          <Button variant="secondary" className="w-full" onClick={() => switchMode("signin")} disabled={busy}>
            Sign in with a password
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => switchMode("magic")} disabled={busy}>
            Email me a sign-in link instead
          </Button>
        )}

        {googleEnabled && (
          <Button variant="secondary" className="w-full" onClick={() => void signInWithGoogle()} disabled={busy}>
            <GoogleMark />
            Continue with Google
          </Button>
        )}
      </div>
    </div>
  );
}

async function signInWithGoogle() {
  await createClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth/callback?next=/projects` },
  });
}

function EmailField({ email, onChange, disabled }: { email: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div>
      <label htmlFor="email" className="sr-only">
        Email address
      </label>
      <Input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@studio.com"
        value={email}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-3c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.1-6.9-5.1L1.3 17c1.9 4.1 6 7 10.7 7z"
      />
      <path fill="#FBBC05" d="M5.1 14.2A7 7 0 0 1 4.7 12c0-.8.1-1.5.4-2.2L1.3 6.9a12 12 0 0 0 0 10.2l3.8-2.9z" />
      <path
        fill="#EA4335"
        d="M12 4.7c2.3 0 3.8 1 4.7 1.8L20 3.3C18 1.3 15.2 0 12 0 7.3 0 3.2 2.8 1.3 6.9l3.8 2.9c1-2.9 3.7-5.1 6.9-5.1z"
      />
    </svg>
  );
}
