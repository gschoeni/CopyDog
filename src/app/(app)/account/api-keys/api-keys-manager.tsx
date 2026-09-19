"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { CheckIcon, CopyIcon, KeyIcon, TrashIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import type { ApiKeyScope } from "@/lib/db/schema/api-keys";

import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
}

// `read` is locked on: every key can look, and the server grants it regardless.
const SCOPE_OPTIONS: { value: ApiKeyScope; label: string; hint: string; locked?: boolean }[] = [
  { value: "read", label: "Read", hint: "Browse projects, pages, copy, and diffs", locked: true },
  { value: "write", label: "Write", hint: "Edit copy and layouts in your draft" },
  { value: "collab", label: "Collaborate", hint: "Publish, propose, and comment" },
  { value: "merge", label: "Merge", hint: "Merge teammates' proposals to main" },
];

const SCOPE_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  collab: "Collaborate",
  merge: "Merge",
};

type Expiry = 30 | 90 | 365 | null;

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: null, label: "Never" },
];

export function ApiKeysManager({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // read is granted server-side and never toggled here — state holds the optional scopes only
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["write", "collab"]);
  const [expiry, setExpiry] = useState<Expiry>(90);

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    if (typeof name !== "string" || !name.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createApiKeyAction({
      name: name.trim(),
      scopes: ["read", ...scopes],
      expiresInDays: expiry,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    setFreshKey(result.key);
    setCopied(false);
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    await revokeApiKeyAction({ keyId: id });
    setBusy(false);
    router.refresh();
  }

  async function copyKey() {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey);
    setCopied(true);
  }

  const active = keys.filter((key) => !key.revoked);

  return (
    <div className="space-y-10">
      <section aria-labelledby="create-key-heading">
        <div>
          <h2 id="create-key-heading" className="text-sm font-semibold text-ink">
            Create a new key
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
            Name the client, choose only the access it needs, then copy the key once.
          </p>
        </div>

        <form onSubmit={create} className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
          <div className="p-4 sm:p-5">
            <label htmlFor="key-name" className="text-[13px] font-medium text-ink">
              Key name
            </label>
            <Input
              id="key-name"
              name="name"
              required
              maxLength={60}
              placeholder="e.g. Claude Code on my laptop"
              disabled={busy}
              className="mt-2"
            />

            <fieldset className="mt-6">
              <legend className="text-[13px] font-medium text-ink">Permissions</legend>
              <p className="mt-1 text-[12px] text-ink-tertiary">You can revoke access at any time.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SCOPE_OPTIONS.map((option) => {
                  const checked = option.locked || scopes.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={
                        "relative flex min-h-16 items-start gap-3 rounded-lg border p-3 transition-colors " +
                        (checked ? "border-border-strong bg-surface-hover" : "border-border hover:bg-surface-hover") +
                        (option.locked ? " cursor-default" : " cursor-pointer")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={option.locked || busy}
                        onChange={option.locked ? undefined : () => toggleScope(option.value)}
                        className="mt-0.5 size-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                          {option.label}
                          {option.locked ? (
                            <span className="rounded bg-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-tertiary">
                              Required
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-ink-tertiary">{option.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="text-[13px] font-medium text-ink">Expiration</legend>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-bg p-1 sm:grid-cols-4">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    disabled={busy}
                    aria-pressed={expiry === option.value}
                    onClick={() => setExpiry(option.value)}
                    className={
                      "h-8 rounded-md px-2 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50 " +
                      (expiry === option.value
                        ? "bg-surface font-medium text-ink shadow-soft"
                        : "text-ink-secondary hover:text-ink")
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-col gap-3 border-t border-border bg-bg px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="max-w-md text-[11px] leading-relaxed text-ink-tertiary">
              Keys act as you and are stored by MCP clients in local config files. Treat them like passwords.
            </p>
            <Button type="submit" disabled={busy} className="shrink-0">
              {busy ? "Creating…" : "Create key"}
            </Button>
          </div>
        </form>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {freshKey ? (
          <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-4 sm:p-5" aria-live="polite">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Your key is ready</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
                  Copy it now. For your security, it won&apos;t be shown again.
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-bg p-1.5 pl-3">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] text-ink">{freshKey}</code>
              <Button
                variant="secondary"
                size="icon"
                onClick={copyKey}
                className="shrink-0"
                aria-label={copied ? "API key copied" : "Copy API key"}
                title={copied ? "Copied" : "Copy API key"}
              >
                {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="active-keys-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="active-keys-heading" className="text-sm font-semibold text-ink">
              Active keys
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">Keys currently allowed to access your account.</p>
          </div>
          {active.length > 0 ? (
            <span className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
              {active.length} {active.length === 1 ? "key" : "keys"}
            </span>
          ) : null}
        </div>

        {active.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-surface text-ink-tertiary">
              <KeyIcon className="size-4" />
            </div>
            <p className="mt-3 text-sm font-medium text-ink">No active keys</p>
            <p className="mt-1 text-[12px] text-ink-tertiary">Create one above when you&apos;re ready to connect an agent.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {active.map((key) => (
              <li key={key.id} className="group flex items-start gap-3 px-4 py-4 sm:px-5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg text-ink-secondary">
                  <KeyIcon className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium text-ink">{key.name}</p>
                    <code className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-ink-tertiary">{key.keyPrefix}…</code>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-ink-secondary"
                      >
                        {SCOPE_LABELS[scope] ?? scope}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-tertiary">
                    Created {formatDate(key.createdAt)}
                    <span aria-hidden="true"> · </span>
                    {key.expiresAt ? `Expires ${formatDate(key.expiresAt)}` : "Never expires"}
                    <span aria-hidden="true"> · </span>
                    {key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : "Never used"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Revoke ${key.name}`}
                  title="Revoke key"
                  disabled={busy}
                  onClick={() => revoke(key.id)}
                  className="-mr-1 shrink-0 text-ink-tertiary hover:text-danger"
                >
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
