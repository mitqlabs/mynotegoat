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

// Prefixes that should NOT trigger a cloud push. Drafts are the
// per-keystroke last-ditch local safety net — they are flushed on
// every `onInput` and would otherwise pin the CPU serializing the
// entire localStorage and round-tripping Supabase on every keypress.
// The committed encounter data is dual-written via its own cloud path
// (encounter-notes-cloud.ts), so cloud durability is already covered.
const IGNORE_PREFIXES: string[] = [
  "casemate.draft.v1.",
  "casemate.cloud-sync-at",
];

function shouldSyncKey(key: string): boolean {
  if (!key.startsWith(CASEMATE_PREFIX)) return false;
  if (IGNORE_KEYS.has(key)) return false;
  for (const prefix of IGNORE_PREFIXES) {
    if (key.startsWith(prefix)) return false;
  }
  return true;
}

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
  // ── Blob-push DISABLED ──
  // Every entity (patients, appointments, encounter-notes, KV settings,
  // contacts, etc.) now dual-writes to its own dedicated cloud table or
  // workspace_kv row. The legacy "push the entire localStorage as one
  // big JSONB blob to app_snapshots" path is pure redundancy — and it
  // was the source of constant supabase.auth.getSession() contention
  // with the per-entity writes, killing them with the
  //   "Lock broken by another request with the 'steal' option"
  // AbortError. Symptom: blue "saving to cloud" pill stuck forever,
  // brief red flash, encounters never persisted, draft-recovery banner
  // showed unsaved work on every refresh.
  //
  // Resolution: skip the push entirely. Per-entity writers carry the
  // freight from now on. Bootstrap still pulls from app_snapshots as a
  // fallback for any pre-migration data that might still live there.
  if (inflightSync) {
    return inflightSync;
  }
  return Promise.resolve();
}

// Coalesced cloud push. We intentionally use a longer window than the
// old 300ms: on an active-editing session every keystroke pokes this,
// and a short debounce meant full-workspace snapshot round-trips fired
// every ~300ms of sustained typing — which pegged the CPU fan and
// starved the main thread. 5s is still well inside "safe to lose on
// crash" territory because the per-section draft keys (excluded from
// the interceptor) survive a crash synchronously on every input, and
// each feature group does its own dual-write to a dedicated cloud
// table via dualWriteKv / saveFoo paths.
const SYNC_DEBOUNCE_MS = 5_000;
// Hard ceiling so a user typing non-stop still gets a push within this
// window even if the trailing debounce keeps resetting. Without this,
// a long uninterrupted edit could sit unsynced for minutes.
const SYNC_MAX_DELAY_MS = 30_000;

let firstPendingAt = 0;

function scheduleSyncNow() {
  if (paused) return;
  const now = Date.now();
  if (firstPendingAt === 0) {
    firstPendingAt = now;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  // If we've been waiting longer than the max, flush immediately.
  const waited = now - firstPendingAt;
  if (waited >= SYNC_MAX_DELAY_MS) {
    firstPendingAt = 0;
    debounceTimer = null;
    void doSync();
    return;
  }
  debounceTimer = setTimeout(() => {
    firstPendingAt = 0;
    debounceTimer = null;
    void doSync();
  }, SYNC_DEBOUNCE_MS);
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
    if (shouldSyncKey(key)) {
      scheduleSyncNow();
    }
  };

  window.localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (shouldSyncKey(key)) {
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
