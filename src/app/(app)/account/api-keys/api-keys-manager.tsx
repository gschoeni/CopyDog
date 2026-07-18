"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TrashIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";

import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export function ApiKeysManager({ keys }: { keys: ApiKeyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    if (typeof name !== "string" || !name.trim()) return;
    setBusy(true);
    setError(null);
    const result = await createApiKeyAction({ name: name.trim() });
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
      <form onSubmit={create} className="flex gap-2">
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
                  <code>{key.keyPrefix}…</code> · created {formatDate(key.createdAt)}
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
