"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

type FlushSaves = () => Promise<void>;

interface PageSaveNavigation {
  navigate: (href: string) => Promise<void>;
  registerFlush: (flush: FlushSaves) => () => void;
}

const PageSaveNavigationContext = createContext<PageSaveNavigation | null>(null);
const noPendingSaves: FlushSaves = async () => {};

/** Coordinates the sibling page tree and editor so navigation cannot cancel autosave. */
export function PageSaveNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const flushRef = useRef<FlushSaves>(noPendingSaves);

  const registerFlush = useCallback((flush: FlushSaves) => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = noPendingSaves;
    };
  }, []);

  const navigate = useCallback(
    async (href: string) => {
      await flushRef.current();
      router.push(href);
    },
    [router],
  );

  return (
    <PageSaveNavigationContext.Provider value={{ navigate, registerFlush }}>
      {children}
    </PageSaveNavigationContext.Provider>
  );
}

export function usePageSaveNavigation(): PageSaveNavigation {
  const value = useContext(PageSaveNavigationContext);
  if (!value) throw new Error("usePageSaveNavigation must be used within PageSaveNavigationProvider");
  return value;
}
