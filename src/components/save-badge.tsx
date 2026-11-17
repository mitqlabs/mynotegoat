"use client";

import { useState, useSyncExternalStore } from "react";
import { getSaveQueueState, subscribeSaveQueue, type SaveQueueState } from "@/lib/save-queue";

const SERVER_STATE: SaveQueueState = { waiting: 0, offline: false };

export type SaveBadgeInput = {
  status: "synced" | "syncing" | "error";
  unsyncedNotes: number;
  errorDismissed: boolean;
};

/** What the corner badge should say. Saving and Saved are not here — the circular button shows those. */
export type SaveBadgeView =
  | { kind: "waiting"; offline: boolean }
  | { kind: "offline" }
  | { kind: "error" }
  | null;

export function saveBadgeView(props: SaveBadgeInput, queue: SaveQueueState): SaveBadgeView {
  const pending = queue.waiting + props.unsyncedNotes;
  if (pending > 0 || (queue.offline && props.status === "error")) {
    return { kind: "waiting", offline: queue.offline };
  }
  if (queue.offline) return { kind: "offline" };
  if (props.status === "error" && !props.errorDismissed) return { kind: "error" };
  return null;
}

/**
 * Problem-only save indicator, sitting above the circular G.O.A.T. button.
 * Saving and Saved already show on that button, so this badge stays quiet
 * for those. It speaks up when a sync is not done:
 *   Waiting to sync (queued writes / notes that failed a cloud check)
 *   Offline
 *   Couldn't save (real error, with Retry + details)
 * Individual screens no longer show their own "Saving / Saved" text.
 */
export function SaveBadge(props: SaveBadgeInput & {
  errorMessage: string | null;
  retrying: boolean;
  onRetry: () => void | Promise<void>;
  onDismissError: () => void;
}) {
  const q = useSyncExternalStore(subscribeSaveQueue, getSaveQueueState, () => SERVER_STATE);
  const [showDetail, setShowDetail] = useState(false);
  const view = saveBadgeView(props, q);

  const base =
    "pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-colors";

  let body: React.ReactNode = null;
  if (view?.kind === "waiting") {
    body = (
      <div
        className={`${base} bg-amber-500`}
        data-testid="save-badge-waiting"
        title="Your changes are kept on this computer and will sync automatically when the connection is back. Keep this tab open."
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        <span>Waiting to sync{view.offline ? " · offline" : ""}</span>
        {!view.offline && (
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
  } else if (view?.kind === "offline") {
    body = (
      <div className={`${base} bg-slate-500`} title="No internet connection. Changes will sync when you're back online.">
        Offline
      </div>
    );
  } else if (view?.kind === "error") {
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
  }

  if (!body) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2"
      data-testid="save-badge"
    >
      {body}
    </div>
  );
}
