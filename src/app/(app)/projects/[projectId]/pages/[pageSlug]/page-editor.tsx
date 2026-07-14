"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DocEditor, type DocEditorHandle } from "@/components/editor/doc-editor";
import type { ContentSnapshot } from "@/components/editor/doc-structure";
import { Button } from "@/components/ui/button";
import { ImportIcon, LinkIcon, SparklesIcon, UnlinkIcon } from "@/components/ui/icons";
import type { Element } from "@/lib/copy/elements";
import type { DocContent, DocSection } from "@/lib/content/doc";
import { parseElementsMarkdown, serializeElements } from "@/lib/copy/markdown";
import { DEFAULT_SECTION_TITLE, deriveSectionTitle } from "@/lib/copy/sections";
import { shortId } from "@/lib/slug";
import { injectCopy } from "@/lib/wireframe/inject";

import {
  adoptVersionAction,
  createVersionAction,
  generateWireframeAction,
  readVersionAction,
  saveElementsRunAction,
  saveSectionAction,
  saveStructureAction,
} from "./actions";
import { ChatPanel } from "./chat-panel";
import { ImportDialog } from "./import-dialog";
import { PublishControls } from "./publish-controls";
import { SectionNotes } from "./section-notes";
import { SectionToc } from "./section-toc";
import { VersionSwitcher } from "./version-switcher";

/** A page's content as the editor sees it: loose element runs + sections. */
export type PageContentItem =
  | { kind: "elements"; elements: Element[] }
  | {
      kind: "section";
      slug: string;
      title: string;
      activeVersion: string;
      versions: DocSection["versions"];
      linked: boolean;
      elements: Element[];
    };

export interface SectionView {
  slug: string;
  title: string;
  activeVersion: string;
  versions: DocSection["versions"];
  linked: boolean;
  elements: Element[];
}

export interface PageEditorProps {
  projectId: string;
  projectName: string;
  pageSlug: string;
  pageTitle: string;
  initialContent: PageContentItem[];
  initialWireframe: string | null;
  initialDirty: boolean;
}

type SaveState = "saved" | "saving" | "error";
type ViewMode = "copy" | "split" | "wireframe";

interface SectionMeta {
  title: string;
  activeVersion: string;
  versions: DocSection["versions"];
  linked: boolean;
}

const AUTOSAVE_DELAY_MS = 800;

/** Loose runs are identified by their position among runs. */
const runSlug = (ordinal: number) => `run-${ordinal}`;

/**
 * The workbench. The copy pane is ONE continuous document: loose elements
 * by default, sections where the writer groups them. This component owns
 * section metadata (titles, versions, linked state) and turns editor
 * snapshots into Oxen workspace saves — element runs by position, section
 * versions by slug.
 */
export function PageEditor({
  projectId,
  projectName,
  pageSlug,
  pageTitle,
  initialContent,
  initialWireframe,
  initialDirty,
}: PageEditorProps) {
  const router = useRouter();
  const docRef = useRef<DocEditorHandle>(null);

  // ---- section metadata (doc.json fields), keyed by slug ------------------
  const initialMeta = useMemo(
    () =>
      new Map<string, SectionMeta>(
        initialContent
          .filter((c): c is Extract<PageContentItem, { kind: "section" }> => c.kind === "section")
          .map((s) => [s.slug, { title: s.title, activeVersion: s.activeVersion, versions: s.versions, linked: s.linked }]),
      ),
    [initialContent],
  );
  const metaRef = useRef<Map<string, SectionMeta>>(initialMeta);
  const usedSlugs = useRef<Set<string>>(new Set(initialMeta.keys()));
  const makeSlug = useCallback(() => {
    let slug = `sec-${shortId(4)}`;
    while (usedSlugs.current.has(slug)) slug = `sec-${shortId(4)}`;
    usedSlugs.current.add(slug);
    return slug;
  }, []);

  const initialSnapshot = useMemo<ContentSnapshot[]>(
    () =>
      initialContent.map((item) =>
        item.kind === "section"
          ? { kind: "section", slug: item.slug, elements: item.elements }
          : { kind: "elements", elements: item.elements },
      ),
    [initialContent],
  );

  const lastSnapshot = useRef<ContentSnapshot[]>(initialSnapshot);
  // combined view for the preview, TOC, and headers
  const [sections, setSections] = useState<SectionView[]>(() => sectionViews(initialSnapshot, initialMeta));
  const [looseCount, setLooseCount] = useState(() => countLoose(initialSnapshot));

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

  const debounced = useCallback(
    (key: string, save: () => Promise<unknown>) => {
      const existing = contentTimers.current.get(key);
      if (existing) clearTimeout(existing);
      setSaveState("saving");
      contentTimers.current.set(
        key,
        setTimeout(() => {
          contentTimers.current.delete(key);
          void trackSave(save());
        }, AUTOSAVE_DELAY_MS),
      );
    },
    [trackSave],
  );

  const scheduleSectionSave = useCallback(
    (slug: string, elements: Element[]) => {
      debounced(`s:${slug}`, () => {
        const meta = metaRef.current.get(slug);
        if (!meta) return Promise.resolve();
        return saveSectionAction({
          projectId,
          pageSlug,
          sectionSlug: slug,
          versionSlug: meta.activeVersion,
          markdown: serializeElements(elements),
        });
      });
    },
    [debounced, projectId, pageSlug],
  );

  const scheduleRunSave = useCallback(
    (ordinal: number, elements: Element[]) => {
      debounced(`r:${ordinal}`, () =>
        saveElementsRunAction({ projectId, pageSlug, runSlug: runSlug(ordinal), markdown: serializeElements(elements) }),
      );
    },
    [debounced, projectId, pageSlug],
  );

  const scheduleStructureSave = useCallback(() => {
    if (structureTimer.current) clearTimeout(structureTimer.current);
    setSaveState("saving");
    structureTimer.current = setTimeout(() => {
      structureTimer.current = null;
      let run = 0;
      const content: DocContent[] = [];
      for (const entry of lastSnapshot.current) {
        if (entry.kind === "elements") {
          content.push({ kind: "elements", slug: runSlug(run++) });
          continue;
        }
        const meta = metaRef.current.get(entry.slug);
        if (!meta) continue;
        content.push({
          kind: "section",
          slug: entry.slug,
          title: meta.title,
          activeVersion: meta.activeVersion,
          versions: meta.versions,
          linked: meta.linked,
        });
      }
      void trackSave(saveStructureAction({ projectId, pageSlug, content }));
    }, AUTOSAVE_DELAY_MS);
  }, [projectId, pageSlug, trackSave]);

  const rebuildViews = useCallback(() => {
    setSections(sectionViews(lastSnapshot.current, metaRef.current));
    setLooseCount(countLoose(lastSnapshot.current));
  }, []);

  /**
   * The editor speaks; we reconcile. Sections diff by slug (new ones get
   * metadata + files, titles follow their first heading until renamed by
   * hand); loose runs diff by position among runs.
   */
  const handleSnapshotChange = useCallback(
    (snapshot: ContentSnapshot[]) => {
      const previous = lastSnapshot.current;
      const prevSections = new Map(
        previous
          .filter((c): c is Extract<ContentSnapshot, { kind: "section" }> => c.kind === "section")
          .map((s) => [s.slug, s]),
      );
      const nextSectionSlugs = new Set(
        snapshot.filter((c): c is Extract<ContentSnapshot, { kind: "section" }> => c.kind === "section").map((c) => c.slug),
      );
      let structural = false;

      for (const slug of prevSections.keys()) {
        if (!nextSectionSlugs.has(slug)) {
          // keep the meta: undo can resurrect this section, and it must come
          // back with its versions/linked state intact, not as a newborn.
          // doc.json only lists what's in the snapshot, so nothing leaks.
          const timer = contentTimers.current.get(`s:${slug}`);
          if (timer) {
            clearTimeout(timer);
            contentTimers.current.delete(`s:${slug}`);
          }
          structural = true;
        }
      }

      let runOrdinal = 0;
      const prevRuns = previous.filter((c) => c.kind === "elements");
      for (const entry of snapshot) {
        if (entry.kind === "elements") {
          const prevRun = prevRuns[runOrdinal];
          if (!prevRun || !elementsEqual(prevRun.elements, entry.elements)) {
            scheduleRunSave(runOrdinal, entry.elements);
          }
          runOrdinal += 1;
          continue;
        }

        const prev = prevSections.get(entry.slug);
        const meta = metaRef.current.get(entry.slug);
        if (!meta) {
          // born in the editor (grouping, ⊕, Shift+Enter)
          metaRef.current.set(entry.slug, {
            title: deriveSectionTitle(entry.elements),
            activeVersion: "original",
            versions: [{ slug: "original", label: "Original" }],
            linked: true,
          });
          usedSlugs.current.add(entry.slug);
          scheduleSectionSave(entry.slug, entry.elements);
          structural = true;
          continue;
        }

        if (!prev) {
          // resurrected by undo — re-save so the active version file matches
          scheduleSectionSave(entry.slug, entry.elements);
          structural = true;
          continue;
        }

        if (!elementsEqual(prev.elements, entry.elements)) {
          scheduleSectionSave(entry.slug, entry.elements);
          // auto-title until manually renamed
          const prevDerived = deriveSectionTitle(prev.elements);
          if (meta.title === DEFAULT_SECTION_TITLE || meta.title === prevDerived) {
            const derived = deriveSectionTitle(entry.elements);
            if (derived !== meta.title) {
              meta.title = derived;
              structural = true;
            }
          }
        }
      }

      // runs that no longer exist must not save — a stale timer would
      // recreate `run-N.md` for an out-of-range N
      for (const [key, timer] of contentTimers.current) {
        if (key.startsWith("r:") && Number(key.slice(2)) >= runOrdinal) {
          clearTimeout(timer);
          contentTimers.current.delete(key);
        }
      }

      if (!structural) {
        structural =
          previous.length !== snapshot.length ||
          previous.some((entry, i) => {
            const next = snapshot[i]!;
            if (entry.kind !== next.kind) return true;
            return entry.kind === "section" && next.kind === "section" && entry.slug !== next.slug;
          });
      }

      lastSnapshot.current = snapshot;
      rebuildViews();
      if (structural) scheduleStructureSave();
    },
    [rebuildViews, scheduleRunSave, scheduleSectionSave, scheduleStructureSave],
  );

  // ---- section operations (invoked from header chrome) ---------------------
  const switchVersion = useCallback(
    async (slug: string, versionSlug: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return;
      const { markdown } = await readVersionAction({ projectId, pageSlug, sectionSlug: slug, versionSlug });
      meta.activeVersion = versionSlug;
      docRef.current?.replaceSectionElements(slug, parseElementsMarkdown(markdown));
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
      docRef.current?.replaceSectionElements(slug, parseElementsMarkdown(markdown));
      scheduleStructureSave();
      rebuildViews();
    },
    [projectId, pageSlug, scheduleStructureSave, rebuildViews],
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
      docRef.current?.replaceSectionElements(slug, parseElementsMarkdown(markdown));
      scheduleStructureSave();
      rebuildViews();
    },
    [projectId, pageSlug, scheduleStructureSave, rebuildViews],
  );

  const renameSection = useCallback(
    (slug: string, title: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta || meta.title === title) return;
      meta.title = title;
      scheduleStructureSave();
      rebuildViews();
    },
    [scheduleStructureSave, rebuildViews],
  );

  const toggleLinked = useCallback(
    (slug: string) => {
      const meta = metaRef.current.get(slug);
      if (!meta) return;
      meta.linked = !meta.linked;
      scheduleStructureSave();
      rebuildViews();
    },
    [scheduleStructureSave, rebuildViews],
  );

  // version ops hit the server directly; a failure surfaces on the save badge
  const guarded = useCallback((op: Promise<void>) => {
    void op.catch(() => setSaveState("error"));
  }, []);

  const deleteSection = useCallback((slug: string) => {
    docRef.current?.removeSection(slug);
  }, []);

  const moveSection = useCallback((slug: string, direction: -1 | 1) => {
    docRef.current?.moveSection(slug, direction);
  }, []);

  const copyPaneRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((slug: string) => {
    const el = copyPaneRef.current?.querySelector(`[data-section-slug="${CSS.escape(slug)}"]`);
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

  /** The wireframe renders linked sections only. */
  const linkedSections = useMemo(() => sections.filter((s) => s.linked), [sections]);
  const preview = useMemo(
    () => (wireframe ? injectCopy(wireframe, linkedSections.map((s) => ({ slug: s.slug, elements: s.elements }))) : null),
    [wireframe, linkedSections],
  );
  const unlinkedCount = sections.length - linkedSections.length;

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
          {!meta.linked && (
            <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-tertiary">
              unlinked
            </span>
          )}
          <button
            type="button"
            aria-label={meta.linked ? "Unlink from wireframe" : "Link to wireframe"}
            aria-pressed={meta.linked}
            title={
              meta.linked
                ? "Linked: appears in the wireframe. Click to unlink."
                : "Unlinked: kept out of the wireframe. Click to link."
            }
            onClick={() => toggleLinked(slug)}
            className={`flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-hover ${
              meta.linked ? "text-accent" : "text-ink-tertiary"
            }`}
          >
            {meta.linked ? <LinkIcon /> : <UnlinkIcon />}
          </button>
          <VersionSwitcher
            projectId={projectId}
            pageSlug={pageSlug}
            sectionSlug={slug}
            versions={meta.versions}
            activeVersion={meta.activeVersion}
            onSwitch={(v) => guarded(switchVersion(slug, v))}
            onCreate={(label) => guarded(createVersion(slug, label))}
            onAdopt={(source) => guarded(adoptTeammateVersion(slug, source))}
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
    [projectId, pageSlug, sections, renameSection, toggleLinked, guarded, switchVersion, createVersion, adoptTeammateVersion, moveSection, deleteSection],
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
            mode switches. No overflow here — the window scrolls, so sticky
            binds to it. */}
        <div ref={copyPaneRef} className={`min-w-0 flex-1 ${mode === "wireframe" ? "hidden" : ""}`}>
          <div className="flex min-h-full">
            <SectionToc sections={sections} compact={mode === "split"} onNavigate={scrollToSection} />
            <div className="min-w-0 flex-1">
              <div className={`mx-auto w-full px-6 pb-32 pt-8 ${mode === "split" ? "max-w-xl" : "max-w-3xl"}`}>
                <DocEditor
                  ref={docRef}
                  initialContent={initialSnapshot}
                  makeSlug={makeSlug}
                  onSnapshotChange={handleSnapshotChange}
                  renderSectionHeader={renderSectionHeader}
                  autoFocus={initialContent.every((c) => c.elements.length === 0)}
                />
              </div>
            </div>
            {/* balances the TOC so the copy column stays centered in the pane */}
            <div aria-hidden className={`hidden shrink-0 md:block ${mode === "split" ? "w-11" : "w-52"}`} />
          </div>
        </div>

        {mode !== "copy" && (
          <WireframePane
            preview={preview}
            generating={generating}
            hasLayoutReadyCopy={linkedSections.some((s) => s.elements.length > 0)}
            omitted={{ looseElements: looseCount, unlinkedSections: unlinkedCount }}
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

function sectionViews(snapshot: ContentSnapshot[], meta: Map<string, SectionMeta>): SectionView[] {
  const views: SectionView[] = [];
  for (const entry of snapshot) {
    if (entry.kind !== "section") continue;
    const m = meta.get(entry.slug);
    if (!m) continue;
    views.push({ slug: entry.slug, elements: entry.elements, ...m });
  }
  return views;
}

function countLoose(snapshot: ContentSnapshot[]): number {
  // blank lines are layout, not copy — the wireframe nudge shouldn't count them
  return snapshot.reduce(
    (n, entry) =>
      entry.kind === "elements" ? n + entry.elements.filter((el) => !(el.type === "p" && !el.text)).length : n,
    0,
  );
}

function elementsEqual(a: Element[], b: Element[]): boolean {
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
  hasLayoutReadyCopy,
  omitted,
  onGenerate,
  bordered,
  exportHref,
}: {
  preview: string | null;
  generating: boolean;
  hasLayoutReadyCopy: boolean;
  omitted: { looseElements: number; unlinkedSections: number };
  onGenerate: () => void;
  bordered: boolean;
  exportHref: string;
}) {
  const omittedNote = describeOmitted(omitted);
  return (
    <div className={`relative min-w-0 flex-1 overflow-y-auto bg-surface-sunken ${bordered ? "border-l border-border" : ""}`}>
      {preview ? (
        <>
          <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-end gap-2 p-3">
            {omittedNote && (
              <p className="pointer-events-auto rounded-md bg-bg/80 px-2 py-1 text-[11px] text-ink-tertiary backdrop-blur-sm">
                {omittedNote}
              </p>
            )}
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
              {hasLayoutReadyCopy
                ? "Turn your sections into a greyscale layout you can keep editing."
                : "The wireframe lays out sections. Highlight some copy and use “Group into section” first."}
            </p>
            {omittedNote && <p className="mt-2 text-xs text-ink-tertiary">{omittedNote}</p>}
            <Button className="mt-5" onClick={onGenerate} disabled={generating || !hasLayoutReadyCopy}>
              {generating ? "Designing…" : "Generate wireframe from sections"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function describeOmitted({ looseElements, unlinkedSections }: { looseElements: number; unlinkedSections: number }): string | null {
  const parts: string[] = [];
  if (looseElements > 0) parts.push(`${looseElements} loose element${looseElements === 1 ? "" : "s"}`);
  if (unlinkedSections > 0) parts.push(`${unlinkedSections} unlinked section${unlinkedSections === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return `${parts.join(" and ")} won't appear — group or link to include.`;
}
