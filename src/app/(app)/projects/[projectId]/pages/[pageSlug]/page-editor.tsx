"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SectionEditor } from "@/components/editor/section-editor";
import { Button } from "@/components/ui/button";
import { ImportIcon, SparklesIcon } from "@/components/ui/icons";
import type { Block } from "@/lib/copy/blocks";
import type { DocSection } from "@/lib/content/doc";
import { parseSectionMarkdown, serializeBlocks } from "@/lib/copy/markdown";
import { DEFAULT_SECTION_TITLE, deriveSectionTitle, splitIntoSections } from "@/lib/copy/sections";
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
  /**
   * Client-only remount counter: bumped when a section's content changes
   * outside its own editor (auto-splits), so the uncontrolled editor
   * re-reads its blocks.
   */
  epoch?: number;
}

function emptySection(existing: EditorSection[]): EditorSection {
  let n = existing.length + 1;
  let slug = `section-${n}`;
  while (existing.some((s) => s.slug === slug)) slug = `section-${++n}`;
  return {
    slug,
    title: DEFAULT_SECTION_TITLE,
    activeVersion: "original",
    versions: [{ slug: "original", label: "Original" }],
    wireframeSlot: null,
    blocks: [],
  };
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
  // a page is never empty: like a fresh doc, there's always somewhere to type
  const [sections, setSections] = useState<EditorSection[]>(() =>
    initialSections.length > 0 ? initialSections : [emptySection([])],
  );
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
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

  // synchronous view of sections for handlers that need to compute
  // next-state + side effects together (auto-splitting)
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // a brand-new page seeds its first section server-side, once
  const seededEmptyPage = useRef(false);
  useEffect(() => {
    if (initialSections.length > 0 || seededEmptyPage.current) return;
    seededEmptyPage.current = true;
    const seeded = sectionsRef.current;
    const structural = seeded.map(({ slug, title, activeVersion, versions, wireframeSlot }) => ({
      slug,
      title,
      activeVersion,
      versions,
      wireframeSlot,
    }));
    void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
    void trackSave(
      saveSectionAction({ projectId, pageSlug, sectionSlug: seeded[0]!.slug, versionSlug: "original", markdown: "" }),
    );
  }, [initialSections.length, projectId, pageSlug, trackSave]);

  // sections whose structure (e.g. auto-title) changed since the last
  // structural save — sticky, so a later content-only keystroke on the same
  // section can't clobber the pending flag before the debounce fires
  const structuralDirty = useRef(new Set<string>());

  const scheduleSectionSave = useCallback(
    (sectionSlug: string, versionSlug: string, markdown: string, structuralToo: boolean) => {
      if (structuralToo) structuralDirty.current.add(sectionSlug);
      const existing = timers.current.get(sectionSlug);
      if (existing) clearTimeout(existing);
      setSaveState("saving");
      timers.current.set(
        sectionSlug,
        setTimeout(() => {
          timers.current.delete(sectionSlug);
          void trackSave(saveSectionAction({ projectId, pageSlug, sectionSlug, versionSlug, markdown }));
          if (structuralDirty.current.delete(sectionSlug)) {
            const structural = sectionsRef.current.map(({ slug, title, activeVersion, versions, wireframeSlot }) => ({
              slug,
              title,
              activeVersion,
              versions,
              wireframeSlot,
            }));
            void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
          }
        }, AUTOSAVE_DELAY_MS),
      );
    },
    [projectId, pageSlug, trackSave],
  );

  /**
   * Every keystroke lands here. One group → normal debounced autosave with
   * live title derivation. Multiple groups → the document just grew a new
   * section under the writer's cursor: split it out, keep typing.
   */
  const handleMarkdownChange = useCallback(
    (section: EditorSection, markdown: string) => {
      const blocks = parseSectionMarkdown(markdown);
      const groups = splitIntoSections(blocks);
      const current = sectionsRef.current;
      const index = current.findIndex((s) => s.slug === section.slug);
      if (index === -1) return;

      if (groups.length === 1) {
        // auto-title: sections named by their first heading until renamed by hand
        const existing = current[index]!;
        const derived = deriveSectionTitle(blocks);
        const shouldRename =
          existing.title === DEFAULT_SECTION_TITLE || existing.title === deriveSectionTitle(existing.blocks);
        const title = shouldRename ? derived : existing.title;

        const next = current.map((s, i) => (i === index ? { ...s, blocks, title } : s));
        sectionsRef.current = next;
        setSections(next);
        scheduleSectionSave(section.slug, section.activeVersion, markdown, title !== existing.title);
        return;
      }

      // --- auto-split ---
      const existingSlugs = new Set(current.map((s) => s.slug));
      const [first, ...rest] = groups;

      const shrunk: EditorSection = {
        ...current[index]!,
        blocks: first!,
        title:
          current[index]!.title === DEFAULT_SECTION_TITLE || current[index]!.title === deriveSectionTitle(section.blocks)
            ? deriveSectionTitle(first!)
            : current[index]!.title,
        epoch: (current[index]!.epoch ?? 0) + 1,
      };

      const created: EditorSection[] = rest.map((group) => {
        const title = deriveSectionTitle(group);
        const base =
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "section";
        let slug = base;
        for (let n = 2; existingSlugs.has(slug); n++) slug = `${base}-${n}`;
        existingSlugs.add(slug);
        return {
          slug,
          title,
          activeVersion: "original",
          versions: [{ slug: "original", label: "Original" }],
          wireframeSlot: null,
          blocks: group,
        };
      });

      const next = [...current.slice(0, index), shrunk, ...created, ...current.slice(index + 1)];
      sectionsRef.current = next;
      setSections(next);
      // the writer's caret follows the copy into the last new section
      setFocusSlug(created[created.length - 1]!.slug);

      // structural change: persist everything now, not on a debounce
      const pending = timers.current.get(section.slug);
      if (pending) clearTimeout(pending);
      timers.current.delete(section.slug);
      void trackSave(saveSectionAction({
        projectId,
        pageSlug,
        sectionSlug: shrunk.slug,
        versionSlug: shrunk.activeVersion,
        markdown: serializeBlocks(first!),
      }));
      for (const created_ of created) {
        void trackSave(saveSectionAction({
          projectId,
          pageSlug,
          sectionSlug: created_.slug,
          versionSlug: "original",
          markdown: serializeBlocks(created_.blocks),
        }));
      }
      const structural = next.map(({ slug, title, activeVersion, versions, wireframeSlot }) => ({
        slug,
        title,
        activeVersion,
        versions,
        wireframeSlot,
      }));
      void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
    },
    [projectId, pageSlug, scheduleSectionSave, trackSave],
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

  const renameSection = useCallback(
    (slug: string, title: string) => {
      persistStructure(sections.map((s) => (s.slug === slug ? { ...s, title } : s)));
    },
    [sections, persistStructure],
  );

  const deleteSection = useCallback(
    (slug: string) => {
      const remaining = sections.filter((s) => s.slug !== slug);
      // the page always keeps somewhere to type
      persistStructure(remaining.length > 0 ? remaining : [emptySection([])]);
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
          {/* ellipsis: signals a dialog, and keeps this distinct from the dialog's Import submit */}
          <Button variant="ghost" size="icon" onClick={() => setImporting(true)} aria-label="Import…" title="Import…">
            <ImportIcon />
          </Button>
          <Button
            variant={assistantOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={toggleAssistant}
            aria-pressed={assistantOpen}
            aria-label="Assistant"
            title="Assistant"
          >
            <SparklesIcon />
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
                    autoFocus={
                      focusSlug === section.slug ||
                      (focusSlug === null && sections.length === 1 && section.blocks.length === 0)
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {mode !== "copy" && (
          <WireframePane
            preview={preview}
            generating={generating}
            hasCopy={sections.some((s) => s.blocks.length > 0)}
            onGenerate={generate}
            bordered={mode === "split"}
            exportHref={`/projects/${projectId}/pages/${pageSlug}/export`}
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
  exportHref,
}: {
  preview: string | null;
  generating: boolean;
  hasCopy: boolean;
  onGenerate: () => void;
  bordered: boolean;
  exportHref: string;
}) {
  return (
    <div className={`relative min-w-0 flex-1 overflow-y-auto bg-surface-sunken ${bordered ? "border-l border-border" : ""}`}>
      {preview ? (
        <>
          <div className="pointer-events-none sticky top-0 z-10 flex justify-end gap-2 p-3">
            <a
              href={exportHref}
              download
              className="pointer-events-auto inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              Export HTML
            </a>
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
  autoFocus,
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
  autoFocus: boolean;
}) {
  const handleChange = useCallback(
    (markdown: string) => onMarkdownChange(section, markdown),
    [onMarkdownChange, section],
  );

  return (
    <section className="group/section relative">
      <header className="mb-1 flex items-center gap-2">
        <input
          key={section.title}
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
            active version changes or an auto-split rewrites its content */}
        <SectionEditor
          key={`${section.slug}:${section.activeVersion}:${section.epoch ?? 0}`}
          initialBlocks={section.blocks}
          onMarkdownChange={handleChange}
          autoFocus={autoFocus}
          placeholder={autoFocus && section.blocks.length === 0 ? "Start writing — headings become sections as you go…" : undefined}
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
