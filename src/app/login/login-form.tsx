"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1";

type Status = { state: "idle" | "sending" } | { state: "sent"; email: string } | { state: "error"; message: string };

export function LoginForm() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    if (typeof email !== "string" || !email) return;

    setStatus({ state: "sending" });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/confirm` },
    });
    setStatus(error ? { state: "error", message: error.message } : { state: "sent", email });
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=/projects` },
    });
  }

  if (status.state === "sent") {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 shadow-soft">
        <p className="text-sm font-medium">Check your email</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
          We sent a sign-in link to <span className="font-medium text-ink">{status.email}</span>. It expires in one
          hour.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={sendMagicLink} className="space-y-3">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@studio.com"
        />
        <Button type="submit" className="w-full" disabled={status.state === "sending"}>
          {status.state === "sending" ? "Sending link…" : "Send sign-in link"}
        </Button>
      </form>

      {status.state === "error" && <p className="text-sm text-danger">{status.message}</p>}

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-tertiary">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="secondary" className="w-full" onClick={signInWithGoogle}>
            <GoogleMark />
            Continue with Google
          </Button>
        </>
      )}
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
