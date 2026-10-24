"use client";

import { useState, useSyncExternalStore } from "react";
import { getSaveQueueState, subscribeSaveQueue, type SaveQueueState } from "@/lib/save-queue";

const SERVER_STATE: SaveQueueState = { waiting: 0, offline: false };

/**
 * The ONE save indicator for the whole app (bottom-right):
 *   Saving…  →  Saved ✓  (fades)   ·   Waiting to sync (offline / retrying)
 *   ·   Couldn't save (real error, with Retry + details).
 * Individual screens no longer show their own "Saving / Saved" text.
 */
export function SaveBadge(props: {
  status: "synced" | "syncing" | "error";
  savedFlash: boolean;
  unsyncedNotes: number;
  errorMessage: string | null;
  errorDismissed: boolean;
  retrying: boolean;
  onRetry: () => void | Promise<void>;
  onDismissError: () => void;
}) {
  const q = useSyncExternalStore(subscribeSaveQueue, getSaveQueueState, () => SERVER_STATE);
  const [showDetail, setShowDetail] = useState(false);
  const pending = q.waiting + props.unsyncedNotes;

  const base =
    "pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors";

  let body: React.ReactNode = null;
  if (pending > 0 || (q.offline && props.status === "error")) {
    body = (
      <div
        className={`${base} bg-amber-500`}
        data-testid="save-badge-waiting"
        title="Your changes are kept on this computer and will sync automatically when the connection is back. Keep this tab open."
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        <span>Waiting to sync{q.offline ? " · offline" : ""}</span>
        {!q.offline && (
          <button
            className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] hover:bg-white/30 disabled:opacity-50"
            disabled={props.retrying}
            onClick={() => void props.onRetry()}
            type="button"
          >
            {props.retrying ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>
    );
  } else if (q.offline) {
    body = (
      <div className={`${base} bg-slate-500`} title="No internet connection. Changes will sync when you're back online.">
        Offline
      </div>
    );
  } else if (props.status === "error" && !props.errorDismissed) {
    body = (
      <div className="pointer-events-auto max-w-sm rounded-2xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
        <div className="flex items-center gap-2">
          <button className="hover:underline" onClick={() => setShowDetail((v) => !v)} type="button">
            Couldn&apos;t save
          </button>
          <button
            className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] hover:bg-white/30 disabled:opacity-50"
            disabled={props.retrying}
            onClick={() => void props.onRetry()}
            type="button"
          >
            {props.retrying ? "Retrying…" : "Retry"}
          </button>
          <button
            aria-label="Dismiss"
            className="text-white/70 hover:text-white"
            onClick={props.onDismissError}
            title="Dismiss (your changes are still on this computer)"
            type="button"
          >
            ×
          </button>
        </div>
        {showDetail && (
          <div className="mt-1 text-[10px] font-normal text-red-100">
            Your work is safe in this browser — it just hasn&apos;t reached the cloud yet.
            {props.errorMessage && (
              <div className="mt-1 max-h-24 overflow-hidden break-all font-mono">{props.errorMessage}</div>
            )}
          </div>
        )}
      </div>
    );
  } else if (props.status === "syncing") {
    body = <div className={`${base} bg-blue-600`}>Saving…</div>;
  } else if (props.savedFlash) {
    body = <div className={`${base} bg-emerald-600`}>Saved ✓</div>;
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2"
      data-testid="save-badge"
    >
      {body}
    </div>
  );
}
