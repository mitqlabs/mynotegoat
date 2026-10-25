"use client";

import { useSyncExternalStore } from "react";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { GoatAvatar } from "@/components/goat-avatar";

// ---------------------------------------------------------------------------
// Open/closed, shared by the nav button and the popup.
// ---------------------------------------------------------------------------

let popupOpen = false;
const openListeners = new Set<() => void>();
export function setGlobalGoatOpen(open: boolean) {
  popupOpen = open;
  openListeners.forEach((l) => l());
}
/** Text waiting to be sent once the popup is open (from the patient-page box). */
let pendingAsk: string | null = null;
/** Open the global G.O.A.T. chat and send `text` there, as if typed. On a
 *  patient page its "him / her / this patient" is that page's patient. */
export function askGlobalGoat(text: string) {
  pendingAsk = text;
  setGlobalGoatOpen(true);
}
export function takePendingAsk(): string | null {
  const t = pendingAsk;
  pendingAsk = null;
  return t;
}
export function useGlobalGoatOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      openListeners.add(l);
      return () => {
        openListeners.delete(l);
      };
    },
    () => popupOpen,
    () => false,
  );
}

/** Sidebar / mobile-nav button. `compact` = icon only (collapsed sidebar). */
export function GlobalGoatButton({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const open = useGlobalGoatOpen();
  const { canView } = useWorkspaceAccess();
  if (!canView("patients")) return null;
  return (
    <button
      aria-expanded={open}
      className={className}
      onClick={() => setGlobalGoatOpen(!open)}
      title="Ask G.O.A.T."
      type="button"
    >
      <GoatAvatar size={compact ? 30 : 28} />
      {!compact && <span>G.O.A.T.</span>}
    </button>
  );
}

