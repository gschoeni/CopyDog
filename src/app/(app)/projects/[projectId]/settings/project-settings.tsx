"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, TrashIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

import { deleteProjectAction } from "../../actions";
import { renameProjectAction } from "./actions";

export interface SettingsMember {
  userId: string;
  role: "owner" | "editor";
  displayName: string;
  avatarUrl: string | null;
}

export function ProjectSettings({
  projectId,
  initialName,
  isOwner,
  currentUserId,
  initialMembers,
}: {
  projectId: string;
  initialName: string;
  isOwner: boolean;
  currentUserId: string;
  initialMembers: SettingsMember[];
}) {
  const [name, setName] = useState(initialName);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <Link
        href={`/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-sm text-ink-tertiary transition-colors hover:text-ink"
      >
        <ChevronLeftIcon className="size-3.5" />
        {name}
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        Who&apos;s working on this project, and how it&apos;s set up.
      </p>

      <ProjectNameSection projectId={projectId} name={name} isOwner={isOwner} onRenamed={setName} />
      <PeopleSection
        projectId={projectId}
        isOwner={isOwner}
        currentUserId={currentUserId}
        initialMembers={initialMembers}
      />
      {isOwner && <DangerZone projectId={projectId} name={name} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Project name — inline rename for the owner, plain text for others   */
/* ------------------------------------------------------------------ */

function ProjectNameSection({
  projectId,
  name,
  isOwner,
  onRenamed,
}: {
  projectId: string;
  name: string;
  isOwner: boolean;
  onRenamed: (name: string) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy || draft.trim() === name) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await renameProjectAction({ projectId, name: draft });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onRenamed(result.name);
      setDraft(result.name);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't rename the project. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-semibold">Project name</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          {name}
          <span className="ml-2 text-ink-tertiary">· only the owner can rename it</span>
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold">Project name</h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          value={draft}
          aria-label="Project name"
          maxLength={80}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          disabled={busy}
        />
        <Button type="submit" variant="secondary" disabled={busy || !draft.trim() || draft.trim() === name}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
      {saved && <p className="mt-2 text-sm text-success">Saved.</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* People — invite, roster, remove (owner) and leave (member)          */
/* ------------------------------------------------------------------ */

function PeopleSection({
  projectId,
  isOwner,
  currentUserId,
  initialMembers,
}: {
  projectId: string;
  isOwner: boolean;
  currentUserId: string;
  initialMembers: SettingsMember[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // userId of the row whose remove/leave is awaiting its second click
  const [armed, setArmed] = useState<string | null>(null);

  async function refreshMembers() {
    const supabase = createClient();
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, profile:profiles(display_name, avatar_url)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    setMembers(
      (
        (data ?? []) as unknown as {
          user_id: string;
          role: "owner" | "editor";
          profile: { display_name: string; avatar_url: string | null } | null;
        }[]
      ).map((row) => ({
        userId: row.user_id,
        role: row.role,
        displayName: row.profile?.display_name ?? "Member",
        avatarUrl: row.profile?.avatar_url ?? null,
      })),
    );
  }

  async function invite(email: string) {
    if (!email.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_email: email.trim(),
    });
    if (rpcError) {
      setError(
        rpcError.message.includes("no CopyDog account")
          ? "No account with that email yet — ask them to sign in once first."
          : "Couldn't invite that person.",
      );
      setBusy(false);
      return;
    }
    await refreshMembers();
    setNotice("Added — they can start editing right away.");
    setBusy(false);
  }

  async function removeMember(member: SettingsMember) {
    if (busy) return;
    const leaving = member.userId === currentUserId;
    setBusy(true);
    setNotice(null);
    setError(null);
    const supabase = createClient();
    const { data, error: deleteError } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", member.userId)
      .select("user_id");
    if (deleteError || !data?.length) {
      // RLS letting the delete through but touching nothing means "not allowed"
      setError(leaving ? "Couldn't leave the project. Please try again." : `Couldn't remove ${member.displayName}.`);
      setArmed(null);
      setBusy(false);
      return;
    }
    if (leaving) {
      router.push("/projects");
      router.refresh();
      return;
    }
    await refreshMembers();
    setArmed(null);
    setBusy(false);
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold">People</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
        Everyone here writes in their own draft, and can publish, propose, and adopt each other&apos;s versions.
      </p>

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
        <Input
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          aria-label="Invite by email"
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          Invite
        </Button>
      </form>
      {notice && <p className="mt-2 text-sm text-success">{notice}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <ul aria-label="Project members" className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isArmed = armed === member.userId;
          // the owner removes anyone else; a member can only remove themself
          const canRemove = isOwner ? !isSelf : isSelf && member.role !== "owner";
          return (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar userId={member.userId} name={member.displayName} avatarUrl={member.avatarUrl} className="size-7 text-xs" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {member.displayName}
                {isSelf && <span className="ml-1.5 text-ink-tertiary">(you)</span>}
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary">
                {member.role}
              </span>
              {canRemove &&
                (isArmed ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void removeMember(member)}>
                      {isSelf ? "Leave" : "Remove"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setArmed(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : isSelf ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setArmed(member.userId)}>
                    Leave project
                  </Button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${member.displayName} from the project`}
                    title="Remove from project"
                    disabled={busy}
                    onClick={() => setArmed(member.userId)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-danger"
                  >
                    <TrashIcon />
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Danger zone — deleting the project, owner only                      */
/* ------------------------------------------------------------------ */

function DangerZone({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteProjectAction(projectId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/projects");
      router.refresh();
    } catch {
      setError("Couldn't delete the project. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold">Danger zone</h2>
      <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-danger/30 px-4 py-3">
        <p className="text-sm leading-relaxed text-ink-secondary">
          Deleting the project removes every page, version, and wireframe for the whole team.
        </p>
        <Button size="sm" variant="danger" className="shrink-0" onClick={() => setConfirming(true)}>
          Delete project
        </Button>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete project ${name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setConfirming(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-raised">
            <h2 className="text-lg font-semibold tracking-tight">Delete “{name}”?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              This deletes the project for everyone on it — every page, every copy version, and the whole
              wireframe history. There is no undo.
            </p>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
                {busy ? "Deleting…" : "Delete project"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
