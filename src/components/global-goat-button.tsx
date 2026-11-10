"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { GoatAvatar } from "@/components/goat-avatar";
import { confirmNotesInCloud } from "@/lib/encounter-notes";
import { flushSaveQueue } from "@/lib/save-queue";
import { forceSyncNow, onSyncStatusChange, type SyncStatus } from "@/lib/storage-sync-interceptor";

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

export type GoatSavePhase = "idle" | "saving" | "saved" | "error";

/** The same retry the corner save badge uses: push the queue, notes, and the cloud sync. */
export async function retryGoatCloudSync(): Promise<void> {
  await Promise.allSettled([forceSyncNow(), flushSaveQueue(), confirmNotesInCloud()]);
}

/** Circle plus the short save pill. The picture fills the circle. */
export function GoatChatFace({
  phase,
  onOpen,
  onRetry,
}: {
  phase: GoatSavePhase;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const ring =
    phase === "saved"
      ? "border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.35)]"
      : phase === "saving"
        ? "border-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.28)]"
        : phase === "error"
          ? "border-red-500 shadow-[0_0_0_4px_rgba(220,38,38,0.28)]"
          : "border-transparent shadow-[0_8px_24px_rgba(14,51,78,0.18)]";
  const pill =
    phase === "saved"
      ? "bg-emerald-600"
      : phase === "saving"
        ? "bg-sky-600"
        : "bg-red-600";
  return (
    <div className="flex items-center gap-2">
      {phase !== "idle" && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ${pill}`} role="status">
          {phase === "saving" ? "Saving…" : phase === "saved" ? "Saved" : (
            <button className="font-semibold" onClick={onRetry} type="button">
              Retry
            </button>
          )}
        </span>
      )}
      <button
        aria-label="Open G.O.A.T. chat"
        className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 bg-transparent p-0 transition motion-reduce:transition-none motion-reduce:hover:scale-100 hover:scale-105 ${ring}`}
        onClick={onOpen}
        title="G.O.A.T. chat"
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          height={48}
          sizes="48px"
          src="/goat-avatar/avatar-128.png"
          srcSet="/goat-avatar/avatar-64.png 64w, /goat-avatar/avatar-128.png 128w"
          width={48}
        />
      </button>
    </div>
  );
}

/** Small goat in the bottom-right of every page. Opens the chat popup. */
export function GoatChatFab() {
  const open = useGlobalGoatOpen();
  const { canView } = useWorkspaceAccess();
  const [phase, setPhase] = useState<GoatSavePhase>("idle");
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let fade: number | undefined;
    const clearFade = () => {
      if (fade) window.clearTimeout(fade);
      fade = undefined;
    };
    const off = onSyncStatusChange((status: SyncStatus) => {
      if (status === "syncing") {
        clearFade();
        setPhase("saving");
        return;
      }
      if (status === "error") {
        clearFade();
        setPhase("error");
        return;
      }
      setPhase("saved");
      clearFade();
      fade = window.setTimeout(() => setPhase("idle"), 1500);
    });
    return () => {
      off();
      clearFade();
    };
  }, []);
  if (!canView("patients") || open) return null;
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 motion-reduce:transition-none">
      <GoatChatFace
        onOpen={() => setGlobalGoatOpen(true)}
        onRetry={() => {
          if (retrying) return;
          setRetrying(true);
          setPhase("saving");
          void retryGoatCloudSync().finally(() => setRetrying(false));
        }}
        phase={phase}
      />
    </div>
  );
}

