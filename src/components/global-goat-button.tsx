"use client";

import Link from "next/link";
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

/** Sidebar / mobile-nav entry. Opens the full GOAT Page, not the chat. */
export function GlobalGoatButton({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { canView } = useWorkspaceAccess();
  if (!canView("patients")) return null;
  return (
    <Link className={className} href="/goat-page" title="GOAT Page">
      <GoatAvatar size={compact ? 30 : 28} />
      {!compact && <span>G.O.A.T.</span>}
    </Link>
  );
}

/** Small goat in the bottom-right of every page. Opens the chat popup. */
export function GoatChatFab() {
  const open = useGlobalGoatOpen();
  const { canView } = useWorkspaceAccess();
  if (!canView("patients") || open) return null;
  return (
    <button
      aria-label="Open G.O.A.T. chat"
      className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line-soft)] bg-white shadow-[0_8px_24px_rgba(14,51,78,0.18)] transition hover:scale-105"
      onClick={() => setGlobalGoatOpen(true)}
      title="G.O.A.T. chat"
      type="button"
    >
      <GoatAvatar size={36} />
    </button>
  );
}

