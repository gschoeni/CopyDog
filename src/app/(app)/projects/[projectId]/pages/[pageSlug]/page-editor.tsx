"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocEditor, type DocEditorHandle } from "@/components/editor/doc-editor";
import type { SectionSnapshot } from "@/components/editor/doc-structure";
import { Button } from "@/components/ui/button";
import { ImportIcon, SparklesIcon } from "@/components/ui/icons";
import type { Block } from "@/lib/copy/blocks";
import type { DocSection } from "@/lib/content/doc";
import { parseSectionMarkdown, serializeBlocks } from "@/lib/copy/markdown";
import { DEFAULT_SECTION_TITLE, deriveSectionTitle } from "@/lib/copy/sections";
import { shortId } from "@/lib/slug";
import { injectCopy } from "@/lib/wireframe/inject";

import {
  adoptVersionAction,
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
import { SectionToc } from "./section-toc";
import { VersionSwitcher } from "./version-switcher";

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

interface SectionMeta {
  title: string;
  activeVersion: string;
  versions: DocSection["versions"];
  wireframeSlot: string | null;
  pinned: boolean;
}

const AUTOSAVE_DELAY_MS = 800;

/**
 * The workbench. The copy pane is ONE continuous document (DocEditor):
 * selection spans sections, blocks drag anywhere, sections group and
 * reorder. This component owns section *metadata* (titles, versions, notes
 * anchors) and turns editor snapshots into Oxen workspace saves.
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
  const docRef = useRef<DocEditorHandle>(null);

  // ---- section metadata (doc.json fields), keyed by slug -----------------
  const metaRef = useRef<Map<string, SectionMeta>>(
    new Map(
      initialSections.map((s) => [
        s.slug,
        {
          title: s.title,
          activeVersion: s.activeVersion,
          versions: s.versions,
          wireframeSlot: s.wireframeSlot,
          pinned: s.pinned,
        },
      ]),
    ),
  );
  const usedSlugs = useRef(new Set(initialSections.map((s) => s.slug)));
  const makeSlug = useCallback(() => {
    let slug = `sec-${shortId(4)}`;
    while (usedSlugs.current.has(slug)) slug = `sec-${shortId(4)}`;
    usedSlugs.current.add(slug);
    return slug;
  }, []);

  const initialSnapshot = useMemo<SectionSnapshot[]>(
    () => initialSections.map((s) => ({ slug: s.slug, blocks: s.blocks, pinned: s.pinned })),
    [initialSections],
  );

  // combined view (meta + live blocks) for the wireframe preview & headers
  const [sections, setSections] = useState<EditorSection[]>(initialSections);
  const lastSnapshot = useRef<SectionSnapshot[]>(initialSnapshot);

  const [wireframe, setWireframe] = useState<string | null>(initialWireframe);
  const [mode, setMode] = useState<ViewMode>("copy");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(initialDirty);
  const [assistantOpen, setAssistantOpen] = useState(false);

  // restore per-project view mode + assistant state after hydration commit
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

  // ---- save machinery ------------------------------------------------------
  const pendingSaves = useRef(0);
  const contentTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const structureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "saved" only when nothing is in flight AND nothing is debouncing
  const settle = useCallback(() => {
    if (pendingSaves.current === 0 && contentTimers.current.size === 0 && structureTimer.current === null) {
      setSaveState("saved");
    }
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

  const scheduleContentSave = useCallback(
    (slug: string, blocks: Block[]) => {
      const existing = contentTimers.current.get(slug);
      if (existing) clearTimeout(existing);
      setSaveState("saving");
      contentTimers.current.set(
        slug,
        setTimeout(() => {
          contentTimers.current.delete(slug);
          const meta = metaRef.current.get(slug);
          if (!meta) {
            settle();
            return;
          }
          void trackSave(
            saveSectionAction({
              projectId,
              pageSlug,
              sectionSlug: slug,
              versionSlug: meta.activeVersion,
              markdown: serializeBlocks(blocks),
            }),
          );
        }, AUTOSAVE_DELAY_MS),
      );
    },
    [projectId, pageSlug, trackSave, settle],
  );

  const scheduleStructureSave = useCallback(() => {
    if (structureTimer.current) clearTimeout(structureTimer.current);
    setSaveState("saving");
    structureTimer.current = setTimeout(() => {
      structureTimer.current = null;
      const structural = lastSnapshot.current
        .filter((s) => metaRef.current.has(s.slug))
        .map((s) => {
          const meta = metaRef.current.get(s.slug)!;
          return {
            slug: s.slug,
            title: meta.title,
            activeVersion: meta.activeVersion,
            versions: meta.versions,
            wireframeSlot: meta.wireframeSlot,
            pinned: meta.pinned,
          };
        });
      void trackSave(saveStructureAction({ projectId, pageSlug, sections: structural }));
    }, AUTOSAVE_DELAY_MS);
  }, [projectId, pageSlug, trackSave]);

  /** Rebuild the combined section view (meta + blocks) for preview/headers. */
  const rebuildSections = useCallback(() => {
    setSections(
      lastSnapshot.current
        .filter((s) => metaRef.current.has(s.slug))
        .map((s) => {
          const meta = metaRef.current.get(s.slug)!;
          return { slug: s.slug, blocks: s.blocks, ...meta };
        }),
    );
  }, []);

  /**
   * The editor speaks; we reconcile. New sections get metadata and files,
   * removed ones are dropped, edited ones autosave, and titles follow their
   * first heading until renamed by hand.
   */
  const handleSnapshotChange = useCallback(
    (snapshot: SectionSnapshot[]) => {
      const previous = lastSnapshot.current;
      const previousBySlug = new Map(previous.map((s) => [s.slug, s]));
      const currentSlugs = new Set(snapshot.map((s) => s.slug));
      let structural = false;

      for (const old of previous) {
        if (!currentSlugs.has(old.slug)) {
          metaRef.current.delete(old.slug);
          const timer = contentTimers.current.get(old.slug);
          if (timer) {
            clearTimeout(timer);
            contentTimers.current.delete(old.slug);
          }
          structural = true;
        }
      }

      for (const section of snapshot) {
        const prev = previousBySlug.get(section.slug);
        const meta = metaRef.current.get(section.slug);

        if (!meta) {
          // born in the editor (auto-split, grouping, +)
          metaRef.current.set(section.slug, {
            title: deriveSectionTitle(section.blocks),
            activeVersion: "original",
            versions: [{ slug: "original", label: "Original" }],
            wireframeSlot: null,
            pinned: section.pinned ?? false,
          });
          usedSlugs.current.add(section.slug);
          scheduleContentSave(section.slug, section.blocks);
          structural = true;
          continue;
        }

        if (meta.pinned !== (section.pinned ?? false)) {
          meta.pinned = section.pinned ?? false;
          structural = true;
        }

        if (prev && !blocksEqual(prev.blocks, section.blocks)) {
          scheduleContentSave(section.slug, section.blocks);
          // auto-title until manually renamed
          const prevDerived = deriveSectionTitle(prev.blocks);
          if (meta.title === DEFAULT_SECTION_TITLE || meta.title === prevDerived) {
            const derived = deriveSectionTitle(section.blocks);
            if (derived !== meta.title) {
              meta.title = derived;
              structural = true;
            }
          }
        }
      }

      if (!structural) {
        structural = previous.length !== snapshot.length || previous.some((s, i) => s.slug !== snapshot[i]!.slug);
      }

      lastSnapshot.current = snapshot;
      rebuildSections();
      if (structural) scheduleStructureSave();
    },
    [rebuildSections, scheduleContentSave, scheduleStructureSave],
  );

  // ---- section operations (invoked from header chrome) ---------------------
  const switchVersion = useCallback(
    async (slug: string, versionSlug: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return;
      const { markdown } = await readVersionAction({ projectId, pageSlug, sectionSlug: slug, versionSlug });
      meta.activeVersion = versionSlug;
      docRef.current?.replaceSectionBlocks(slug, parseSectionMarkdown(markdown));
      scheduleStructureSave();
    },
    [projectId, pageSlug, scheduleStructureSave],
  );

  const createVersion = useCallback(
    async (slug: string, label: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return;
      const { slug: versionSlug, markdown } = await createVersionAction({
        projectId,
        pageSlug,
        sectionSlug: slug,
        label,
        copyFrom: meta.activeVersion,
        existingSlugs: meta.versions.map((v) => v.slug),
      });
      meta.versions = [...meta.versions, { slug: versionSlug, label }];
      meta.activeVersion = versionSlug;
      docRef.current?.replaceSectionBlocks(slug, parseSectionMarkdown(markdown));
      scheduleStructureSave();
      rebuildSections();
    },
    [projectId, pageSlug, scheduleStructureSave, rebuildSections],
  );

  const adoptTeammateVersion = useCallback(
    async (slug: string, source: { authorId: string; versionSlug: string; label: string }) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return;
      const { slug: versionSlug, markdown } = await adoptVersionAction({
        projectId,
        pageSlug,
        sectionSlug: slug,
        versionSlug: source.versionSlug,
        authorId: source.authorId,
        label: source.label,
        existingSlugs: meta.versions.map((v) => v.slug),
      });
      meta.versions = [...meta.versions, { slug: versionSlug, label: source.label }];
      meta.activeVersion = versionSlug;
      docRef.current?.replaceSectionBlocks(slug, parseSectionMarkdown(markdown));
      scheduleStructureSave();
      rebuildSections();
    },
    [projectId, pageSlug, scheduleStructureSave, rebuildSections],
  );

  const renameSection = useCallback(
    (slug: string, title: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta || meta.title === title) return;
      meta.title = title;
      scheduleStructureSave();
      rebuildSections();
    },
    [scheduleStructureSave, rebuildSections],
  );

  const deleteSection = useCallback((slug: string) => {
    docRef.current?.removeSection(slug);
  }, []);

  const moveSection = useCallback((slug: string, direction: -1 | 1) => {
    docRef.current?.moveSection(slug, direction);
  }, []);

  const copyPaneRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((slug: string) => {
    const el = copyPaneRef.current?.querySelector(`[data-section-slug="${CSS.escape(slug)}"]`);
    // scroll-margin-top on .doc-section handles the header/chrome offset,
    // and the browser picks the right scrolling ancestor
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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

  useEffect(() => {
    const timers = contentTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      if (structureTimer.current) clearTimeout(structureTimer.current);
    };
  }, []);

  const preview = useMemo(() => (wireframe ? injectCopy(wireframe, sections) : null), [wireframe, sections]);

  const statusLabel =
    saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save — retrying on next edit" : "Saved to your draft";

  const renderSectionHeader = useCallback(
    (slug: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return null;
      const index = sections.findIndex((s) => s.slug === slug);
      const count = sections.length;
      return (
        <div className="flex items-center gap-2">
          <input
            key={meta.title}
            defaultValue={meta.title}
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title) renameSection(slug, title);
            }}
            aria-label="Section title"
            className="w-full min-w-0 bg-transparent text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-tertiary outline-none transition-colors focus:text-ink-secondary"
          />
          <VersionSwitcher
            projectId={projectId}
            pageSlug={pageSlug}
            sectionSlug={slug}
            versions={meta.versions}
            activeVersion={meta.activeVersion}
            onSwitch={(v) => void switchVersion(slug, v)}
            onCreate={(label) => void createVersion(slug, label)}
            onAdopt={(source) => void adoptTeammateVersion(slug, source)}
          />
          <SectionNotes projectId={projectId} pageSlug={pageSlug} sectionSlug={slug} />
          <button
            type="button"
            aria-label="Move section up"
            title="Move section up"
            disabled={index <= 0}
            onClick={() => moveSection(slug, -1)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-xs text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move section down"
            title="Move section down"
            disabled={index === -1 || index >= count - 1}
            onClick={() => moveSection(slug, 1)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-xs text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Delete section"
            title="Delete section (copy included)"
            onClick={() => deleteSection(slug)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-xs text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-danger"
          >
            ✕
          </button>
        </div>
      );
    },
    [projectId, pageSlug, renameSection, switchVersion, createVersion, adoptTeammateVersion, deleteSection, moveSection, sections],
  );

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
        {/* hidden, not unmounted: the editor keeps its live state across
            mode switches (unmounting would resurrect page-load content) */}
        <div ref={copyPaneRef} className={`min-w-0 flex-1 overflow-y-auto ${mode === "wireframe" ? "hidden" : ""}`}>
          <div className="flex min-h-full">
            <SectionToc sections={sections} compact={mode === "split"} onNavigate={scrollToSection} />
            <div className="min-w-0 flex-1">
              <div className={`mx-auto w-full px-6 pb-32 pt-8 ${mode === "split" ? "max-w-xl" : "max-w-3xl"}`}>
                <DocEditor
                  ref={docRef}
                  initialSections={initialSnapshot}
                  makeSlug={makeSlug}
                  onSnapshotChange={handleSnapshotChange}
                  renderSectionHeader={renderSectionHeader}
                  autoFocus={initialSections.every((s) => s.blocks.length === 0)}
                />
              </div>
            </div>
          </div>
        </div>

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

function blocksEqual(a: Block[], b: Block[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
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
            <Button variant="secondary" size="sm" onClick={onGenerate} disabled={generating} className="pointer-events-auto">
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
