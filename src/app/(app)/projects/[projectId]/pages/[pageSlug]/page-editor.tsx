"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SectionEditor } from "@/components/editor/section-editor";
import { Button } from "@/components/ui/button";
import type { Block } from "@/lib/copy/blocks";
import type { DocSection } from "@/lib/content/doc";
import { parseSectionMarkdown } from "@/lib/copy/markdown";
import { injectCopy } from "@/lib/wireframe/inject";

import {
  createVersionAction,
  generateWireframeAction,
  readVersionAction,
  saveSectionAction,
  saveStructureAction,
} from "./actions";
import { ChatPanel } from "./chat-panel";
import { ImportDialog } from "./import-dialog";
import { PublishControls } from "./publish-controls";
import { SectionNotes } from "./section-notes";
import { VersionSwitcher } from "./version-switcher";
import { adoptVersionAction } from "./actions";

export interface EditorSection extends DocSection {
  blocks: Block[];
}

export interface PageEditorProps {
  projectId: string;
  projectName: string;
  pageSlug: string;
  pageTitle: string;
  initialSections: EditorSection[];
  initialWireframe: string | null;
  initialDirty: boolean;
}

type SaveState = "saved" | "saving" | "error";
type ViewMode = "copy" | "split" | "wireframe";

const AUTOSAVE_DELAY_MS = 800;

/**
 * The workbench: one surface that toggles between the copy document, the
 * greyscale wireframe, and a side-by-side of both. The wireframe pane is a
 * pure projection — `injectCopy(wireframe, sections)` re-runs on every
 * keystroke, so the two views can never disagree.
 */
export function PageEditor({
  projectId,
  projectName,
  pageSlug,
  pageTitle,
  initialSections,
  initialWireframe,
  initialDirty,
}: PageEditorProps) {
  const router = useRouter();
  const [sections, setSections] = useState<EditorSection[]>(initialSections);
  const [wireframe, setWireframe] = useState<string | null>(initialWireframe);
  const [mode, setMode] = useState<ViewMode>("copy");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(initialDirty);
  const [assistantOpen, setAssistantOpen] = useState(false);

  // restore the last view mode + assistant state per project; deferred a
  // microtask so the update lands after hydration commit (before paint) —
  // this also keeps them across the keyed remounts refresh() causes
  useEffect(() => {
    const stored = localStorage.getItem(`copydog:mode:${projectId}`);
    const assistant = localStorage.getItem(`copydog:assistant:${projectId}`) === "1";
    queueMicrotask(() => {
      if (stored === "copy" || stored === "split" || stored === "wireframe") setMode(stored);
      if (assistant) setAssistantOpen(true);
    });
  }, [projectId]);

  const toggleAssistant = useCallback(() => {
    setAssistantOpen((wasOpen) => {
      localStorage.setItem(`copydog:assistant:${projectId}`, wasOpen ? "0" : "1");
      return !wasOpen;
    });
  }, [projectId]);

  const changeMode = useCallback(
    (next: ViewMode) => {
      setMode(next);
      localStorage.setItem(`copydog:mode:${projectId}`, next);
    },
    [projectId],
  );

  const pendingSaves = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // "saved" only when no in-flight requests AND no pending debounce timers —
  // otherwise a reload between debounce and save silently loses keystrokes
  const settle = useCallback(() => {
    if (pendingSaves.current === 0 && timers.current.size === 0) setSaveState("saved");
  }, []);

  const trackSave = useCallback(
    async (save: Promise<unknown>) => {
      pendingSaves.current += 1;
      setSaveState("saving");
      try {
        await save;
        pendingSaves.current -= 1;
        setDirty(true);
        settle();
      } catch {
        pendingSaves.current -= 1;
        setSaveState("error");
      }
    },
    [settle],
  );

  /** Debounced per section, so a burst of typing is one workspace write. */
  const handleMarkdownChange = useCallback(
    (section: EditorSection, markdown: string) => {
      // live preview: the wireframe projection updates immediately
      setSections((current) =>
        current.map((s) => (s.slug === section.slug ? { ...s, blocks: parseSectionMarkdown(markdown) } : s)),
      );

      const existing = timers.current.get(section.slug);
      if (existing) clearTimeout(existing);
      setSaveState("saving");
      timers.current.set(
        section.slug,
        setTimeout(() => {
          timers.current.delete(section.slug);
          void trackSave(
            saveSectionAction({
              projectId,
              pageSlug,
              sectionSlug: section.slug,
              versionSlug: section.activeVersion,
              markdown,
            }),
          );
        }, AUTOSAVE_DELAY_MS),
      );
    },
    [projectId, pageSlug, trackSave],
  );

  const persistStructure = useCallback(
    (next: EditorSection[]) => {
      setSections(next);
      const structural = next.map(({ slug, title, activeVersion, versions, wireframeSlot }) => ({
        slug,
        title,
        activeVersion,
        versions,
        wireframeSlot,
      }));
      void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
    },
    [projectId, pageSlug, trackSave],
  );

  const switchVersion = useCallback(
    async (sectionSlug: string, versionSlug: string) => {
      const { markdown } = await readVersionAction({ projectId, pageSlug, sectionSlug, versionSlug });
      setSections((current) => {
        const next = current.map((s) =>
          s.slug === sectionSlug ? { ...s, activeVersion: versionSlug, blocks: parseSectionMarkdown(markdown) } : s,
        );
        const structural = next.map(({ slug, title, activeVersion, versions, wireframeSlot }) => ({
          slug,
          title,
          activeVersion,
          versions,
          wireframeSlot,
        }));
        void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
        return next;
      });
    },
    [projectId, pageSlug, trackSave],
  );

  const adoptTeammateVersion = useCallback(
    async (sectionSlug: string, source: { authorId: string; versionSlug: string; label: string }) => {
      const section = sections.find((s) => s.slug === sectionSlug);
      if (!section) return;
      const { slug, markdown } = await adoptVersionAction({
        projectId,
        pageSlug,
        sectionSlug,
        versionSlug: source.versionSlug,
        authorId: source.authorId,
        label: source.label,
        existingSlugs: section.versions.map((v) => v.slug),
      });
      persistStructure(
        sections.map((s) =>
          s.slug === sectionSlug
            ? {
                ...s,
                activeVersion: slug,
                versions: [...s.versions, { slug, label: source.label }],
                blocks: parseSectionMarkdown(markdown),
              }
            : s,
        ),
      );
    },
    [sections, projectId, pageSlug, persistStructure],
  );

  const createVersion = useCallback(
    async (sectionSlug: string, label: string) => {
      const section = sections.find((s) => s.slug === sectionSlug);
      if (!section) return;
      const { slug, markdown } = await createVersionAction({
        projectId,
        pageSlug,
        sectionSlug,
        label,
        copyFrom: section.activeVersion,
        existingSlugs: section.versions.map((v) => v.slug),
      });
      persistStructure(
        sections.map((s) =>
          s.slug === sectionSlug
            ? {
                ...s,
                activeVersion: slug,
                versions: [...s.versions, { slug, label }],
                // the server copied the source version — render that copy
                blocks: parseSectionMarkdown(markdown),
              }
            : s,
        ),
      );
    },
    [sections, projectId, pageSlug, persistStructure],
  );

  const addSection = useCallback(() => {
    const base = "section";
    let n = sections.length + 1;
    let slug = `${base}-${n}`;
    while (sections.some((s) => s.slug === slug)) slug = `${base}-${++n}`;

    const section: EditorSection = {
      slug,
      title: "Untitled section",
      activeVersion: "original",
      versions: [{ slug: "original", label: "Original" }],
      wireframeSlot: null,
      blocks: [],
    };
    persistStructure([...sections, section]);
    // seed the version file so it exists even if the user never types
    void trackSave(saveSectionAction({ projectId, pageSlug, sectionSlug: slug, versionSlug: "original", markdown: "" }));
  }, [sections, persistStructure, projectId, pageSlug, trackSave]);

  const renameSection = useCallback(
    (slug: string, title: string) => {
      persistStructure(sections.map((s) => (s.slug === slug ? { ...s, title } : s)));
    },
    [sections, persistStructure],
  );

  const deleteSection = useCallback(
    (slug: string) => {
      persistStructure(sections.filter((s) => s.slug !== slug));
    },
    [sections, persistStructure],
  );

  const moveSection = useCallback(
    (slug: string, direction: -1 | 1) => {
      const index = sections.findIndex((s) => s.slug === slug);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= sections.length) return;
      const next = [...sections];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      persistStructure(next);
    },
    [sections, persistStructure],
  );

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const { html } = await generateWireframeAction({ projectId, pageSlug });
      setWireframe(html);
      if (mode === "copy") changeMode("split");
    } finally {
      setGenerating(false);
    }
  }, [projectId, pageSlug, mode, changeMode]);

  // flush pending timers on unmount so the last keystrokes still save
  useEffect(() => {
    const activeTimers = timers.current;
    return () => activeTimers.forEach((t) => clearTimeout(t));
  }, []);

  /** The live projection: wireframe + current copy, recomputed on each edit. */
  const preview = useMemo(
    () => (wireframe ? injectCopy(wireframe, sections) : null),
    [wireframe, sections],
  );

  const statusLabel =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save — retrying on next edit" : "Saved to your draft";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-2.5">
        <nav className="min-w-0 truncate text-xs text-ink-tertiary">
          <Link href="/projects" className="hover:text-ink">
            Projects
          </Link>
          <span className="mx-1.5">/</span>
          <Link href={`/projects/${projectId}`} className="hover:text-ink">
            {projectName}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-secondary">{pageTitle}</span>
        </nav>
        <p aria-live="polite" className={`hidden shrink-0 text-xs sm:block ${saveState === "error" ? "text-danger" : "text-ink-tertiary"}`}>
          {statusLabel}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
            Import…
          </Button>
          <Button
            variant={assistantOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleAssistant}
            aria-pressed={assistantOpen}
          >
            Assistant
          </Button>
          <PublishControls projectId={projectId} pageSlug={pageSlug} dirty={dirty} onPublished={() => setDirty(false)} />
          <ModeToggle mode={mode} onChange={changeMode} />
        </div>
      </div>

      {importing && (
        <ImportDialog
          projectId={projectId}
          pageSlug={pageSlug}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            // server content changed wholesale — re-render from the source
            router.refresh();
          }}
        />
      )}

      <div className={`min-h-0 flex-1 ${mode === "split" ? "grid grid-cols-2" : "flex"}`}>
        {mode !== "wireframe" && (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className={`mx-auto w-full px-6 pb-32 pt-8 ${mode === "split" ? "max-w-xl" : "max-w-2xl"}`}>
              <div className="space-y-10">
                {sections.map((section, index) => (
                  <SectionCard
                    key={section.slug}
                    projectId={projectId}
                    pageSlug={pageSlug}
                    section={section}
                    isFirst={index === 0}
                    isLast={index === sections.length - 1}
                    onMarkdownChange={handleMarkdownChange}
                    onRename={renameSection}
                    onDelete={deleteSection}
                    onMove={moveSection}
                    onSwitchVersion={switchVersion}
                    onCreateVersion={createVersion}
                    onAdoptVersion={adoptTeammateVersion}
                  />
                ))}
              </div>
              <div className="mt-10">
                <Button variant="secondary" size="sm" onClick={addSection}>
                  + Add section
                </Button>
                {sections.length === 0 && (
                  <p className="mt-3 text-sm text-ink-tertiary">
                    Sections group your copy — a hero, a feature list, a call to action — and later map to wireframe
                    slots.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {mode !== "copy" && (
          <WireframePane
            preview={preview}
            generating={generating}
            hasCopy={sections.length > 0}
            onGenerate={generate}
            bordered={mode === "split"}
          />
        )}

        {assistantOpen && (
          <ChatPanel
            projectId={projectId}
            pageSlug={pageSlug}
            onMutated={() => {
              setDirty(true);
              // the agent edited the draft server-side — reload the view
              router.refresh();
            }}
            onClose={toggleAssistant}
          />
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options: { value: ViewMode; label: string }[] = [
    { value: "copy", label: "Copy" },
    { value: "split", label: "Split" },
    { value: "wireframe", label: "Wireframe" },
  ];
  return (
    <div role="tablist" aria-label="View mode" className="flex shrink-0 rounded-lg border border-border bg-surface-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={mode === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            mode === option.value ? "bg-surface text-ink shadow-soft" : "text-ink-tertiary hover:text-ink-secondary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function WireframePane({
  preview,
  generating,
  hasCopy,
  onGenerate,
  bordered,
}: {
  preview: string | null;
  generating: boolean;
  hasCopy: boolean;
  onGenerate: () => void;
  bordered: boolean;
}) {
  return (
    <div className={`relative min-w-0 flex-1 overflow-y-auto bg-surface-sunken ${bordered ? "border-l border-border" : ""}`}>
      {preview ? (
        <>
          <div className="pointer-events-none sticky top-0 z-10 flex justify-end p-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={onGenerate}
              disabled={generating}
              className="pointer-events-auto"
            >
              {generating ? "Designing…" : "Regenerate layout"}
            </Button>
          </div>
          <div className="px-6 pb-16">
            <div
              className="wf-root mx-auto max-w-5xl overflow-hidden rounded-lg border border-border shadow-soft"
              // sanitized at generation; copy is escaped during injection
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
        </>
      ) : (
        <div className="flex h-full min-h-64 items-center justify-center p-10">
          <div className="max-w-sm text-center">
            <div className="wf-root mx-auto mb-5 w-40 rounded-md border border-border p-3" aria-hidden>
              <div className="wf-empty mb-2 w-2/3" style={{ minHeight: "0.8em" }} />
              <div className="wf-empty mb-2" style={{ minHeight: "0.5em" }} />
              <div className="wf-empty w-1/2" style={{ minHeight: "0.5em" }} />
            </div>
            <h2 className="text-sm font-semibold">No wireframe yet</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
              {hasCopy
                ? "Turn your copy into a greyscale layout. Every section becomes a designed block you can keep editing."
                : "Write some copy first — then CopyDog can lay it out as a wireframe."}
            </p>
            <Button className="mt-5" onClick={onGenerate} disabled={generating || !hasCopy}>
              {generating ? "Designing…" : "Generate wireframe from copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  projectId,
  pageSlug,
  section,
  isFirst,
  isLast,
  onMarkdownChange,
  onRename,
  onDelete,
  onMove,
  onSwitchVersion,
  onCreateVersion,
  onAdoptVersion,
}: {
  projectId: string;
  pageSlug: string;
  section: EditorSection;
  isFirst: boolean;
  isLast: boolean;
  onMarkdownChange: (section: EditorSection, markdown: string) => void;
  onRename: (slug: string, title: string) => void;
  onDelete: (slug: string) => void;
  onMove: (slug: string, direction: -1 | 1) => void;
  onSwitchVersion: (sectionSlug: string, versionSlug: string) => void;
  onCreateVersion: (sectionSlug: string, label: string) => void;
  onAdoptVersion: (sectionSlug: string, source: { authorId: string; versionSlug: string; label: string }) => void;
}) {
  const handleChange = useCallback(
    (markdown: string) => onMarkdownChange(section, markdown),
    [onMarkdownChange, section],
  );

  return (
    <section className="group/section relative">
      <header className="mb-1 flex items-center gap-2">
        <input
          defaultValue={section.title}
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== section.title) onRename(section.slug, title);
          }}
          aria-label="Section title"
          className="w-full bg-transparent text-xs font-semibold uppercase tracking-[0.15em] text-ink-tertiary outline-none transition-colors focus:text-ink-secondary"
        />
        <VersionSwitcher
          projectId={projectId}
          pageSlug={pageSlug}
          sectionSlug={section.slug}
          versions={section.versions}
          activeVersion={section.activeVersion}
          onSwitch={(slug) => onSwitchVersion(section.slug, slug)}
          onCreate={(label) => onCreateVersion(section.slug, label)}
          onAdopt={(source) => onAdoptVersion(section.slug, source)}
        />
        <SectionNotes projectId={projectId} pageSlug={pageSlug} sectionSlug={section.slug} />
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100">
          <IconButton label="Move section up" disabled={isFirst} onClick={() => onMove(section.slug, -1)}>
            ↑
          </IconButton>
          <IconButton label="Move section down" disabled={isLast} onClick={() => onMove(section.slug, 1)}>
            ↓
          </IconButton>
          <IconButton label="Delete section" onClick={() => onDelete(section.slug)}>
            ✕
          </IconButton>
        </div>
      </header>
      <div className="rounded-lg border border-transparent px-4 py-2 transition-colors focus-within:border-border focus-within:bg-surface focus-within:shadow-soft group-hover/section:border-border">
        {/* uncontrolled editor: the key remounts it with fresh blocks when the
            active version changes (state updates land before the remount) */}
        <SectionEditor
          key={`${section.slug}:${section.activeVersion}`}
          initialBlocks={section.blocks}
          onMarkdownChange={handleChange}
        />
      </div>
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-xs text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}
