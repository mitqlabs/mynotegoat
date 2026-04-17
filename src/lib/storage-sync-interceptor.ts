"use client";

/**
 * Storage Sync Interceptor
 *
 * Monkey-patches localStorage.setItem and localStorage.removeItem so that
 * EVERY write to a casemate.* key automatically triggers an immediate
 * cloud push to Supabase. Debounced by 300ms to batch rapid changes.
 *
 * This means existing code does NOT need to change — any hook or function
 * that writes to localStorage automatically syncs to the cloud.
 *
 * Cloud is the source of truth. localStorage is just a fast cache.
 */

import { pushLocalStateToCloud } from "@/lib/cloud-state";

const CASEMATE_PREFIX = "casemate.";
const IGNORE_KEYS = new Set([
  "casemate.active-workspace-id.v1",
  "casemate.__safety-backup__.v1",
]);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let inflightSync: Promise<void> | null = null;
let lastSyncAt = 0;
let syncErrorCount = 0;
let paused = false;

/** Temporarily pause sync (e.g. during bootstrap writes). */
export function pauseSync() {
  paused = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Resume sync after bootstrap. */
export function resumeSync() {
  paused = false;
}

// Sync status callback for UI indicator.
// Callbacks now receive an optional detail payload (error message or a
// "saved-at" timestamp) so the UI can show the actual reason for a failure
// and flash a green "Cloud Saved!" confirmation after a successful push.
export type SyncStatus = "syncing" | "synced" | "error";
export interface SyncStatusDetail {
  /** Source that reported the status — used for log correlation. */
  source?: string;
  /** Human-readable error message (error only). */
  errorMessage?: string;
  /** Timestamp (ms since epoch) of the event. */
  at: number;
}
type SyncStatusCallback = (status: SyncStatus, detail: SyncStatusDetail) => void;
let statusCallback: SyncStatusCallback | null = null;

export function onSyncStatusChange(callback: SyncStatusCallback) {
  statusCallback = callback;
}

function notifyStatus(status: SyncStatus, detail: Partial<SyncStatusDetail> = {}) {
  if (statusCallback) {
    try {
      statusCallback(status, { at: Date.now(), ...detail });
    } catch {
      // ignore
    }
  }
}

/**
 * Public escape hatch for *cloud-table* writes that fail outside the blob
 * autosave path (e.g., dual-writes to dedicated tables). Flips the UI
 * indicator to "error" and logs for diagnosis. Callers should still throw
 * upstream so the caller's own error-handling can run.
 */
export function reportCloudWriteError(source: string, error: unknown) {
  syncErrorCount += 1;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[Cloud Write] ${source} failed:`, msg);
  notifyStatus("error", { source, errorMessage: msg });
}

/**
 * Companion to reportCloudWriteError for cloud-table write SUCCESSES. Flips
 * the UI indicator to "synced" so the green "Cloud Saved ✓" pill flashes.
 * Without this, dedicated-table dual-writes (patients, appointments,
 * encounter-notes) succeeded silently — the user had no positive signal
 * that their save actually made it to the cloud. That's scary when you
 * just hit "Save Encounters" and the button just returns a plain message
 * without the familiar confirmation pill.
 */
export function reportCloudWriteSuccess(source: string) {
  // Reset the error counter so a stale error from a prior failed write
  // doesn't keep the indicator red after a clean success.
  syncErrorCount = 0;
  notifyStatus("synced", { source });
}

/**
 * Flip the indicator to "syncing" for dedicated-table writes — mirrors
 * what the blob autosave path already does. Call this right before the
 * cloud op starts so the user sees the blue "Saving to cloud..." pill
 * while the write is in flight.
 */
export function reportCloudWriteStart(source: string) {
  notifyStatus("syncing", { source });
}

function doSync(): Promise<void> {
  // If a sync is already running, return its promise so callers actually
  // await it instead of resolving immediately. Critical for "Save & Close"
  // flows that navigate away as soon as the await resolves — without this,
  // the in-flight fetch gets aborted by the page unload and the cloud
  // never receives the latest write.
  if (inflightSync) {
    return inflightSync;
  }
  notifyStatus("syncing", { source: "blob autosave" });
  inflightSync = (async () => {
    try {
      await pushLocalStateToCloud();
      lastSyncAt = Date.now();
      syncErrorCount = 0;
      notifyStatus("synced", { source: "blob autosave" });
    } catch (error) {
      syncErrorCount += 1;
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[Storage Sync] Cloud push failed:", error);
      notifyStatus("error", { source: "blob autosave", errorMessage: msg });
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
}

function scheduleSyncNow() {
  if (paused) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void doSync();
  }, 300);
}

export function installStorageSyncInterceptor() {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);

  window.localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (key.startsWith(CASEMATE_PREFIX) && !IGNORE_KEYS.has(key) && !key.startsWith("casemate.cloud-sync-at")) {
      scheduleSyncNow();
    }
  };

  window.localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (key.startsWith(CASEMATE_PREFIX) && !IGNORE_KEYS.has(key) && !key.startsWith("casemate.cloud-sync-at")) {
      scheduleSyncNow();
    }
  };

  // Also do a sync on page hide/unload for safety
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void doSync();
    }
  });
  window.addEventListener("beforeunload", () => {
    void doSync();
  });
}

export function getLastSyncAt() {
  return lastSyncAt;
}

export function getSyncErrorCount() {
  return syncErrorCount;
}

export function forceSyncNow() {
  return doSync();
}
