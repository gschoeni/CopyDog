import { PasswordForm } from "./password-form";

export const metadata = { title: "Set password" };

/**
 * Set (or reset) the account password. The recovery email lands here after
 * /auth/confirm verifies the token; it also works for signed-in users who
 * started with magic links and want a password.
 */
export default function PasswordPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        You&apos;ll use it next time you sign in — email links keep working too.
      </p>
      <div className="mt-8">
        <PasswordForm />
      </div>
    </div>
  );
}
