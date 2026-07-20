"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, ChevronLeftIcon, TrashIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import type { ProjectMember } from "@/lib/members";

import { DeleteProjectDialog } from "../../delete-project-dialog";
import { inviteMemberAction, removeMemberAction, renameProjectAction, updateMemberRoleAction } from "./actions";

export function ProjectSettings({
  projectId,
  name,
  isOwner,
  isCreator,
  creatorId,
  currentUserId,
  members,
}: {
  projectId: string;
  name: string;
  /** Has the owner role: manages people (invite, remove, set roles). */
  isOwner: boolean;
  /** Created the project (projects.owner_id): also renames and deletes. */
  isCreator: boolean;
  creatorId: string;
  currentUserId: string;
  members: ProjectMember[];
}) {
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

      <ProjectNameSection projectId={projectId} name={name} isOwner={isCreator} />
      <PeopleSection
        projectId={projectId}
        isOwner={isOwner}
        creatorId={creatorId}
        currentUserId={currentUserId}
        members={members}
      />
      {isCreator && <DangerZone projectId={projectId} name={name} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Project name — inline rename for the owner, plain text for others   */
/* ------------------------------------------------------------------ */

function ProjectNameSection({ projectId, name, isOwner }: { projectId: string; name: string; isOwner: boolean }) {
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
      setDraft(result.name);
      setSaved(true);
      // the committed name lives server-side; refresh syncs the back-link,
      // the danger zone, and the sidebar everywhere else
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
          <span className="ml-2 text-ink-tertiary">· only the project&apos;s creator can rename it</span>
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
  creatorId,
  currentUserId,
  members,
}: {
  projectId: string;
  isOwner: boolean;
  creatorId: string;
  currentUserId: string;
  members: ProjectMember[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // userId of the row whose remove/leave is awaiting its second click
  const [armed, setArmed] = useState<string | null>(null);

  // optimistic role while the change round-trips; cleared when props catch up
  // (React's "adjust state when props change" render-time pattern)
  const [pendingRole, setPendingRole] = useState<{ userId: string; role: "owner" | "editor" } | null>(null);
  const [prevMembers, setPrevMembers] = useState(members);
  if (prevMembers !== members) {
    setPrevMembers(members);
    setPendingRole(null);
  }

  async function invite(email: string): Promise<boolean> {
    if (!email.trim() || busy) return false;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await inviteMemberAction({ projectId, email });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setNotice(result.added ? "Added — they can start editing right away." : "They're already on this project.");
      router.refresh();
      return true;
    } catch {
      setError("Couldn't invite that person. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: ProjectMember, role: "owner" | "editor") {
    if (busy || member.role === role) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    setPendingRole({ userId: member.userId, role });
    try {
      const result = await updateMemberRoleAction({ projectId, userId: member.userId, role });
      if (!result.ok) {
        setError(result.error);
        setPendingRole(null);
        return;
      }
      setNotice(
        role === "owner"
          ? `${member.displayName} is an owner now — they can manage the team too.`
          : `${member.displayName} is an editor now.`,
      );
      router.refresh();
    } catch {
      setError("Couldn't change their role. Please try again.");
      setPendingRole(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: ProjectMember) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await removeMemberAction({ projectId, userId: member.userId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.left) {
        router.push("/projects");
      }
      router.refresh();
    } catch {
      setError("Couldn't remove them. Please try again.");
    } finally {
      setArmed(null);
      setBusy(false);
    }
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
          void invite(input.value).then((ok) => {
            if (ok) input.value = "";
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
          const isCreatorRow = member.userId === creatorId;
          const isArmed = armed === member.userId;
          // the creator anchors the project: role locked, membership permanent.
          // Owners manage everyone else; anyone else can remove themself.
          const canChangeRole = isOwner && !isSelf && !isCreatorRow;
          const canRemove = isSelf ? !isCreatorRow : isOwner && !isCreatorRow;
          return (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar userId={member.userId} name={member.displayName} avatarUrl={member.avatarUrl} className="size-7 text-xs" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {member.displayName}
                {isSelf && <span className="ml-1.5 text-ink-tertiary">(you)</span>}
              </span>
              {canChangeRole ? (
                <span className="relative shrink-0">
                  <select
                    value={pendingRole?.userId === member.userId ? pendingRole.role : member.role}
                    aria-label={`Change ${member.displayName}'s role`}
                    disabled={busy}
                    onChange={(e) => void changeRole(member, e.target.value as "owner" | "editor")}
                    className="cursor-pointer appearance-none rounded-md border border-transparent bg-transparent py-1 pl-2 pr-6 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary transition-colors hover:border-border hover:text-ink focus:border-accent focus:outline-none disabled:cursor-default disabled:opacity-50"
                  >
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                  </select>
                  <ChevronDownIcon aria-hidden className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-ink-tertiary" />
                </span>
              ) : (
                <span
                  title={isCreatorRow ? "Created the project" : undefined}
                  className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary"
                >
                  {member.role}
                </span>
              )}
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
        <DeleteProjectDialog
          projectId={projectId}
          name={name}
          onClose={() => setConfirming(false)}
          onDeleted={() => {
            router.push("/projects");
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
