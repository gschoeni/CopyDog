"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export interface Member {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
}

/** Members list with invite-by-email (the invitee needs a CopyDog account). */
export function MembersCard({ projectId, initialMembers }: { projectId: string; initialMembers: Member[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(email: string) {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_email: email.trim(),
    });
    if (rpcError) {
      setError(
        rpcError.message.includes("no CopyDog account")
          ? "No CopyDog account with that email yet — ask them to sign in once first."
          : "Couldn't invite that person.",
      );
      setBusy(false);
      return;
    }
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, profile:profiles(display_name)")
      .eq("project_id", projectId);
    setMembers(
      ((data ?? []) as unknown as { user_id: string; role: "owner" | "editor"; profile: { display_name: string } | null }[]).map(
        (row) => ({ userId: row.user_id, role: row.role, displayName: row.profile?.display_name ?? "Member" }),
      ),
    );
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-soft">
      <h2 className="text-sm font-semibold tracking-tight">Team</h2>
      <ul className="mt-3 space-y-1.5">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">{member.displayName}</span>
            <span className="text-[11px] uppercase tracking-wide text-ink-tertiary">{member.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("email") as HTMLInputElement;
          void invite(input.value).then(() => {
            input.value = "";
          });
        }}
      >
        <Input name="email" type="email" placeholder="teammate@studio.com" aria-label="Invite by email" disabled={busy} />
        <Button type="submit" variant="secondary" size="md" disabled={busy}>
          {busy ? "Inviting…" : "Invite"}
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs leading-relaxed text-ink-tertiary">
        Everyone edits in their own draft — no one can overwrite your work.
      </p>
    </section>
  );
}
