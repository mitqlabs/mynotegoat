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

/** Circle that is also the save indicator. The picture fills the circle. */
export function GoatChatFace({
  phase,
  onOpen,
  onRetry,
}: {
  phase: GoatSavePhase;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const failed = phase === "error";
  const label = phase === "saving" ? "Saving…" : phase === "saved" ? "Saved" : failed ? "Retry" : "Open G.O.A.T. chat";
  return (
    <div className="relative h-14 w-14" role="status">
      <style>{`
        .goat-work-ring { animation: goat-work-spin 1s linear infinite; transform-origin: 50% 50%; }
        .goat-work-bob { animation: goat-work-bob 1.1s ease-in-out infinite; }
        .goat-saved-flash { animation: goat-saved-flash 0.45s ease-out forwards; }
        @keyframes goat-work-spin { to { transform: rotate(360deg); } }
        @keyframes goat-work-bob {
          0%, 100% { transform: translate(2.4%, 2.2%) scale(1.08) rotate(-2deg); }
          50% { transform: translate(2.4%, calc(2.2% - 3px)) scale(1.08) rotate(2deg); }
        }
        @keyframes goat-saved-flash {
          0% { opacity: 0; transform: scale(0.86); }
          40% { opacity: 1; transform: scale(1); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .goat-work-ring, .goat-work-bob, .goat-saved-flash { animation: none; }
        }
      `}</style>
      {phase === "saving" && (
        <svg aria-hidden="true" className="goat-work-ring pointer-events-none absolute inset-0 h-full w-full motion-reduce:animate-none" viewBox="0 0 56 56">
          <circle cx="28" cy="28" fill="none" r="25" stroke="#bae6fd" strokeWidth="3" />
          <circle cx="28" cy="28" fill="none" r="25" stroke="#0284c7" strokeDasharray="48 120" strokeLinecap="round" strokeWidth="3" />
        </svg>
      )}
      <button
        aria-label={label}
        className={`absolute inset-1 overflow-hidden rounded-full border-0 bg-transparent p-0 transition motion-reduce:transition-none motion-reduce:hover:scale-100 hover:scale-105 ${
          failed
            ? "shadow-[0_0_0_3px_#dc2626]"
            : phase === "idle"
              ? "shadow-[0_8px_24px_rgba(14,51,78,0.18)]"
              : ""
        }`}
        onClick={failed ? onRetry : onOpen}
        title={label}
        type="button"
      >
        {/* The source art has a little more empty space on the right and bottom.
            Cover the circle, then nudge that padding so the goat sits in the middle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className={`absolute inset-0 h-full w-full max-w-none ${phase === "saving" ? "goat-work-bob" : ""}`}
          draggable={false}
          height={48}
          sizes="128px"
          src="/goat-avatar/avatar-128.png"
          srcSet="/goat-avatar/avatar-64.png 64w, /goat-avatar/avatar-128.png 128w"
          style={{ objectFit: "cover", objectPosition: "center", transform: "translate(2.4%, 2.2%) scale(1.08)" }}
          width={48}
        />
        {phase === "saved" && (
          <span className="goat-saved-flash absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-emerald-600 text-white">
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
            </svg>
            <span className="text-[9px] font-semibold leading-none">Saved</span>
          </span>
        )}
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

