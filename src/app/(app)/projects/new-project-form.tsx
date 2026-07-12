"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createProject, type CreateProjectState } from "./actions";

/**
 * The "new project" card. Renders as a quiet dashed tile that expands into
 * an inline form — no modal, no page change, nothing to learn.
 */
export function NewProjectForm({ firstProject }: { firstProject: boolean }) {
  const [open, setOpen] = useState(firstProject);
  const [state, formAction, pending] = useActionState<CreateProjectState, FormData>(createProject, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm font-medium text-ink-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span aria-hidden className="text-lg leading-none">
          +
        </span>
        New project
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex min-h-28 flex-col justify-center gap-3 rounded-lg border border-accent/40 bg-surface p-5 shadow-soft"
    >
      <label htmlFor="project-name" className="text-xs font-medium uppercase tracking-wider text-ink-tertiary">
        {firstProject ? "Name your first project" : "Project name"}
      </label>
      <Input
        id="project-name"
        name="name"
        placeholder="Acme landing page"
        autoFocus
        required
        maxLength={80}
        disabled={pending}
      />
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
        {!firstProject && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
