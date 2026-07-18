"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DocEditor, type DocEditorHandle } from "@/components/editor/doc-editor";
import type { ContentSnapshot } from "@/components/editor/doc-structure";
import { Button } from "@/components/ui/button";
import {
  AddToChatIcon,
  CopyModeIcon,
  DownloadIcon,
  DuplicateIcon,
  ImportIcon,
  LinkIcon,
  SplitModeIcon,
  UnlinkIcon,
  TrashIcon,
  WandIcon,
  WireframeModeIcon,
} from "@/components/ui/icons";
import type { ChatContextRef } from "@/lib/agent/context";
import type { Element } from "@/lib/copy/elements";
import type { DocContent, DocSection } from "@/lib/content/doc";
import type { PageLinkOption } from "@/lib/content/site";
import { parseElementsMarkdown, serializeElements } from "@/lib/copy/markdown";
import { DEFAULT_SECTION_TITLE, deriveSectionTitle } from "@/lib/copy/sections";
import { shortId } from "@/lib/slug";
import { injectCopy } from "@/lib/wireframe/inject";

import {
  adoptVersionAction,
  createVersionAction,
  generateWireframeAction,
  readVersionAction,
  readWireframeAction,
  saveElementsRunAction,
  saveSectionAction,
  saveStructureAction,
} from "./actions";
import { ChatPanel, type ChatPanelHandle } from "./chat-panel";
import { ImportDialog } from "./import-dialog";
import { PublishControls } from "./publish-controls";
import { SectionNotes } from "./section-notes";
import { SectionToc } from "./section-toc";
import { usePageSaveNavigation } from "./save-navigation";
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
  /** root→page sitemap chain for this page — the breadcrumb trail */
  pagePath: { slug: string; title: string }[];
  /** Every project page, including nested subpages, for link autocomplete. */
  linkPages: PageLinkOption[];
  initialContent: PageContentItem[];
  initialWireframe: string | null;
  initialDirty: boolean;
}

type SaveState = "saved" | "saving" | "error";
type ViewMode = "copy" | "split" | "wireframe";

interface PendingSave {
  timer: ReturnType<typeof setTimeout>;
  save: () => Promise<unknown>;
}

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
  pagePath,
  linkPages,
  initialContent,
  initialWireframe,
  initialDirty,
}: PageEditorProps) {
  const router = useRouter();
  const { navigate, registerFlush } = usePageSaveNavigation();
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

  // ---- "Add to chat": selections attach to the assistant as context chips --
  const chatRef = useRef<ChatPanelHandle>(null);
  const addContextToChat = useCallback(
    (payload: Pick<ChatContextRef, "source" | "sectionSlug" | "text"> & { elementType?: string | null }) => {
      const sectionTitle = payload.sectionSlug ? metaRef.current.get(payload.sectionSlug)?.title ?? null : null;
      setAssistantOpen(true);
      localStorage.setItem(`copydog:assistant:${projectId}`, "1");
      chatRef.current?.addContext({
        source: payload.source,
        sectionSlug: payload.sectionSlug,
        sectionTitle,
        text: payload.text,
        elementType: payload.elementType ?? null,
      });
    },
    [projectId],
  );

  const changeMode = useCallback(
    (next: ViewMode) => {
      setMode(next);
      localStorage.setItem(`copydog:mode:${projectId}`, next);
    },
    [projectId],
  );

  // ---- save machinery ------------------------------------------------------
  const pendingSaves = useRef(0);
  const activeSaves = useRef(new Set<Promise<unknown>>());
  const contentTimers = useRef(new Map<string, PendingSave>());
  const structureTimer = useRef<PendingSave | null>(null);

  // "saved" only when nothing is in flight AND nothing is debouncing
  const settle = useCallback(() => {
    if (pendingSaves.current === 0 && contentTimers.current.size === 0 && structureTimer.current === null) {
      setSaveState("saved");
    }
  }, []);

  const trackSave = useCallback(
    async (save: Promise<unknown>) => {
      pendingSaves.current += 1;
      activeSaves.current.add(save);
      setSaveState("saving");
      try {
        await save;
        pendingSaves.current -= 1;
        activeSaves.current.delete(save);
        setDirty(true);
        settle();
      } catch {
        pendingSaves.current -= 1;
        activeSaves.current.delete(save);
        setSaveState("error");
      }
    },
    [settle],
  );

  const debounced = useCallback(
    (key: string, save: () => Promise<unknown>) => {
      const existing = contentTimers.current.get(key);
      if (existing) clearTimeout(existing.timer);
      setSaveState("saving");
      const pending: PendingSave = {
        save,
        timer: setTimeout(() => {
          contentTimers.current.delete(key);
          void trackSave(save());
        }, AUTOSAVE_DELAY_MS),
      };
      contentTimers.current.set(key, pending);
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

  const saveStructure = useCallback(() => {
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
    return saveStructureAction({ projectId, pageSlug, content });
  }, [projectId, pageSlug]);

  const scheduleStructureSave = useCallback(() => {
    if (structureTimer.current) clearTimeout(structureTimer.current.timer);
    setSaveState("saving");
    const pending: PendingSave = {
      save: saveStructure,
      timer: setTimeout(() => {
        structureTimer.current = null;
        void trackSave(saveStructure());
      }, AUTOSAVE_DELAY_MS),
    };
    structureTimer.current = pending;
  }, [saveStructure, trackSave]);

  /**
   * Client-side page navigation unmounts this editor. Start every debounced
   * write before its closures disappear, with doc.json last so it never
   * points at content files that have not been written yet.
   */
  const flushPendingSaves = useCallback(async () => {
    const saves: Array<() => Promise<unknown>> = [];
    for (const pending of contentTimers.current.values()) {
      clearTimeout(pending.timer);
      saves.push(pending.save);
    }
    contentTimers.current.clear();
    if (structureTimer.current) {
      clearTimeout(structureTimer.current.timer);
      saves.push(structureTimer.current.save);
      structureTimer.current = null;
    }

    await Promise.allSettled([...activeSaves.current]);
    for (const save of saves) {
      try {
        await save();
      } catch (error) {
        console.error("autosave flush failed", error);
      }
    }
  }, []);

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
            clearTimeout(timer.timer);
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
          // born in the editor (grouping, rail ⊕, phantom)
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
          clearTimeout(timer.timer);
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

  const duplicateSection = useCallback(
    (slug: string) => {
      const source = metaRef.current.get(slug);
      if (!source) return;
      const duplicateSlug = makeSlug();
      metaRef.current.set(duplicateSlug, {
        title: `${source.title} copy`,
        activeVersion: "original",
        versions: [{ slug: "original", label: "Original" }],
        linked: source.linked,
      });
      docRef.current?.duplicateSection(slug, duplicateSlug);
    },
    [makeSlug],
  );

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
    const unregister = registerFlush(flushPendingSaves);
    return () => {
      unregister();
      void flushPendingSaves();
    };
  }, [flushPendingSaves, registerFlush]);

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
            aria-label="Duplicate section"
            title="Duplicate section"
            onClick={() => duplicateSection(slug)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <DuplicateIcon />
          </button>
          <button
            type="button"
            aria-label="Delete section"
            title="Delete section (copy included)"
            onClick={() => deleteSection(slug)}
            className="flex size-6 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-danger"
          >
            <TrashIcon />
          </button>
        </div>
      );
    },
    [projectId, pageSlug, sections, renameSection, toggleLinked, guarded, switchVersion, createVersion, adoptTeammateVersion, moveSection, duplicateSection, deleteSection],
  );

  return (
    // min-w-0: this column must shrink when side panels open, never push
    // the page into horizontal scroll
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* sticky under the app header (h-14): the toolbar stays reachable and
          gives split mode a fixed 6.5rem chrome offset to pin panes against */}
      <div className="sticky top-14 z-10 flex h-12 items-center justify-between gap-4 border-b border-border bg-bg/80 px-6 backdrop-blur">
        <nav aria-label="Breadcrumbs" className="min-w-0 truncate text-xs text-ink-tertiary">
          <Link
            href="/projects"
            onNavigate={(event) => {
              event.preventDefault();
              void navigate("/projects");
            }}
            className="hover:text-ink"
          >
            Projects
          </Link>
          <span className="mx-1.5">/</span>
          <Link
            href={`/projects/${projectId}`}
            onNavigate={(event) => {
              event.preventDefault();
              void navigate(`/projects/${projectId}`);
            }}
            className="hover:text-ink"
          >
            {projectName}
          </Link>
          {/* the full nesting chain: ancestors navigate, the page itself is where you are */}
          {pagePath.map((crumb, i) => (
            <span key={crumb.slug}>
              <span className="mx-1.5">/</span>
              {i < pagePath.length - 1 ? (
                <Link
                  href={`/projects/${projectId}/pages/${crumb.slug}`}
                  onNavigate={(event) => {
                    event.preventDefault();
                    void navigate(`/projects/${projectId}/pages/${crumb.slug}`);
                  }}
                  className="hover:text-ink"
                >
                  {crumb.title}
                </Link>
              ) : (
                <span className="text-ink-secondary">{crumb.title}</span>
              )}
            </span>
          ))}
        </nav>
        <p aria-live="polite" className={`hidden shrink-0 text-xs sm:block ${saveState === "error" ? "text-danger" : "text-ink-tertiary"}`}>
          {statusLabel}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {/* ellipsis: signals a dialog, and keeps this distinct from the dialog's Import submit */}
          <Button variant="ghost" size="icon" onClick={() => setImporting(true)} aria-label="Import…" title="Import…">
            <ImportIcon />
          </Button>
          {/* the assistant's only affordance is its right-edge rail — one
              home, no duplicate sparkles in the toolbar */}
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

      {/* one flex row: content panes share the leftover width equally
          (flex-1 basis-0) and any number of viewport-pinned side panels
          (assistant today, more later) sit beside them without wrapping */}
      <div className="flex min-h-0 flex-1">
        {/* hidden, not unmounted: the editor keeps its live state across
            mode switches. No overflow here — the window scrolls, so sticky
            binds to it. */}
        <div ref={copyPaneRef} className={`min-w-0 flex-1 basis-0 ${mode === "wireframe" ? "hidden" : ""}`}>
          <div className="flex min-h-full">
            <SectionToc sections={sections} compact={mode === "split"} onNavigate={scrollToSection} />
            <div className="min-w-0 flex-1">
              <div className={`mx-auto w-full px-6 pb-32 pt-8 ${mode === "split" ? "max-w-xl" : "max-w-3xl"}`}>
                <DocEditor
                  ref={docRef}
                  initialContent={initialSnapshot}
                  linkPages={linkPages}
                  makeSlug={makeSlug}
                  onSnapshotChange={handleSnapshotChange}
                  renderSectionHeader={renderSectionHeader}
                  onAddToChat={({ sectionSlug, text }) => addContextToChat({ source: "copy", sectionSlug, text })}
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
            onAddToChat={(payload) => addContextToChat({ source: "wireframe", ...payload })}
          />
        )}

        {/* always present: collapsed it's the slim rail on the right edge,
            so the assistant is one click away in every mode */}
        <ChatPanel
          ref={chatRef}
          projectId={projectId}
          pageSlug={pageSlug}
          collapsed={!assistantOpen}
          onToggle={toggleAssistant}
          onLiveMutation={() => {
            setDirty(true);
            // mid-turn: pull just the wireframe so the design evolves live
            // without remounting the editor (which would kill the stream)
            void readWireframeAction({ projectId, pageSlug }).then(({ html }) => {
              if (html) setWireframe(html);
            });
          }}
          onMutated={() => {
            setDirty(true);
            // the agent edited the draft server-side — reload the view
            router.refresh();
          }}
        />
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
  const options: { value: ViewMode; label: string; icon: ReactNode }[] = [
    { value: "copy", label: "Copy", icon: <CopyModeIcon /> },
    { value: "split", label: "Split", icon: <SplitModeIcon /> },
    { value: "wireframe", label: "Wireframe", icon: <WireframeModeIcon /> },
  ];
  return (
    <div role="tablist" aria-label="View mode" className="flex shrink-0 rounded-lg border border-border bg-surface-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={mode === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={`flex items-center justify-center rounded-md px-2.5 py-1 transition-colors ${
            mode === option.value ? "bg-surface text-ink shadow-soft" : "text-ink-tertiary hover:text-ink-secondary"
          }`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

/** What a wireframe "Add to chat" resolves to; `text: null` attaches the whole section. */
interface WireframeChatPayload {
  sectionSlug: string | null;
  text: string | null;
  elementType: string | null;
}

const nearestElement = (node: Node): HTMLElement | null =>
  node instanceof HTMLElement ? node : node.parentElement;

function WireframePane({
  preview,
  generating,
  hasLayoutReadyCopy,
  omitted,
  onGenerate,
  bordered,
  exportHref,
  onAddToChat,
}: {
  preview: string | null;
  generating: boolean;
  hasLayoutReadyCopy: boolean;
  omitted: { looseElements: number; unlinkedSections: number };
  onGenerate: () => void;
  bordered: boolean;
  exportHref: string;
  onAddToChat: (payload: WireframeChatPayload) => void;
}) {
  const omittedNote = describeOmitted(omitted);
  const containerRef = useRef<HTMLDivElement>(null);
  // a finished text selection: pill pinned under its end
  const [selectionPin, setSelectionPin] = useState<{ top: number; left: number; payload: WireframeChatPayload } | null>(null);
  // the hovered section: pill pinned at its top-right corner
  const [hoverPin, setHoverPin] = useState<{ top: number; left: number; slug: string } | null>(null);

  const handleMouseUp = () => {
    // let the browser settle the selection before reading it
    window.requestAnimationFrame(() => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionPin(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();
      const anchor = nearestElement(range.commonAncestorContainer);
      if (!text || !anchor?.closest(".wf-root") || !container.contains(anchor)) {
        setSelectionPin(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setSelectionPin({
        top: rect.bottom - containerRect.top + container.scrollTop + 8,
        // the pill right-aligns to the selection end (it renders -translate-x-full)
        left: Math.min(Math.max(rect.right - containerRect.left, 132), containerRect.width - 16),
        payload: {
          sectionSlug: anchor.closest("[data-copy]")?.getAttribute("data-copy") ?? null,
          text: text.slice(0, 4000),
          elementType: nearestElement(range.startContainer)?.closest("[data-element]")?.getAttribute("data-element") ?? null,
        },
      });
    });
  };

  // the pin outlives the mouseup only as long as the selection does
  useEffect(() => {
    if (!selectionPin) return;
    const clear = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setSelectionPin(null);
    };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, [selectionPin]);

  const handleMouseOver = (event: React.MouseEvent) => {
    const container = containerRef.current;
    const target = event.target as HTMLElement | null;
    if (!container || target?.closest("[data-add-to-chat]")) return;
    const section = target?.closest("[data-copy]");
    const slug = section?.getAttribute("data-copy");
    if (!section || !slug) {
      setHoverPin(null);
      return;
    }
    const rect = section.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setHoverPin({
      slug,
      top: rect.top - containerRect.top + container.scrollTop + 8,
      left: rect.right - containerRect.left - 8,
    });
  };

  return (
    <div
      ref={containerRef}
      onMouseUp={preview ? handleMouseUp : undefined}
      onMouseOver={preview ? handleMouseOver : undefined}
      onMouseLeave={preview ? () => setHoverPin(null) : undefined}
      className={`relative min-w-0 flex-1 basis-0 overflow-y-auto bg-surface-sunken ${
        bordered
          ? // split: pin to the viewport below the chrome and scroll internally,
            // independent of the copy pane (which scrolls with the window)
            "sticky top-[6.5rem] h-[calc(100dvh-6.5rem)] self-start border-l border-border"
          : ""
      }`}
    >
      {preview ? (
        <>
          <div className="pointer-events-none sticky top-0 z-10 flex items-center justify-end gap-2 p-3">
            {omittedNote && (
              <p className="pointer-events-auto rounded-md bg-bg/80 px-2 py-1 text-[11px] text-ink-tertiary backdrop-blur-sm">
                {omittedNote}
              </p>
            )}
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-bg/80 p-0.5 shadow-soft backdrop-blur-sm">
              <a
                href={exportHref}
                download
                aria-label="Export HTML"
                title="Export HTML"
                className="flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <DownloadIcon />
              </a>
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating}
                aria-label="Regenerate layout"
                title={generating ? "Designing…" : "Regenerate layout"}
                className="flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:pointer-events-none"
              >
                <WandIcon className={generating ? "size-4 animate-pulse" : "size-4"} />
              </button>
            </div>
          </div>
          <div className="px-6 pb-16">
            <div
              className="wf-root mx-auto max-w-5xl overflow-hidden rounded-lg border border-border shadow-soft"
              // sanitized at generation; copy is escaped during injection
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          </div>
          {selectionPin && (
            <button
              type="button"
              data-add-to-chat
              style={{ top: selectionPin.top, left: selectionPin.left }}
              // keep the text selection alive through the click
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onAddToChat(selectionPin.payload);
                setSelectionPin(null);
                window.getSelection()?.removeAllRanges();
              }}
              title="Attach this selection as assistant context"
              className="absolute z-20 flex h-7 -translate-x-full items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-accent shadow-raised transition-colors hover:bg-accent-soft"
            >
              <AddToChatIcon className="size-3.5" />
              Add to chat
            </button>
          )}
          {hoverPin && !selectionPin && (
            <button
              type="button"
              data-add-to-chat
              style={{ top: hoverPin.top, left: hoverPin.left }}
              onClick={() => {
                onAddToChat({ sectionSlug: hoverPin.slug, text: null, elementType: null });
                setHoverPin(null);
              }}
              title="Attach this whole section as assistant context"
              className="absolute z-20 flex h-7 -translate-x-full items-center gap-1 rounded-md border border-border bg-bg/90 px-2 text-xs font-medium text-ink-secondary shadow-soft backdrop-blur-sm transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <AddToChatIcon className="size-3.5" />
              Add to chat
            </button>
          )}
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
