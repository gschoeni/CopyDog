"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TrashIcon } from "@/components/ui/icons";
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
  { value: "read", label: "Read", hint: "browse projects, pages, copy, diffs", locked: true },
  { value: "write", label: "Write", hint: "edit copy and layouts in your draft" },
  { value: "collab", label: "Collaborate", hint: "publish, propose, comment" },
  { value: "merge", label: "Merge", hint: "merge teammates' proposals to main — grant sparingly" },
];

type Expiry = 30 | 90 | 365 | null;

const EXPIRY_OPTIONS: { value: Expiry; label: string }[] = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: null, label: "No expiry" },
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

  const active = keys.filter((k) => !k.revoked);

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="space-y-4 rounded-md border border-border p-4">
        <div className="flex gap-2">
          <label htmlFor="key-name" className="sr-only">
            Key name
          </label>
          <Input
            id="key-name"
            name="name"
            required
            maxLength={60}
            placeholder="What's this key for? e.g. Claude Code"
            disabled={busy}
          />
          <Button type="submit" disabled={busy} className="shrink-0">
            Create key
          </Button>
        </div>

        <fieldset>
          <legend className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
            What can it do?
          </legend>
          <div className="mt-2 space-y-2">
            {SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-baseline gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={option.locked ? true : scopes.includes(option.value)}
                  disabled={option.locked || busy}
                  onChange={option.locked ? undefined : () => toggleScope(option.value)}
                  className="translate-y-px accent-accent"
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-ink-tertiary">— {option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">Expires</legend>
          <div className="mt-2 flex gap-1">
            {EXPIRY_OPTIONS.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                disabled={busy}
                onClick={() => setExpiry(option.value)}
                className={
                  "rounded-md border px-2.5 py-1 text-[13px] transition-colors " +
                  (expiry === option.value
                    ? "border-border-strong bg-surface-hover font-medium text-ink"
                    : "border-border text-ink-secondary hover:bg-surface-hover")
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-[12px] leading-relaxed text-ink-tertiary">
          The agent you connect (and the company running it) will process any copy this key can read. Keys are
          stored by MCP clients in local config files — treat them like passwords.
        </p>
      </form>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {freshKey ? (
        <div className="rounded-md border border-border bg-surface p-4">
          <p className="text-sm font-medium">Copy your new key now — it won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-bg px-2 py-1.5 text-[12px]">{freshKey}</code>
            <Button variant="secondary" size="sm" onClick={copyKey} className="shrink-0">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="text-sm text-ink-tertiary">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {active.map((key) => (
            <li key={key.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{key.name}</p>
                <p className="text-[12px] text-ink-tertiary">
                  <code>{key.keyPrefix}…</code> · {key.scopes.join(" + ")}
                  {key.expiresAt ? ` · expires ${formatDate(key.expiresAt)}` : " · no expiry"}
                  {key.lastUsedAt ? ` · last used ${formatDate(key.lastUsedAt)}` : " · never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Revoke ${key.name}`}
                title="Revoke key"
                disabled={busy}
                onClick={() => revoke(key.id)}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
