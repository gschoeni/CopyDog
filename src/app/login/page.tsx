import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <Link href="/" className="flex w-fit items-baseline gap-2 text-[15px] font-semibold tracking-tight">
          CopyDog
          <span aria-hidden className="text-ink-tertiary">
            🐕
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            Sign in with your email — we&apos;ll send you a one-time link. No password needed.
          </p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}
