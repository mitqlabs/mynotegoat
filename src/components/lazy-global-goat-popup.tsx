"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useGlobalGoatOpen } from "@/components/global-goat-button";

const loadGoat = () => import("@/components/global-goat");

const GlobalGoatPopup = dynamic(() => loadGoat().then((m) => ({ default: m.GlobalGoatPopup })), {
  ssr: false,
});

/**
 * G.O.A.T. is big, so it isn't part of the first page download. It is
 * fetched in the background once the page is idle (so the first click is
 * instant), or right away if the user opens it before that.
 */
export function LazyGlobalGoatPopup() {
  const open = useGlobalGoatOpen();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const start = () => {
      void loadGoat().then(() => setReady(true));
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(start, 1500);
    return () => window.clearTimeout(t);
  }, []);
  if (!ready && !open) return null;
  return <GlobalGoatPopup />;
}
